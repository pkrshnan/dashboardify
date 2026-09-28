import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Pencil, RefreshCw, TriangleAlert } from 'lucide-react';

import styles from './CalendarScreen.module.css';

import {
  discoverCalendar,
  getCalendarStatus,
  getToday,
  listCalendarConflicts,
  resolveCalendarConflict,
  syncCalendar,
  updateCalendarEvent,
} from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { CalendarConflict, CalendarStatus, CalendarSyncSummary, EventRecord, EventUpdate, TodayView } from '@/types';

function dateParts(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function localDateTime(value: string | undefined, timeZone: string): string {
  if (!value) return '';
  const parts = dateParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function zonedDateTime(value: string, timeZone: string): string | undefined {
  if (!value) return undefined;
  const [date, clock] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = clock.split(':').map(Number);
  const intended = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = intended;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = dateParts(new Date(candidate).toISOString(), timeZone);
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    candidate -= represented - intended;
  }
  return new Date(candidate).toISOString();
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`));
}

function formatMoment(value: string | undefined): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatEventTime(event: EventRecord, timeZone: string): string {
  if (event.all_day) return 'All day';
  if (!event.start_at) return 'Unscheduled';
  return new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(event.start_at));
}

function formatPlace(value: string | undefined): string {
  if (!value) return '';
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join(' · ');
}

function eventUpdate(event: EventRecord, changes: Partial<EventUpdate> = {}): EventUpdate {
  return {
    title: event.title,
    start_at: event.start_at,
    end_at: event.end_at,
    start_date: event.start_date,
    end_date: event.end_date,
    all_day: event.all_day,
    timezone: event.timezone,
    place: formatPlace(event.place) || undefined,
    status: event.status,
    ...changes,
  };
}

function EventEditor({ event, timeZone, pending, onCancel, onSave }: {
  event: EventRecord;
  timeZone: string;
  pending: boolean;
  onCancel(): void;
  onSave(update: EventUpdate): void;
}) {
  const [title, setTitle] = useState(event.title);
  const [startAt, setStartAt] = useState(localDateTime(event.start_at, timeZone));
  const [endAt, setEndAt] = useState(localDateTime(event.end_at, timeZone));
  const [startDate, setStartDate] = useState(event.start_date ?? '');
  const [endDate, setEndDate] = useState(event.end_date ?? '');
  const [place, setPlace] = useState(formatPlace(event.place));

  return (
    <div className={styles.eventEditor}>
      <label><span>Event</span><Input value={title} onChange={(input) => setTitle(input.currentTarget.value)} /></label>
      {event.all_day ? (
        <>
          <label><span>Start date</span><Input type="date" value={startDate} onChange={(input) => setStartDate(input.currentTarget.value)} /></label>
          <label><span>End date</span><Input type="date" value={endDate} onChange={(input) => setEndDate(input.currentTarget.value)} /></label>
        </>
      ) : (
        <>
          <label><span>Starts · {timeZone}</span><Input type="datetime-local" value={startAt} onChange={(input) => setStartAt(input.currentTarget.value)} /></label>
          <label><span>Ends · {timeZone}</span><Input type="datetime-local" value={endAt} onChange={(input) => setEndAt(input.currentTarget.value)} /></label>
        </>
      )}
      <label className={styles.placeField}><span>Place</span><Input value={place} onChange={(input) => setPlace(input.currentTarget.value)} /></label>
      <div className={styles.editorActions}>
        <Button size="sm" disabled={pending || !title.trim()} onClick={() => onSave(eventUpdate(event, {
          title: title.trim(),
          start_at: event.all_day ? undefined : zonedDateTime(startAt, timeZone),
          end_at: event.all_day ? undefined : zonedDateTime(endAt, timeZone),
          start_date: event.all_day ? startDate : undefined,
          end_date: event.all_day ? endDate : undefined,
          place: place.trim() || undefined,
        }))}>Save</Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function EventRow({ event, timeZone, pending, onUpdate }: {
  event: EventRecord;
  timeZone: string;
  pending: boolean;
  onUpdate(event: EventRecord, update: EventUpdate): Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  if (editing && !event.read_only) {
    return <EventEditor event={event} timeZone={timeZone} pending={pending} onCancel={() => setEditing(false)} onSave={(update) => { void onUpdate(event, update).then(() => setEditing(false)); }} />;
  }
  const provider = event.provider === 'apple_calendar' ? 'Apple' : 'Dashboardify';
  return (
    <article className={styles.eventRow}>
      <time>{formatEventTime(event, timeZone)}</time>
      <span className={event.provider === 'apple_calendar' ? `${styles.eventMark} ${styles.appleMark}` : styles.eventMark} aria-hidden="true" />
      <div className={styles.eventDetails}><strong>{event.title}</strong><small>{[provider, formatPlace(event.place)].filter(Boolean).join(' · ')}</small></div>
      <Badge variant="outline">{provider}</Badge>
      {!event.read_only ? (
        <div className={styles.eventActions}>
          <Button size="icon-sm" variant="ghost" onClick={() => setEditing(true)} disabled={pending} aria-label={`Edit ${event.title}`}><Pencil /></Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => void onUpdate(event, eventUpdate(event, { status: 'cancelled' }))}>Cancel</Button>
        </div>
      ) : <span className={styles.readOnly}>Read only</span>}
    </article>
  );
}

function ConnectionCard({ status, pending, summary, onDiscover, onSync }: {
  status: CalendarStatus | null;
  pending: boolean;
  summary: CalendarSyncSummary | null;
  onDiscover(): void;
  onSync(): void;
}) {
  if (!status) return <Card className={styles.connectionCard}><p>Loading connection status…</p></Card>;
  if (!status.configured) {
    return (
      <Card className={styles.connectionCard}>
        <div className={styles.cardHeading}><div><span className={styles.eyebrow}>Apple Calendar</span><h2>Connect iCloud CalDAV</h2></div><Badge variant="outline">Not configured</Badge></div>
        <p>Create an Apple app-specific password, then add <code>DASHBOARDIFY_CALDAV_USERNAME</code> and <code>DASHBOARDIFY_CALDAV_PASSWORD</code> to the service environment and restart Dashboardify. Credentials never enter or leave this page.</p>
      </Card>
    );
  }
  return (
    <Card className={styles.connectionCard}>
      <div className={styles.cardHeading}>
        <div><span className={styles.eyebrow}>Apple Calendar</span><h2>{status.calendar_name || 'Dashboardify'}</h2></div>
        <Badge variant={status.state === 'error' ? 'destructive' : 'secondary'}>{status.state}</Badge>
      </div>
      <dl className={styles.statusGrid}>
        <div><dt>Last successful sync</dt><dd>{formatMoment(status.last_success_at)}</dd></div>
        <div><dt>Calendar</dt><dd>{status.calendar_path || 'Discovery required'}</dd></div>
        <div><dt>Conflicts</dt><dd>{status.conflict_count}</dd></div>
      </dl>
      {status.last_error ? <p className={styles.error}>{status.last_error}</p> : null}
      {summary ? <p className={styles.summary}>Synced: {summary.pulled} pulled, {summary.pushed} pushed, {summary.deleted} deleted, {summary.conflicts} conflicts.</p> : null}
      <div className={styles.connectionActions}>
        <Button variant="outline" disabled={pending} onClick={onDiscover}><CalendarClock />Discover</Button>
        <Button disabled={pending} onClick={onSync}><RefreshCw className={pending ? styles.spinning : ''} />Sync now</Button>
      </div>
    </Card>
  );
}

function ConflictList({ conflicts, pending, onResolve }: {
  conflicts: CalendarConflict[];
  pending: boolean;
  onResolve(id: string, strategy: 'local' | 'remote'): void;
}) {
  if (conflicts.length === 0) return null;
  return (
    <section className={styles.conflicts} aria-labelledby="calendar-conflicts">
      <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Needs review</span><h2 id="calendar-conflicts">Sync conflicts</h2></div><TriangleAlert aria-hidden="true" /></div>
      {conflicts.map((conflict) => (
        <Card className={styles.conflictCard} key={conflict.local_event_id}>
          <div><strong>{conflict.title}</strong><small>{conflict.kind.replaceAll('_', ' ')}</small></div>
          <div><Button size="sm" variant="outline" disabled={pending} onClick={() => onResolve(conflict.local_event_id, 'remote')}>Use Apple</Button><Button size="sm" disabled={pending} onClick={() => onResolve(conflict.local_event_id, 'local')}>Keep Dashboardify</Button></div>
        </Card>
      ))}
    </section>
  );
}

export function CalendarScreen() {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [conflicts, setConflicts] = useState<CalendarConflict[]>([]);
  const [view, setView] = useState<TodayView | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [pending, setPending] = useState(false);
  const [pendingEvents, setPendingEvents] = useState(new Set<string>());
  const [summary, setSummary] = useState<CalendarSyncSummary | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (date?: string, signal?: AbortSignal) => {
    const [nextStatus, nextConflicts, nextView] = await Promise.all([
      getCalendarStatus(signal),
      listCalendarConflicts(signal),
      getToday(date, signal),
    ]);
    setStatus(nextStatus);
    setConflicts(nextConflicts);
    setView(nextView);
    if (!date) setSelectedDate(nextView.date);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void load(selectedDate || undefined, controller.signal).catch((requestError) => {
      if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'Calendar could not be loaded');
    });
    return () => controller.abort();
  }, [load, selectedDate]);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError('');
    try {
      await action();
      await load(selectedDate || undefined);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Calendar request failed');
    } finally {
      setPending(false);
    }
  }

  async function updateEvent(event: EventRecord, update: EventUpdate) {
    setPendingEvents((current) => new Set(current).add(event.id));
    setError('');
    try {
      await updateCalendarEvent(event.id, update);
      await load(selectedDate || undefined);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Event update failed');
      throw requestError;
    } finally {
      setPendingEvents((current) => {
        const next = new Set(current);
        next.delete(event.id);
        return next;
      });
    }
  }

  const events = useMemo(() => view?.events.filter((event) => event.status !== 'cancelled') ?? [], [view]);

  return (
    <div className={styles.calendarPage}>
      <header className={styles.pageHeader}><div><p>Two-way CalDAV</p><h1>Calendar</h1></div></header>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <ConnectionCard status={status} pending={pending} summary={summary} onDiscover={() => void run(discoverCalendar)} onSync={() => void run(async () => setSummary(await syncCalendar()))} />
      <ConflictList conflicts={conflicts} pending={pending} onResolve={(id, strategy) => void run(() => resolveCalendarConflict(id, strategy))} />
      <section className={styles.agenda} aria-labelledby="calendar-agenda">
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Agenda</span><h2 id="calendar-agenda">{selectedDate ? formatDate(selectedDate) : 'Today'}</h2></div>
          <div className={styles.dateActions}><Button size="icon" variant="ghost" aria-label="Previous day" onClick={() => setSelectedDate(addDays(selectedDate, -1))}><ChevronLeft /></Button><Button size="icon" variant="ghost" aria-label="Next day" onClick={() => setSelectedDate(addDays(selectedDate, 1))}><ChevronRight /></Button></div>
        </div>
        {events.length === 0 ? <p className={styles.empty}>No events on this day.</p> : events.map((event) => <EventRow key={`${event.provider || 'dashboardify'}-${event.id}`} event={event} timeZone={view?.timezone || 'UTC'} pending={pendingEvents.has(event.id)} onUpdate={updateEvent} />)}
      </section>
    </div>
  );
}
