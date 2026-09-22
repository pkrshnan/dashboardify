import { responseJSON } from './client';
import type { TodayView } from '@/types';

export async function getToday(date?: string, signal?: AbortSignal): Promise<TodayView> {
  const query = date ? `?${new URLSearchParams({ date })}` : '';
  const response = await fetch(`/api/today${query}`, { signal });
  return responseJSON<TodayView>(response);
}
