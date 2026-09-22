import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, RotateCcw } from 'lucide-react';

import styles from './TodayScreen.module.css';

import { getToday, updateTask } from '@/api';
import { CaptureComposer } from '@/components/CaptureComposer';
import { SectionHeading } from '@/components/SectionHeading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { CaptureRecord, EventRecord, TaskRecord, TaskUpdate, TodayView } from '@/types';

interface TodayScreenProps {
  captures: CaptureRecord[];
  inboxCount: number;
  onCaptureCreated(record: CaptureRecord): void;
  onNavigate(path: string): void;
}

interface TimelineItem {
  id: string;
  kind: 'event' | 'task';
  title: string;
  at?: string;
  allDay: boolean;
  place?: string;
  task?: TaskRecord;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

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

function dateKey(value: string, timeZone: string): string {
  const parts = dateParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
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

function formatTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function formatDay(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(`${date}T12:00:00`));
}

function taskUpdate(task: TaskRecord, changes: Partial<TaskUpdate> = {}): TaskUpdate {
  return {
    title: task.title,
    due_at: task.due_at,
    due_date: task.due_date,
    reminder_at: task.reminder_at,
    all_day: task.all_day,
    place: task.place,
    status: task.status,
    completed_at: task.completed_at,
    deferred_until_date: task.deferred_until_date,
    ...changes,
  };
}

function MetadataLabel({ children }: { children: React.ReactNode }) {
  return <span className={styles.metadataLabel}>{children}</span>;
}

function RecentCaptures({ captures }: { captures: CaptureRecord[] }) {
  if (captures.length === 0) return null;
  return (
    <Card className={styles.recentCaptures}>
      <SectionHeading>Recently captured</SectionHeading>
      <ul className={styles.captureList}>
        {captures.map((record) => {
          const metadata = [record.display_when, record.place ? `at ${record.place}` : undefined, record.subject].filter(Boolean).join(' · ') || 'Saved without a schedule';
          return (
            <li className={styles.captureRecord} key={record.id}>
              <div className={styles.captureRecordTitle}>{record.subject ? `${record.subject}: ${record.title}` : record.title || record.raw_text}</div>
              <div className={styles.captureRecordMeta}>{metadata}</div>
              <Badge variant="secondary">{record.kind}</Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function TaskEditor({ task, timeZone, onCancel, onSave, saving }: {
  task: TaskRecord;
  timeZone: string;
  onCancel(): void;
  onSave(update: TaskUpdate): void;
  saving: boolean;
}) {
  const [title, setTitle] = useState(task.title);
  const [dueAt, setDueAt] = useState(localDateTime(task.due_at, timeZone));
  const [dueDate, setDueDate] = useState(task.due_date ?? '');
  const [reminderAt, setReminderAt] = useState(localDateTime(task.reminder_at, timeZone));
  const [place, setPlace] = useState(task.place ?? '');

  return (
    <div className={styles.taskEditor}>
      <label><span>Task</span><Input value={title} onChange={(event) => setTitle(event.currentTarget.value)} /></label>
      <label><span>Due time · {timeZone}</span><Input type="datetime-local" value={dueAt} onChange={(event) => { setDueAt(event.currentTarget.value); if (event.currentTarget.value) setDueDate(''); }} /></label>
      <label><span>All-day due date</span><Input type="date" value={dueDate} onChange={(event) => { setDueDate(event.currentTarget.value); if (event.currentTarget.value) setDueAt(''); }} /></label>
      <label><span>Notify at · {timeZone}</span><Input type="datetime-local" value={reminderAt} onChange={(event) => setReminderAt(event.currentTarget.value)} /></label>
      <label><span>Place</span><Input value={place} onChange={(event) => setPlace(event.currentTarget.value)} /></label>
      <div className={styles.editorActions}>
        <Button size="sm" onClick={() => onSave(taskUpdate(task, {
          title: title.trim(),
          due_at: zonedDateTime(dueAt, timeZone),
          due_date: dueDate || undefined,
          reminder_at: zonedDateTime(reminderAt, timeZone),
          all_day: Boolean(dueDate),
          place: place.trim() || undefined,
        }))} disabled={saving || !title.trim()}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </div>
  );
}

function TaskActions({ task, selectedDate, pending, onEdit, onChange }: {
  task: TaskRecord;
  selectedDate: string;
  pending: boolean;
  onEdit(): void;
  onChange(task: TaskRecord, update: TaskUpdate, message: string): void;
}) {
  const completed = task.status === 'completed';
  return (
    <div className={styles.taskActions}>
      <Button size="sm" variant="ghost" onClick={() => onChange(task, taskUpdate(task, {
        status: completed ? 'open' : 'completed',
        completed_at: completed ? undefined : task.completed_at,
      }), completed ? 'Task reopened' : 'Task completed')} disabled={pending}>
        {completed ? 'Reopen' : 'Complete'}
      </Button>
      {!completed ? <Button size="sm" variant="ghost" onClick={() => onChange(task, taskUpdate(task, { deferred_until_date: addDays(selectedDate, 1) }), 'Task deferred one day')} disabled={pending}>Defer</Button> : null}
      <Button size="icon-sm" variant="ghost" onClick={onEdit} disabled={pending} aria-label={`Edit ${task.title}`}><Pencil /></Button>
    </div>
  );
}

function TaskRow({ task, selectedDate, timeZone, pending, onChange }: {
  task: TaskRecord;
  selectedDate: string;
  timeZone: string;
  pending: boolean;
  onChange(task: TaskRecord, update: TaskUpdate, message: string): void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <li className={styles.taskEditRow}><TaskEditor task={task} timeZone={timeZone} saving={pending} onCancel={() => setEditing(false)} onSave={(update) => { onChange(task, update, 'Task updated'); setEditing(false); }} /></li>;
  }
  const detail = task.overdue ? 'Overdue' : task.deferred_until_date === selectedDate ? 'Deferred to today' : task.place || (task.due_date ? 'All day' : 'Unscheduled');
  return (
    <li className={task.status === 'completed' ? `${styles.task} ${styles.taskDone}` : styles.task}>
      <button className={styles.taskCheck} type="button" aria-label={`${task.status === 'completed' ? 'Reopen' : 'Complete'} ${task.title}`} onClick={() => onChange(task, taskUpdate(task, { status: task.status === 'completed' ? 'open' : 'completed', completed_at: undefined }), task.status === 'completed' ? 'Task reopened' : 'Task completed')} disabled={pending}>{task.status === 'completed' ? <span>✓</span> : null}</button>
      <div><strong>{task.title}</strong><small>{detail}</small></div>
      <Badge variant={task.overdue ? 'destructive' : 'outline'}>{task.status === 'completed' ? 'done' : task.overdue ? 'overdue' : 'task'}</Badge>
      <TaskActions task={task} selectedDate={selectedDate} pending={pending} onEdit={() => setEditing(true)} onChange={onChange} />
    </li>
  );
}

function DateHeader({ date, isToday, onChange }: { date: string; isToday: boolean; onChange(date: string): void }) {
  const eyebrow = formatDay(date, { weekday: 'long', month: 'long', day: 'numeric' });
  const compact = formatDay(date, { month: 'short', day: 'numeric' }).toUpperCase();
  return (
    <header className={styles.pageHeader}>
      <div><p>{eyebrow}</p><h1>{isToday ? 'Today' : formatDay(date, { weekday: 'long' })}</h1></div>
      <div className={styles.dateSwitcher} aria-label="Change date">
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Previous day" onClick={() => onChange(addDays(date, -1))}><ChevronLeft /></Button></TooltipTrigger><TooltipContent>Previous day</TooltipContent></Tooltip>
        <MetadataLabel>{compact}</MetadataLabel>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Next day" onClick={() => onChange(addDays(date, 1))}><ChevronRight /></Button></TooltipTrigger><TooltipContent>Next day</TooltipContent></Tooltip>
      </div>
    </header>
  );
}

function TimelineRow({ item, timeZone, selectedDate, pending, onChange }: {
  item: TimelineItem;
  timeZone: string;
  selectedDate: string;
  pending: boolean;
  onChange(task: TaskRecord, update: TaskUpdate, message: string): void;
}) {
  const [editing, setEditing] = useState(false);
  if (item.task && editing) {
    return (
      <div className={styles.timelineEditRow}>
        <TaskEditor
          task={item.task}
          timeZone={timeZone}
          saving={pending}
          onCancel={() => setEditing(false)}
          onSave={(update) => {
            onChange(item.task as TaskRecord, update, 'Task updated');
            setEditing(false);
          }}
        />
      </div>
    );
  }
  return (
    <article className={styles.timelineRow}>
      <time>{item.at ? formatTime(item.at, timeZone) : 'All day'}</time>
      <span className={styles.recordMark} aria-hidden="true" />
      <div><strong>{item.title}</strong><small>{[item.kind === 'task' ? 'Reminder' : 'Event', item.place].filter(Boolean).join(' · ')}</small></div>
      <Badge variant="outline">{item.task?.status === 'completed' ? 'done' : item.kind}</Badge>
      {item.task ? <TaskActions task={item.task} selectedDate={selectedDate} pending={pending} onEdit={() => setEditing(true)} onChange={onChange} /> : null}
    </article>
  );
}

function Timeline({ items, timeZone, selectedDate, pendingIDs, onChange }: {
  items: TimelineItem[];
  timeZone: string;
  selectedDate: string;
  pendingIDs: Set<string>;
  onChange(task: TaskRecord, update: TaskUpdate, message: string): void;
}) {
  return (
    <Card className={`${styles.timeline} ${styles.sectionCard}`}>
      <SectionHeading>Schedule · {timeZone}</SectionHeading>
      {items.length === 0 ? <p className={styles.emptyState}>No scheduled records.</p> : items.map((item) => (
        <TimelineRow
          item={item}
          timeZone={timeZone}
          selectedDate={selectedDate}
          pending={item.task ? pendingIDs.has(item.task.id) : false}
          onChange={onChange}
          key={`${item.kind}-${item.id}`}
        />
      ))}
    </Card>
  );
}

function RightRail({ upNext, timeZone, inboxCount, onNavigate }: { upNext: TimelineItem[]; timeZone: string; inboxCount: number; onNavigate(path: string): void }) {
  return (
    <aside className={styles.rightRail} aria-label="Today summary">
      <section><h2>Up next</h2>{upNext.length === 0 ? <p className={styles.railEmpty}>Nothing scheduled.</p> : upNext.map((item) => <div className={styles.railRow} key={`${item.kind}-${item.id}`}><MetadataLabel>{item.at ? formatTime(item.at, timeZone) : 'ALL DAY'}</MetadataLabel><div><strong>{item.title}</strong><small>{item.kind}</small></div></div>)}</section>
      <Separator />
      <section><h2>Inbox</h2><button className={styles.inboxSummary} type="button" onClick={() => onNavigate('/inbox')}><strong>{inboxCount}</strong><span>need filing</span><ChevronRight aria-hidden="true" /></button></section>
    </aside>
  );
}

export function TodayScreen({ captures, inboxCount, onCaptureCreated, onNavigate }: TodayScreenProps) {
  const [view, setView] = useState<TodayView | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [todayDate, setTodayDate] = useState('');
  const [reload, setReload] = useState(0);
  const [pendingIDs, setPendingIDs] = useState(new Set<string>());
  const [error, setError] = useState('');
  const [undo, setUndo] = useState<{ task: TaskRecord; message: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void getToday(selectedDate || undefined, controller.signal)
      .then((result) => {
        setView(result);
        if (!selectedDate) {
          setSelectedDate(result.date);
          setTodayDate(result.date);
        }
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'Today could not be loaded');
      });
    return () => controller.abort();
  }, [reload, selectedDate]);

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!view) return [];
    const events: TimelineItem[] = view.events.map((event: EventRecord) => ({ id: event.id, kind: 'event', title: event.title, at: event.start_at, allDay: Boolean(event.all_day), place: event.place }));
    const tasks: TimelineItem[] = view.tasks.filter((task) => task.due_at && dateKey(task.due_at, view.timezone) === view.date && task.deferred_until_date !== view.date).map((task) => ({ id: task.id, kind: 'task', title: task.title, at: task.due_at, allDay: false, place: task.place, task }));
    return [...events, ...tasks].sort((left, right) => {
      if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
      return (left.at ?? '').localeCompare(right.at ?? '');
    });
  }, [view]);

  const anyTimeTasks = useMemo(() => {
    if (!view) return [];
    const scheduled = new Set(timeline.filter((item) => item.task).map((item) => item.id));
    return view.tasks.filter((task) => !scheduled.has(task.id));
  }, [timeline, view]);

  const upNext = useMemo(() => {
    if (!view) return [];
    const now = Date.now();
    return timeline.filter((item) => selectedDate !== todayDate || item.allDay || !item.at || new Date(item.at).getTime() >= now).slice(0, 3);
  }, [selectedDate, timeline, todayDate, view]);

  async function changeTask(task: TaskRecord, update: TaskUpdate, message: string) {
    setPendingIDs((items) => new Set(items).add(task.id));
    setError('');
    try {
      await updateTask(task.id, update);
      setUndo({ task, message });
      setReload((value) => value + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Task could not be updated');
    } finally {
      setPendingIDs((items) => { const next = new Set(items); next.delete(task.id); return next; });
    }
  }

  async function undoLastAction() {
    if (!undo) return;
    const previous = undo.task;
    setUndo(null);
    setPendingIDs((items) => new Set(items).add(previous.id));
    setError('');
    try {
      await updateTask(previous.id, taskUpdate(previous));
      setReload((value) => value + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Task action could not be undone');
    } finally {
      setPendingIDs((items) => { const next = new Set(items); next.delete(previous.id); return next; });
    }
  }

  const activeDate = view?.date || selectedDate;
  return (
    <>
      {activeDate ? <DateHeader date={activeDate} isToday={activeDate === todayDate} onChange={setSelectedDate} /> : null}
      <CaptureComposer onCreated={(record) => { onCaptureCreated(record); setReload((value) => value + 1); }} />
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {undo ? <div className={styles.undoBar} role="status"><span>{undo.message}</span><Button size="sm" variant="ghost" onClick={() => void undoLastAction()}><RotateCcw />Undo</Button></div> : null}
      <RecentCaptures captures={captures} />
      {view && activeDate ? <>
        <Timeline items={timeline} timeZone={view.timezone} selectedDate={activeDate} pendingIDs={pendingIDs} onChange={(task, update, message) => void changeTask(task, update, message)} />
        <Card className={`${styles.tasks} ${styles.sectionCard}`}>
          <SectionHeading>Any time {activeDate === todayDate ? 'today' : formatDay(activeDate, { weekday: 'long' })}</SectionHeading>
          {anyTimeTasks.length === 0 ? <p className={styles.emptyState}>No open tasks.</p> : <ul>{anyTimeTasks.map((task) => <TaskRow key={task.id} task={task} selectedDate={activeDate} timeZone={view.timezone} pending={pendingIDs.has(task.id)} onChange={(record, update, message) => void changeTask(record, update, message)} />)}</ul>}
        </Card>
      </> : <p className={styles.emptyState}>Loading Today…</p>}
      {view ? <RightRail upNext={upNext} timeZone={view.timezone} inboxCount={inboxCount} onNavigate={onNavigate} /> : null}
    </>
  );
}
