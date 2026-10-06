package webpush

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"dashboardify/internal/capture"
)

type fakeSender struct {
	statuses map[string]int
	payloads [][]byte
	calls    int
}

func (sender *fakeSender) Send(_ context.Context, payload []byte, subscription Subscription) (int, error) {
	sender.calls++
	sender.payloads = append(sender.payloads, append([]byte(nil), payload...))
	return sender.statuses[subscription.Endpoint], nil
}

func TestDispatchDeliversOnceAndRemovesExpiredSubscriptions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dashboardify.db")
	captureStore, err := capture.OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer captureStore.Close()
	pushStore, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer pushStore.Close()

	service, err := NewService(pushStore, Config{
		PublicKey:  "public",
		PrivateKey: "private",
		Subject:    "mailto:owner@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	current := time.Date(2026, time.January, 7, 9, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return current }
	active := testSubscription("https://push.example.com/active")
	expired := testSubscription("https://push.example.com/expired")
	if err := service.Subscribe(context.Background(), active); err != nil {
		t.Fatal(err)
	}
	if err := service.Subscribe(context.Background(), expired); err != nil {
		t.Fatal(err)
	}

	current = current.Add(time.Hour)
	captures := capture.NewService(captureStore, capture.NewParser(time.UTC), func() time.Time { return current }, nil)
	if _, err := captures.Create(context.Background(), "push-reminder", "Remind me to submit report today at 2:30 pm"); err != nil {
		t.Fatal(err)
	}
	view, err := captures.Today(context.Background(), "2026-01-07")
	if err != nil || len(view.Tasks) != 1 {
		t.Fatalf("Today() = %#v, %v", view, err)
	}
	task := view.Tasks[0]
	reminderAt := current.Add(-time.Minute)
	if _, err := captures.UpdateTask(context.Background(), task.ID, capture.TaskUpdate{
		Title: task.Title, DueAt: task.DueAt, DueDate: task.DueDate, ReminderAt: &reminderAt,
		AllDay: task.AllDay, Place: "Office", Status: "open",
	}); err != nil {
		t.Fatal(err)
	}
	if notifications, err := captures.Notifications(context.Background()); err != nil || len(notifications) != 1 {
		t.Fatalf("Notifications() = %#v, %v", notifications, err)
	}

	sender := &fakeSender{statuses: map[string]int{active.Endpoint: 201, expired.Endpoint: 410}}
	service.sender = sender
	summary, err := service.Dispatch(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if summary.Sent != 1 || summary.Removed != 1 || summary.Failed != 0 {
		t.Fatalf("Dispatch() summary = %#v", summary)
	}
	if len(sender.payloads) != 2 {
		t.Fatalf("Send() payload count = %d, want 2", len(sender.payloads))
	}
	for _, payload := range sender.payloads {
		var notification map[string]string
		if err := json.Unmarshal(payload, &notification); err != nil {
			t.Fatalf("decode push payload: %v", err)
		}
		if notification["title"] != task.Title || notification["body"] != "Reminder due · Office" {
			t.Errorf("push notification = %#v", notification)
		}
	}
	if second, err := service.Dispatch(context.Background()); err != nil || second != (DispatchSummary{}) {
		t.Fatalf("second Dispatch() = %#v, %v", second, err)
	}

	current = current.Add(time.Hour)
	late := testSubscription("https://push.example.com/late")
	if err := service.Subscribe(context.Background(), late); err != nil {
		t.Fatal(err)
	}
	if third, err := service.Dispatch(context.Background()); err != nil || third != (DispatchSummary{}) {
		t.Fatalf("late subscription Dispatch() = %#v, %v", third, err)
	}
}

func TestLibrarySubscriber(t *testing.T) {
	tests := map[string]string{
		"mailto:owner@example.com": "owner@example.com",
		"https://example.com/push": "https://example.com/push",
	}
	for subject, want := range tests {
		if got := librarySubscriber(subject); got != want {
			t.Errorf("librarySubscriber(%q) = %q, want %q", subject, got, want)
		}
	}
}

func testSubscription(endpoint string) Subscription {
	publicKey := make([]byte, 65)
	publicKey[0] = 4
	return Subscription{
		Endpoint: endpoint,
		Keys: SubscriptionKeys{
			P256DH: base64.RawURLEncoding.EncodeToString(publicKey),
			Auth:   base64.RawURLEncoding.EncodeToString(make([]byte, 16)),
		},
	}
}
