package httpserver

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"dashboardify/internal/capture"
	"dashboardify/internal/webpush"
)

func TestPushSubscriptionResourceRegistersAndRemovesDevice(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dashboardify.db")
	captureStore, err := capture.OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer captureStore.Close()
	pushStore, err := webpush.OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer pushStore.Close()
	pushService, err := webpush.NewService(pushStore, webpush.Config{
		PublicKey:  "browser-public-key",
		PrivateKey: "server-private-key",
		Subject:    "mailto:owner@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	handler := dashboardApplication(discardLogger(), nil, nil, nil, pushService)

	configResponse := httptest.NewRecorder()
	handler.ServeHTTP(configResponse, httptest.NewRequest(http.MethodGet, "https://dashboard.example.com/api/push/config", nil))
	if configResponse.Code != http.StatusOK {
		t.Fatalf("config status = %d: %s", configResponse.Code, configResponse.Body.String())
	}
	var config struct {
		Enabled   bool   `json:"enabled"`
		PublicKey string `json:"public_key"`
	}
	if err := json.NewDecoder(configResponse.Body).Decode(&config); err != nil || !config.Enabled || config.PublicKey != "browser-public-key" {
		t.Fatalf("config = %#v, %v", config, err)
	}

	publicKey := make([]byte, 65)
	publicKey[0] = 4
	subscription := webpush.Subscription{
		Endpoint: "https://push.example.com/device",
		Keys: webpush.SubscriptionKeys{
			P256DH: base64.RawURLEncoding.EncodeToString(publicKey),
			Auth:   base64.RawURLEncoding.EncodeToString(make([]byte, 16)),
		},
	}
	body, err := json.Marshal(subscription)
	if err != nil {
		t.Fatal(err)
	}
	subscribe := httptest.NewRequest(http.MethodPut, "https://dashboard.example.com/api/push/subscription", bytes.NewReader(body))
	subscribe.Header.Set("Content-Type", "application/json")
	subscribe.Header.Set("Origin", "https://dashboard.example.com")
	subscribe.Header.Set("X-Dashboardify-Request", "dashboard-ui")
	subscribeResponse := httptest.NewRecorder()
	handler.ServeHTTP(subscribeResponse, subscribe)
	if subscribeResponse.Code != http.StatusNoContent {
		t.Fatalf("subscribe status = %d: %s", subscribeResponse.Code, subscribeResponse.Body.String())
	}

	body, err = json.Marshal(map[string]string{"endpoint": subscription.Endpoint})
	if err != nil {
		t.Fatal(err)
	}
	unsubscribe := httptest.NewRequest(http.MethodDelete, "https://dashboard.example.com/api/push/subscription", bytes.NewReader(body))
	unsubscribe.Header.Set("Content-Type", "application/json")
	unsubscribe.Header.Set("Origin", "https://dashboard.example.com")
	unsubscribe.Header.Set("X-Dashboardify-Request", "dashboard-ui")
	unsubscribeResponse := httptest.NewRecorder()
	handler.ServeHTTP(unsubscribeResponse, unsubscribe)
	if unsubscribeResponse.Code != http.StatusNoContent {
		t.Fatalf("unsubscribe status = %d: %s", unsubscribeResponse.Code, unsubscribeResponse.Body.String())
	}
}
