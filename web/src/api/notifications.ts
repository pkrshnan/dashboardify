import { mutationHeaders, responseJSON } from './client';
import type { NotificationRecord } from '@/types';

export async function listNotifications(signal?: AbortSignal): Promise<NotificationRecord[]> {
  const response = await fetch('/api/notifications', { signal });
  const result = await responseJSON<{ notifications: NotificationRecord[] }>(response);
  return result.notifications;
}

export async function dismissNotification(id: string): Promise<void> {
  const response = await fetch(`/api/notifications/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: mutationHeaders,
    body: JSON.stringify({ state: 'read' }),
  });
  if (!response.ok) await responseJSON(response);
}
