package webpush

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

type Subscription struct {
	Endpoint string           `json:"endpoint"`
	Keys     SubscriptionKeys `json:"keys"`
}

type SubscriptionKeys struct {
	P256DH string `json:"p256dh"`
	Auth   string `json:"auth"`
}

type pendingDelivery struct {
	NotificationID string
	Title          string
	Place          string
	ScheduledAt    time.Time
	Timezone       string
	SubscriptionID string
	Subscription   Subscription
}

type Store struct {
	database *sql.DB
}

func OpenStore(path string) (*Store, error) {
	if path == "" {
		return nil, errors.New("database path is required")
	}
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, fmt.Errorf("create database directory: %w", err)
		}
	}
	database, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open web push database: %w", err)
	}
	database.SetMaxOpenConns(1)
	if _, err := database.Exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;`); err != nil {
		_ = database.Close()
		return nil, fmt.Errorf("configure web push database: %w", err)
	}
	if path != ":memory:" {
		if err := os.Chmod(path, 0o600); err != nil {
			_ = database.Close()
			return nil, fmt.Errorf("protect web push database: %w", err)
		}
	}
	store := &Store{database: database}
	if err := store.migrate(context.Background()); err != nil {
		_ = database.Close()
		return nil, err
	}
	return store, nil
}

func (store *Store) Close() error {
	return store.database.Close()
}

func (store *Store) migrate(ctx context.Context) error {
	_, err := store.database.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS web_push_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at_utc TEXT NOT NULL,
    updated_at_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS web_push_deliveries (
    notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    subscription_id TEXT NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
    delivered_at_utc TEXT NOT NULL,
    PRIMARY KEY(notification_id, subscription_id)
);
CREATE INDEX IF NOT EXISTS web_push_subscriptions_created_idx
ON web_push_subscriptions(created_at_utc);
INSERT OR IGNORE INTO web_push_schema_migrations(version, applied_at_utc) VALUES(1, ?);
`, time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("migrate web push database: %w", err)
	}
	return nil
}

func (store *Store) SaveSubscription(ctx context.Context, subscription Subscription, now time.Time) error {
	id, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("generate web push subscription id: %w", err)
	}
	timestamp := now.UTC().Format(time.RFC3339Nano)
	_, err = store.database.ExecContext(ctx, `
INSERT INTO web_push_subscriptions(id, endpoint, p256dh, auth, created_at_utc, updated_at_utc)
VALUES(?, ?, ?, ?, ?, ?)
ON CONFLICT(endpoint) DO UPDATE SET
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    updated_at_utc = excluded.updated_at_utc`,
		id.String(), subscription.Endpoint, subscription.Keys.P256DH, subscription.Keys.Auth, timestamp, timestamp)
	if err != nil {
		return fmt.Errorf("save web push subscription: %w", err)
	}
	return nil
}

func (store *Store) DeleteSubscription(ctx context.Context, endpoint string) error {
	if _, err := store.database.ExecContext(ctx, `DELETE FROM web_push_subscriptions WHERE endpoint = ?`, endpoint); err != nil {
		return fmt.Errorf("delete web push subscription: %w", err)
	}
	return nil
}

func (store *Store) deleteSubscriptionByID(ctx context.Context, id string) error {
	if _, err := store.database.ExecContext(ctx, `DELETE FROM web_push_subscriptions WHERE id = ?`, id); err != nil {
		return fmt.Errorf("delete expired web push subscription: %w", err)
	}
	return nil
}

func (store *Store) pendingDeliveries(ctx context.Context, limit int) ([]pendingDelivery, error) {
	rows, err := store.database.QueryContext(ctx, `
SELECT notifications.id, tasks.title, tasks.place, notifications.scheduled_at_utc,
       tasks.timezone, subscriptions.id, subscriptions.endpoint,
       subscriptions.p256dh, subscriptions.auth
FROM notifications
JOIN tasks ON tasks.id = notifications.task_id
CROSS JOIN web_push_subscriptions AS subscriptions
WHERE notifications.state = 'unread'
  AND tasks.status = 'open'
  AND notifications.scheduled_at_utc >= subscriptions.created_at_utc
  AND NOT EXISTS (
      SELECT 1
      FROM web_push_deliveries AS deliveries
      WHERE deliveries.notification_id = notifications.id
        AND deliveries.subscription_id = subscriptions.id
  )
ORDER BY notifications.scheduled_at_utc, subscriptions.created_at_utc
LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list pending web push deliveries: %w", err)
	}
	defer rows.Close()

	deliveries := make([]pendingDelivery, 0, limit)
	for rows.Next() {
		var delivery pendingDelivery
		var scheduledAt string
		if err := rows.Scan(
			&delivery.NotificationID,
			&delivery.Title,
			&delivery.Place,
			&scheduledAt,
			&delivery.Timezone,
			&delivery.SubscriptionID,
			&delivery.Subscription.Endpoint,
			&delivery.Subscription.Keys.P256DH,
			&delivery.Subscription.Keys.Auth,
		); err != nil {
			return nil, fmt.Errorf("scan pending web push delivery: %w", err)
		}
		delivery.ScheduledAt, err = time.Parse(time.RFC3339Nano, scheduledAt)
		if err != nil {
			return nil, fmt.Errorf("parse pending web push schedule: %w", err)
		}
		deliveries = append(deliveries, delivery)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pending web push deliveries: %w", err)
	}
	return deliveries, nil
}

func (store *Store) markDelivered(ctx context.Context, delivery pendingDelivery, now time.Time) error {
	_, err := store.database.ExecContext(ctx, `
INSERT OR IGNORE INTO web_push_deliveries(notification_id, subscription_id, delivered_at_utc)
VALUES(?, ?, ?)`, delivery.NotificationID, delivery.SubscriptionID, now.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("record web push delivery: %w", err)
	}
	return nil
}
