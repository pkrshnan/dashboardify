import { mutationHeaders, responseJSON } from './client';
import type { CaptureDetail, CaptureProposal, CaptureRecord, ClassificationInput } from '@/types';

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

export async function captureDetail(id: string, signal?: AbortSignal): Promise<CaptureDetail> {
  const response = await fetch(`/api/captures/${encodeURIComponent(id)}`, { signal });
  return responseJSON<CaptureDetail>(response);
}

export async function classifyCapture(id: string, classification: ClassificationInput): Promise<CaptureRecord> {
  const response = await fetch(`/api/captures/${encodeURIComponent(id)}/classification`, {
    method: 'PUT',
    headers: mutationHeaders,
    body: JSON.stringify(classification),
  });
  return responseJSON<CaptureRecord>(response);
}
