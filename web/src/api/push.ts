import { mutationHeaders, responseJSON } from './client';

export interface PushConfig {
  enabled: boolean;
  public_key: string;
}

export async function getPushConfig(signal?: AbortSignal): Promise<PushConfig> {
  const response = await fetch('/api/push/config', { signal });
  return responseJSON<PushConfig>(response);
}

export async function savePushSubscription(subscription: PushSubscription): Promise<void> {
  const serialized = subscription.toJSON();
  const response = await fetch('/api/push/subscription', {
    method: 'PUT',
    headers: mutationHeaders,
    body: JSON.stringify({ endpoint: subscription.endpoint, keys: serialized.keys }),
  });
  if (!response.ok) await responseJSON(response);
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const response = await fetch('/api/push/subscription', {
    method: 'DELETE',
    headers: mutationHeaders,
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) await responseJSON(response);
}
