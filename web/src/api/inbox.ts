import { responseJSON } from './client';
import type { CaptureRecord } from '@/types';

export async function listInbox(signal?: AbortSignal): Promise<CaptureRecord[]> {
  const response = await fetch('/api/inbox', { signal });
  const result = await responseJSON<{ captures: CaptureRecord[] }>(response);
  return result.captures;
}
