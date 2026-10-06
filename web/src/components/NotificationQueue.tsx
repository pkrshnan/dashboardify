import { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, X } from 'lucide-react';

import styles from './NotificationQueue.module.css';

import {
  deletePushSubscription,
  dismissNotification,
  getPushConfig,
  listNotifications,
  savePushSubscription,
} from '@/api';
import { SectionHeading } from '@/components/SectionHeading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { applicationServerKey, registerDashboardServiceWorker } from '@/serviceWorker';
import type { NotificationRecord } from '@/types';

type AlertState = 'loading' | 'unsupported' | 'unavailable' | 'ready' | 'denied' | 'subscribed';

function supportsWebPush() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function NotificationQueue() {
  const [records, setRecords] = useState<NotificationRecord[]>([]);
  const [alertState, setAlertState] = useState<AlertState>('loading');
  const [publicKey, setPublicKey] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function loadNotifications() {
      try {
        setRecords(await listNotifications(controller.signal));
      } catch (requestError) {
        if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'Reminders could not be loaded');
      }
    }
    async function loadPushState() {
      if (!supportsWebPush()) {
        setAlertState('unsupported');
        return;
      }
      try {
        const config = await getPushConfig(controller.signal);
        if (!config.enabled || !config.public_key) {
          setAlertState('unavailable');
          return;
        }
        setPublicKey(config.public_key);
        const registration = await registerDashboardServiceWorker();
        if (!registration) {
          setAlertState('unsupported');
          return;
        }
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await savePushSubscription(subscription);
          setAlertState('subscribed');
        } else {
          setAlertState(Notification.permission === 'denied' ? 'denied' : 'ready');
        }
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setAlertState('unavailable');
          setError(requestError instanceof Error ? requestError.message : 'Device alerts could not be configured');
        }
      }
    }
    void loadNotifications();
    void loadPushState();
    const timer = window.setInterval(() => void loadNotifications(), 60_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  async function enableDeviceAlerts() {
    setError('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setAlertState(permission === 'denied' ? 'denied' : 'ready');
        return;
      }
      const registration = await registerDashboardServiceWorker();
      if (!registration) throw new Error('The service worker could not be registered');
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      });
      try {
        await savePushSubscription(subscription);
      } catch (requestError) {
        if (!existing) await subscription.unsubscribe();
        throw requestError;
      }
      setAlertState('subscribed');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Device alerts could not be enabled');
    }
  }

  async function disableDeviceAlerts() {
    setError('');
    try {
      const registration = await registerDashboardServiceWorker();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await deletePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setAlertState(Notification.permission === 'denied' ? 'denied' : 'ready');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Device alerts could not be disabled');
    }
  }

  async function dismiss(record: NotificationRecord) {
    setError('');
    try {
      await dismissNotification(record.id);
      setRecords((items) => items.filter((item) => item.id !== record.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Reminder could not be dismissed');
    }
  }

  return (
    <Card className={styles.queue}>
      <div className={styles.queueHeader}>
        <SectionHeading>Reminders</SectionHeading>
        {alertState === 'ready' ? <Button size="sm" variant="outline" onClick={() => void enableDeviceAlerts()}><BellRing />Enable device alerts</Button> : null}
        {alertState === 'subscribed' ? <Button size="sm" variant="ghost" onClick={() => void disableDeviceAlerts()}><BellOff />Disable device alerts</Button> : null}
      </div>
      {alertState === 'loading' ? <p className={styles.permissionNote}><Bell />Checking device alerts…</p> : null}
      {alertState === 'subscribed' ? <p className={styles.permissionNote}><BellRing />Background alerts are enabled on this device.</p> : null}
      {alertState === 'denied' ? <p className={styles.permissionNote}><BellOff />Notifications are blocked. Enable them for Dashboardify in Settings, then reopen the app.</p> : null}
      {alertState === 'unsupported' ? <p className={styles.permissionNote}><BellOff />On iPhone or iPad, add Dashboardify to the Home Screen and open it there to enable background alerts. iOS 16.4 or newer is required.</p> : null}
      {alertState === 'unavailable' ? <p className={styles.permissionNote}><BellOff />Background alerts are not configured on the server.</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {records.length > 0 ? (
        <ul className={styles.notificationList}>
          {records.map((record) => (
            <li key={record.id}>
              <Bell aria-hidden="true" />
              <div><strong>{record.title}</strong><small>{[new Date(record.scheduled_at).toLocaleString(), record.place].filter(Boolean).join(' · ')}</small></div>
              <Button size="icon-sm" variant="ghost" aria-label={`Dismiss ${record.title}`} onClick={() => void dismiss(record)}><X /></Button>
            </li>
          ))}
        </ul>
      ) : <p className={styles.empty}>No due reminders.</p>}
    </Card>
  );
}
