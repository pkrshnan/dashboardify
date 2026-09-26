import { useEffect, useState } from 'react';
import { Bell, BellOff, X } from 'lucide-react';

import styles from './NotificationQueue.module.css';

import { dismissNotification, listNotifications } from '@/api';
import { SectionHeading } from '@/components/SectionHeading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { NotificationRecord } from '@/types';

const seenStorageKey = 'dashboardify-browser-notifications';

type DevicePermission = NotificationPermission | 'unsupported';

function currentPermission(): DevicePermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

function notifyDevice(records: NotificationRecord[], permission: DevicePermission) {
  if (permission !== 'granted' || records.length === 0) return;
  let seen: string[] = [];
  try {
    seen = JSON.parse(sessionStorage.getItem(seenStorageKey) ?? '[]') as string[];
  } catch {
    seen = [];
  }
  const seenIDs = new Set(seen);
  for (const record of records) {
    if (seenIDs.has(record.id)) continue;
    new Notification('Dashboardify reminder', {
      body: 'A reminder is due. Open Dashboardify for details.',
      tag: `dashboardify-${record.id}`,
    });
    seenIDs.add(record.id);
  }
  sessionStorage.setItem(seenStorageKey, JSON.stringify(Array.from(seenIDs).slice(-100)));
}

export function NotificationQueue() {
  const [records, setRecords] = useState<NotificationRecord[]>([]);
  const [permission, setPermission] = useState<DevicePermission>(currentPermission);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const queued = await listNotifications(controller.signal);
        setRecords(queued);
        notifyDevice(queued, currentPermission());
      } catch (requestError) {
        if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'Reminders could not be loaded');
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  async function enableDeviceAlerts() {
    if (typeof Notification === 'undefined') return;
    const nextPermission = await Notification.requestPermission();
    setPermission(nextPermission);
    notifyDevice(records, nextPermission);
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

  if (records.length === 0 && permission === 'granted' && !error) return null;

  return (
    <Card className={styles.queue}>
      <div className={styles.queueHeader}>
        <SectionHeading>Reminders</SectionHeading>
        {permission === 'default' ? <Button size="sm" variant="outline" onClick={() => void enableDeviceAlerts()}><Bell />Enable device alerts</Button> : null}
      </div>
      {permission === 'denied' ? <p className={styles.permissionNote}><BellOff />Browser alerts are blocked. Due reminders will still stay visible here.</p> : null}
      {permission === 'unsupported' ? <p className={styles.permissionNote}><BellOff />This browser does not support device alerts. Due reminders will still stay visible here.</p> : null}
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
