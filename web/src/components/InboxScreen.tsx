import { useEffect, useState } from 'react';
import { ArrowLeft, History, Inbox } from 'lucide-react';

import styles from './InboxScreen.module.css';

import { captureDetail, classifyCapture, listCaptures, listInbox } from '@/api';
import { SectionHeading } from '@/components/SectionHeading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CaptureDetail, CaptureKind, CaptureRecord, ClassificationInput } from '@/types';

const filingKinds: Array<Exclude<CaptureKind, 'pending'>> = ['reminder', 'event', 'note', 'fact', 'activity'];

function localDateTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function ReviewCard({ record, onFiled }: { record: CaptureRecord; onFiled(record: CaptureRecord): void }) {
  const [open, setOpen] = useState(record.inbox_state === 'open');
  const [kind, setKind] = useState<Exclude<CaptureKind, 'pending'>>(record.kind === 'pending' ? 'note' : record.kind);
  const [title, setTitle] = useState(record.title || record.raw_text);
  const [subject, setSubject] = useState(record.subject ?? '');
  const [scheduledAt, setScheduledAt] = useState(localDateTime(record.scheduled_at));
  const [scheduledDate, setScheduledDate] = useState(record.scheduled_date ?? '');
  const [occurredDate, setOccurredDate] = useState(record.occurred_date ?? '');
  const [place, setPlace] = useState(record.place ?? '');
  const [detail, setDetail] = useState<CaptureDetail | null>(null);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || detail) return;
    const controller = new AbortController();
    void captureDetail(record.id, controller.signal).then(setDetail).catch(() => undefined);
    return () => controller.abort();
  }, [detail, open, record.id]);

  async function save() {
    setSaving(true);
    setStatus('Saving…');
    const classification: ClassificationInput = { kind, title, place };
    if (kind === 'fact') classification.subject = subject;
    if ((kind === 'event' || kind === 'reminder') && scheduledAt) {
      classification.scheduled_at = new Date(scheduledAt).toISOString();
    } else if ((kind === 'event' || kind === 'reminder') && scheduledDate) {
      classification.scheduled_date = scheduledDate;
      classification.all_day = true;
    }
    if (kind === 'activity') classification.occurred_date = occurredDate;
    try {
      const filed = await classifyCapture(record.id, classification);
      onFiled(filed);
      setStatus(`Filed as ${filed.kind}`);
      setOpen(false);
    } catch (requestError) {
      setStatus(requestError instanceof Error ? requestError.message : 'Capture could not be filed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className={styles.reviewCard}>
      <button className={styles.reviewSummary} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>
          <strong>{record.raw_text}</strong>
          <small>{new Date(record.captured_at).toLocaleString()}</small>
        </span>
        <Badge variant={record.inbox_state === 'open' ? 'default' : 'secondary'}>{record.kind}</Badge>
      </button>
      {open ? (
        <div className={styles.reviewBody}>
          <p className={styles.provenance}><strong>Original capture</strong> is preserved exactly as entered. Filing changes only its classification.</p>
          <div className={styles.reviewGrid}>
            <label>
              <span>Record type</span>
              <Select value={kind} onValueChange={(value) => setKind(value as Exclude<CaptureKind, 'pending'>)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {filingKinds.map((value) => <SelectItem value={value} key={value}>{value}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            {kind === 'fact' ? (
              <label><span>Subject</span><Input value={subject} onChange={(event) => setSubject(event.currentTarget.value)} placeholder="Sam" /></label>
            ) : null}
            <label className={styles.reviewTitle}><span>{kind === 'note' ? 'Body' : kind === 'fact' ? 'Statement' : 'Title'}</span><Input value={title} onChange={(event) => setTitle(event.currentTarget.value)} /></label>
            {kind === 'event' || kind === 'reminder' ? (
              <>
                <label><span>Date and time</span><Input type="datetime-local" value={scheduledAt} onChange={(event) => { setScheduledAt(event.currentTarget.value); if (event.currentTarget.value) setScheduledDate(''); }} /></label>
                <label><span>All-day date</span><Input type="date" value={scheduledDate} onChange={(event) => { setScheduledDate(event.currentTarget.value); if (event.currentTarget.value) setScheduledAt(''); }} /></label>
                <label><span>Place</span><Input value={place} onChange={(event) => setPlace(event.currentTarget.value)} /></label>
              </>
            ) : null}
            {kind === 'activity' ? (
              <label><span>Occurred on</span><Input type="date" value={occurredDate} onChange={(event) => setOccurredDate(event.currentTarget.value)} /></label>
            ) : null}
          </div>
          <div className={styles.reviewActions}>
            <Button type="button" onClick={() => void save()} disabled={saving || !title.trim()}>File capture</Button>
            <span role="status" aria-live="polite">{status}</span>
          </div>
          {detail && detail.history.length > 0 ? (
            <details className={styles.classificationHistory}>
              <summary><History aria-hidden="true" />Classification history</summary>
              <ol>
                {detail.history.map((item) => (
                  <li key={`${item.classified_at}-${item.kind}`}><Badge variant="outline">{item.kind}</Badge><span>{item.subject ? `${item.subject}: ` : ''}{item.title}</span><time>{new Date(item.classified_at).toLocaleString()}</time></li>
                ))}
              </ol>
            </details>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export function InboxScreen({
  onNavigate,
  onInboxCountChange,
}: {
  onNavigate(path: string): void;
  onInboxCountChange(count: number): void;
}) {
  const [openCaptures, setOpenCaptures] = useState<CaptureRecord[]>([]);
  const [recent, setRecent] = useState<CaptureRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([listInbox(controller.signal), listCaptures(controller.signal)])
      .then(([inbox, captures]) => {
        setOpenCaptures(inbox);
        setRecent(captures.filter((record) => record.inbox_state === 'filed'));
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    onInboxCountChange(openCaptures.length);
  }, [onInboxCountChange, openCaptures.length]);

  function replace(filed: CaptureRecord) {
    setOpenCaptures((items) => items.filter((item) => item.id !== filed.id));
    setRecent((items) => [filed, ...items.filter((item) => item.id !== filed.id)]);
  }

  return (
    <div className={styles.inboxScreen}>
      <header className={styles.inboxHeader}>
        <Button variant="ghost" size="icon" onClick={() => onNavigate('/')} aria-label="Back to Today"><ArrowLeft /></Button>
        <div><p>Capture review</p><h1>Inbox</h1></div>
      </header>
      <section className={styles.inboxSection}>
        <SectionHeading>Needs filing</SectionHeading>
        {loading ? <p className={styles.emptyState}>Loading captures…</p> : null}
        {!loading && openCaptures.length === 0 ? <div className={styles.emptyState}><Inbox aria-hidden="true" /><strong>Inbox zero</strong><span>Every capture has been filed.</span></div> : null}
        <div className={styles.reviewList}>{openCaptures.map((record) => <ReviewCard record={record} onFiled={replace} key={record.id} />)}</div>
      </section>
      {recent.length > 0 ? (
        <section className={styles.inboxSection}>
          <SectionHeading>Filed recently</SectionHeading>
          <p className={styles.sectionDescription}>Open any capture to correct its classification without changing the original text.</p>
          <div className={styles.reviewList}>{recent.map((record) => <ReviewCard record={record} onFiled={replace} key={record.id} />)}</div>
        </section>
      ) : null}
    </div>
  );
}
