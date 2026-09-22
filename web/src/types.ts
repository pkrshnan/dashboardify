export type CaptureKind = 'reminder' | 'event' | 'note' | 'pending';

export interface CaptureHighlight {
  start: number;
  end: number;
  kind: 'intent' | 'time' | 'date' | 'place';
  label: string;
}

export interface CaptureProposal {
  kind: Exclude<CaptureKind, 'pending'>;
  title: string;
  scheduled_at?: string;
  scheduled_date?: string;
  scheduled_timezone?: string;
  all_day?: boolean;
  display_when?: string;
  place?: string;
  highlights: CaptureHighlight[];
}

export interface CaptureRecord {
  id: string;
  raw_text: string;
  kind: CaptureKind;
  title: string;
  scheduled_at?: string;
  scheduled_date?: string;
  scheduled_timezone?: string;
  all_day?: boolean;
  display_when?: string;
  place?: string;
  state: 'pending' | 'resolved';
  captured_at: string;
}
