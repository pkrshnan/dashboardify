import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import styles from './CaptureComposer.module.css';

import { createCapture, previewCapture } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { CaptureHighlight, CaptureProposal, CaptureRecord } from '@/types';

interface CaptureComposerProps {
  onCreated(record: CaptureRecord): void;
}

const highlightStyles: Record<CaptureHighlight['kind'], string> = {
  intent: styles.captureTokenIntent,
  time: styles.captureTokenTime,
  date: styles.captureTokenDate,
  place: styles.captureTokenPlace,
};

function newRequestKey(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function HighlightedText({ text, highlights }: { text: string; highlights: CaptureHighlight[] }) {
  const characters = Array.from(text);
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const token of highlights) {
    if (token.start < cursor || token.end > characters.length || token.start >= token.end) continue;
    parts.push(characters.slice(cursor, token.start).join(''));
    parts.push(
      <mark className={`${styles.captureToken} ${highlightStyles[token.kind]}`} key={`${token.start}-${token.end}`} title={token.label}>
        {characters.slice(token.start, token.end).join('')}
      </mark>,
    );
    cursor = token.end;
  }
  parts.push(characters.slice(cursor).join(''));
  return parts;
}

function proposalDetail(proposal: CaptureProposal | null, previewFailed: boolean): string {
  if (previewFailed) return 'Intent preview unavailable; your text is still safe to submit';
  if (!proposal) return 'Unscheduled text is saved as a note';
  const details = [proposal.display_when, proposal.place ? `at ${proposal.place}` : undefined].filter(Boolean);
  if (details.length > 0) return details.join(' · ');
  return proposal.kind === 'note' ? 'Unscheduled text is saved as a note' : `${proposal.kind} without a scheduled time`;
}

export function CaptureComposer({ onCreated }: CaptureComposerProps) {
  const [text, setText] = useState('');
  const [proposal, setProposal] = useState<CaptureProposal | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const requestKey = useRef(newRequestKey());
  const input = useRef<HTMLTextAreaElement>(null);
  const highlights = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = '44px';
    element.style.height = `${Math.min(150, Math.max(44, element.scrollHeight))}px`;
  }, [text]);

  useEffect(() => {
    setPreviewFailed(false);
    setProposal(null);
    if (!text.trim()) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setProposal(await previewCapture(text, controller.signal));
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setPreviewFailed(true);
      }
    }, 80);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  useEffect(() => {
    function focusComposer(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      const editing = target?.matches('input, textarea, [contenteditable="true"]');
      if ((event.metaKey || event.ctrlKey) && key === 'k') {
        event.preventDefault();
        input.current?.focus();
      } else if (key === 'c' && !editing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        input.current?.focus();
      }
    }
    document.addEventListener('keydown', focusComposer);
    return () => document.removeEventListener('keydown', focusComposer);
  }, []);

  const intent = proposal?.kind ?? 'note';
  const activeHighlights = useMemo(() => proposal?.highlights ?? [], [proposal]);

  async function submit() {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(false);
    setStatus('Saving…');
    try {
      const record = await createCapture(text, requestKey.current);
      onCreated(record);
      setText('');
      setProposal(null);
      requestKey.current = newRequestKey();
      setStatus(`Saved as ${record.kind}`);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Capture could not be saved';
      setError(true);
      setStatus(`Not saved — ${message}`);
    } finally {
      setSaving(false);
      input.current?.focus();
    }
  }

  return (
    <Card className={styles.captureComposer}>
      <form
        className={styles.captureForm}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor="capture-text">Capture a reminder, event, or note</label>
        <div className={styles.captureEditor}>
          <div className={styles.captureHighlights} ref={highlights} aria-hidden="true">
            <HighlightedText text={text} highlights={activeHighlights} />
          </div>
          <Textarea
            id="capture-text"
            ref={input}
            className={styles.captureInput}
            value={text}
            maxLength={4096}
            rows={1}
            autoComplete="off"
            spellCheck
            placeholder={'Capture anything…  Try “Baseball at 2:30 on Wednesday”'}
            onChange={(event) => {
              setText(event.currentTarget.value);
              setStatus('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            onScroll={(event) => {
              if (highlights.current) highlights.current.scrollTop = event.currentTarget.scrollTop;
            }}
          />
        </div>
        <Button className={styles.captureSubmit} type="submit" disabled={saving || !text.trim()}>
          <span className={styles.captureSubmitLabel}>Save</span>
          <kbd aria-hidden="true">↵</kbd>
        </Button>
        <div className={styles.captureMeta}>
          <div className={styles.captureSignals}>
            <Badge variant={intent === 'note' ? 'secondary' : 'default'}>{intent}</Badge>
            <span className={styles.captureDetail}>{proposalDetail(proposal, previewFailed)}</span>
          </div>
          <span className={error ? `${styles.captureState} ${styles.captureStateError}` : styles.captureState} role="status" aria-live="polite">
            {status}
          </span>
        </div>
      </form>
    </Card>
  );
}
