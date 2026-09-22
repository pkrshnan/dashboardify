import type { CaptureProposal, CaptureRecord } from './types';

const mutationHeaders = {
  'Content-Type': 'application/json',
  'X-Dashboardify-Request': 'capture-ui',
};

export class APIError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function responseJSON<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => null) as T | { error?: string } | null;
  if (!response.ok) {
    const message = value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
      ? value.error
      : 'Dashboardify could not complete the request';
    throw new APIError(message, response.status);
  }
  return value as T;
}

export async function previewCapture(text: string, signal: AbortSignal): Promise<CaptureProposal> {
  const response = await fetch('/api/captures/preview', {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ text }),
    signal,
  });
  return responseJSON<CaptureProposal>(response);
}

export async function createCapture(text: string, idempotencyKey: string): Promise<CaptureRecord> {
  const response = await fetch('/api/captures', {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ text, idempotency_key: idempotencyKey }),
  });
  return responseJSON<CaptureRecord>(response);
}

export async function listCaptures(signal?: AbortSignal): Promise<CaptureRecord[]> {
  const response = await fetch('/api/captures', { signal });
  const result = await responseJSON<{ captures: CaptureRecord[] }>(response);
  return result.captures;
}
