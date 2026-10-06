package webpush

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	push "github.com/SherClockHolmes/webpush-go"
)

const maxPendingDeliveries = 100

var (
	ErrDisabled            = errors.New("web push is not configured")
	ErrInvalidSubscription = errors.New("web push subscription is invalid")
)

type Config struct {
	PublicKey  string
	PrivateKey string
	Subject    string
}

type DispatchSummary struct {
	Sent    int
	Removed int
	Failed  int
}

type sender interface {
	Send(context.Context, []byte, Subscription) (int, error)
}

type Service struct {
	store      *Store
	config     Config
	sender     sender
	now        func() time.Time
	configured bool
}

func NewService(store *Store, config Config) (*Service, error) {
	configured := config.PublicKey != "" || config.PrivateKey != "" || config.Subject != ""
	if configured && (config.PublicKey == "" || config.PrivateKey == "" || config.Subject == "") {
		return nil, errors.New("web push requires public key, private key, and subject")
	}
	service := &Service{store: store, config: config, now: time.Now, configured: configured}
	if configured {
		service.sender = &vapidSender{
			config: config,
			client: &http.Client{Timeout: 15 * time.Second},
		}
	}
	return service, nil
}

func (service *Service) Enabled() bool {
	return service != nil && service.configured
}

func (service *Service) PublicKey() string {
	if !service.Enabled() {
		return ""
	}
	return service.config.PublicKey
}

func (service *Service) Subscribe(ctx context.Context, subscription Subscription) error {
	if !service.Enabled() {
		return ErrDisabled
	}
	if err := validateSubscription(subscription); err != nil {
		return err
	}
	return service.store.SaveSubscription(ctx, subscription, service.now())
}

func (service *Service) Unsubscribe(ctx context.Context, endpoint string) error {
	if !service.Enabled() {
		return ErrDisabled
	}
	if err := validateEndpoint(endpoint); err != nil {
		return err
	}
	return service.store.DeleteSubscription(ctx, endpoint)
}

func (service *Service) Dispatch(ctx context.Context) (DispatchSummary, error) {
	if !service.Enabled() {
		return DispatchSummary{}, ErrDisabled
	}
	deliveries, err := service.store.pendingDeliveries(ctx, maxPendingDeliveries)
	if err != nil {
		return DispatchSummary{}, err
	}
	var summary DispatchSummary
	for _, delivery := range deliveries {
		body := "Reminder due"
		if delivery.Place != "" {
			body += " · " + delivery.Place
		}
		payload, err := json.Marshal(map[string]string{
			"title": delivery.Title,
			"body":  body,
			"tag":   "dashboardify-" + delivery.NotificationID,
			"url":   "/",
		})
		if err != nil {
			return summary, fmt.Errorf("encode web push payload: %w", err)
		}
		status, err := service.sender.Send(ctx, payload, delivery.Subscription)
		if err != nil {
			summary.Failed++
			continue
		}
		switch {
		case status >= 200 && status < 300:
			if err := service.store.markDelivered(ctx, delivery, service.now()); err != nil {
				return summary, err
			}
			summary.Sent++
		case status == http.StatusNotFound || status == http.StatusGone:
			if err := service.store.deleteSubscriptionByID(ctx, delivery.SubscriptionID); err != nil {
				return summary, err
			}
			summary.Removed++
		default:
			summary.Failed++
		}
	}
	return summary, nil
}

func validateSubscription(subscription Subscription) error {
	if err := validateEndpoint(subscription.Endpoint); err != nil {
		return err
	}
	publicKey, err := base64.RawURLEncoding.DecodeString(subscription.Keys.P256DH)
	if err != nil || len(publicKey) != 65 || publicKey[0] != 4 {
		return ErrInvalidSubscription
	}
	auth, err := base64.RawURLEncoding.DecodeString(subscription.Keys.Auth)
	if err != nil || len(auth) != 16 {
		return ErrInvalidSubscription
	}
	return nil
}

func validateEndpoint(endpoint string) error {
	if endpoint == "" || len(endpoint) > 2048 || strings.ContainsAny(endpoint, "\r\n\x00") {
		return ErrInvalidSubscription
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return ErrInvalidSubscription
	}
	return nil
}

type vapidSender struct {
	config Config
	client *http.Client
}

func (sender *vapidSender) Send(ctx context.Context, payload []byte, subscription Subscription) (int, error) {
	response, err := push.SendNotificationWithContext(ctx, payload, &push.Subscription{
		Endpoint: subscription.Endpoint,
		Keys: push.Keys{
			P256dh: subscription.Keys.P256DH,
			Auth:   subscription.Keys.Auth,
		},
	}, &push.Options{
		HTTPClient:      sender.client,
		Subscriber:      librarySubscriber(sender.config.Subject),
		TTL:             24 * 60 * 60,
		Urgency:         push.UrgencyHigh,
		VAPIDPublicKey:  sender.config.PublicKey,
		VAPIDPrivateKey: sender.config.PrivateKey,
	})
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	return response.StatusCode, nil
}

// webpush-go treats every non-HTTPS subscriber value as a bare email address
// and adds the mailto scheme itself.
func librarySubscriber(subject string) string {
	return strings.TrimPrefix(subject, "mailto:")
}
