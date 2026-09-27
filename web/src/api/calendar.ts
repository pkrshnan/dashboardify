import { mutationHeaders, responseJSON } from './client';

import type {
  CalendarConflict,
  CalendarStatus,
  CalendarSyncSummary,
  EventRecord,
  EventUpdate,
} from '@/types';

export function getCalendarStatus(signal?: AbortSignal): Promise<CalendarStatus> {
  return fetch('/api/calendar/status', { signal }).then(responseJSON<CalendarStatus>);
}

export function listCalendarConflicts(signal?: AbortSignal): Promise<CalendarConflict[]> {
  return fetch('/api/calendar/conflicts', { signal })
    .then(responseJSON<{ conflicts: CalendarConflict[] }>)
    .then((result) => result.conflicts);
}

export function discoverCalendar(): Promise<void> {
  return fetch('/api/calendar/discover', {
    method: 'POST',
    headers: mutationHeaders,
    body: '{}',
  }).then(responseJSON).then(() => undefined);
}

export function syncCalendar(): Promise<CalendarSyncSummary> {
  return fetch('/api/calendar/sync', {
    method: 'POST',
    headers: mutationHeaders,
    body: '{}',
  }).then(responseJSON<CalendarSyncSummary>);
}

export function resolveCalendarConflict(id: string, strategy: 'local' | 'remote'): Promise<void> {
  return fetch(`/api/calendar/conflicts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: mutationHeaders,
    body: JSON.stringify({ strategy }),
  }).then((response) => {
    if (response.ok) return;
    return responseJSON(response);
  }) as Promise<void>;
}

export function updateCalendarEvent(id: string, update: EventUpdate): Promise<EventRecord> {
  return fetch(`/api/events/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: mutationHeaders,
    body: JSON.stringify(update),
  }).then(responseJSON<EventRecord>);
}
