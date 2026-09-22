import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Inbox,
  LayoutDashboard,
  MoreHorizontal,
  NotebookText,
  Settings,
  Users,
} from 'lucide-react';

import { listCaptures } from '@/api';
import { CaptureComposer } from '@/components/CaptureComposer';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { CaptureRecord } from '@/types';

const navigation = [
  { label: 'Today', icon: LayoutDashboard, active: true },
  { label: 'Inbox', icon: Inbox, count: 3 },
  { label: 'Calendar', icon: CalendarDays },
  { label: 'Notes', icon: NotebookText },
  { label: 'People', icon: Users },
  { label: 'Habits', icon: Activity },
];

const schedule = [
  { time: '09:30', title: 'Design review', detail: 'Work · Video call · 45 min', kind: 'event' },
  { time: '12:00', title: 'Renew passport', detail: 'Reminder · At home', kind: 'task' },
  { time: '18:00', title: 'Gym', detail: 'Upper body · 2 of 3 this week', kind: 'habit' },
];

const initialTasks = [
  { id: 'water', title: 'Water plants', detail: 'Home', kind: 'task', done: false },
  { id: 'read', title: 'Read for 30 minutes', detail: 'Weekly goal', kind: 'habit', done: false },
  { id: 'vitamins', title: 'Take vitamins', detail: 'Completed at 08:12', kind: 'done', done: true },
];

function MetadataLabel({ children }: { children: React.ReactNode }) {
  return <span className="metadata-label">{children}</span>;
}

function RecentCaptures({ captures }: { captures: CaptureRecord[] }) {
  if (captures.length === 0) return null;
  return (
    <Card className="recent-captures">
      <SectionHeading>Recently captured</SectionHeading>
      <ul className="capture-list">
        {captures.map((record) => {
          const metadata = [record.display_when, record.place ? `at ${record.place}` : undefined].filter(Boolean).join(' · ') || 'Saved without a schedule';
          return (
            <li className="capture-record" key={record.id}>
              <div className="capture-record-title">{record.title || record.raw_text}</div>
              <div className="capture-record-meta">{metadata}</div>
              <Badge variant="secondary">{record.kind}</Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="section-heading">
      <h2>{children}</h2>
      <Separator />
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="wordmark">
        <span className="wordmark-mark" aria-hidden="true"><i /><i /><i /><i /></span>
        Dashboardify
      </div>
      <nav className="sidebar-nav">
        {navigation.map(({ label, icon: Icon, active, count }) => (
          <Button className={active ? 'nav-button nav-button-active' : 'nav-button'} variant="ghost" key={label}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
            {count ? <Badge>{count}</Badge> : null}
          </Button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <Button className="nav-button" variant="ghost"><Settings aria-hidden="true" /><span>Settings</span></Button>
        <Separator />
        <div className="profile">
          <Avatar size="sm"><AvatarFallback>PK</AvatarFallback></Avatar>
          <span>Personal space</span>
        </div>
      </div>
    </aside>
  );
}

function DateHeader() {
  const today = useMemo(() => new Date(), []);
  const eyebrow = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(today);
  const compact = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(today).toUpperCase();
  return (
    <header className="page-header">
      <div>
        <p>{eyebrow}</p>
        <h1>Today</h1>
      </div>
      <div className="date-switcher" aria-label="Change date">
        <Tooltip>
          <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Previous day"><ChevronLeft /></Button></TooltipTrigger>
          <TooltipContent>Previous day</TooltipContent>
        </Tooltip>
        <MetadataLabel>{compact}</MetadataLabel>
        <Tooltip>
          <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Next day"><ChevronRight /></Button></TooltipTrigger>
          <TooltipContent>Next day</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

function Timeline() {
  return (
    <Card className="timeline section-card">
      <SectionHeading>Schedule</SectionHeading>
      {schedule.map((item, index) => (
        <div key={item.title}>
          {index === 2 ? <div className="now-row"><MetadataLabel>Now</MetadataLabel><span className="now-dot" aria-hidden="true" /><span className="now-line" aria-hidden="true" /></div> : null}
          <article className="timeline-row">
            <time>{item.time}</time>
            <span className="record-mark" aria-hidden="true" />
            <div><strong>{item.title}</strong><small>{item.detail}</small></div>
            <Badge variant="outline">{item.kind}</Badge>
          </article>
        </div>
      ))}
    </Card>
  );
}

function TaskList() {
  const [tasks, setTasks] = useState(initialTasks);
  return (
    <Card className="tasks section-card">
      <SectionHeading>Any time today</SectionHeading>
      <ul>
        {tasks.map((task) => (
          <li className={task.done ? 'task task-done' : 'task'} key={task.id}>
            <button
              className="task-check"
              type="button"
              aria-label={`${task.done ? 'Mark' : 'Complete'} ${task.title}${task.done ? ' incomplete' : ''}`}
              onClick={() => setTasks((items) => items.map((item) => item.id === task.id ? { ...item, done: !item.done } : item))}
            >
              {task.done ? <span>✓</span> : null}
            </button>
            <div><strong>{task.title}</strong><small>{task.detail}</small></div>
            <Badge variant="outline">{task.done ? 'done' : task.kind}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RightRail() {
  return (
    <aside className="right-rail" aria-label="Today summary">
      <section>
        <h2>Up next</h2>
        {schedule.map((item) => (
          <div className="rail-row" key={item.title}>
            <MetadataLabel>{item.time}</MetadataLabel>
            <div><strong>{item.title}</strong><small>{item.detail.split(' · ').at(-1)}</small></div>
          </div>
        ))}
      </section>
      <Separator />
      <section>
        <h2>This week</h2>
        <div className="rail-row"><MetadataLabel>GYM</MetadataLabel><div><strong>2 of 3</strong><small>One session left</small></div></div>
        <div className="rail-row"><MetadataLabel>READ</MetadataLabel><div><strong>4 of 5</strong><small>120 minutes</small></div></div>
      </section>
      <Separator />
      <section>
        <h2>Inbox</h2>
        <div className="inbox-summary"><strong>3</strong><span>need filing</span><ChevronRight aria-hidden="true" /></div>
      </section>
    </aside>
  );
}

function MobileNavigation() {
  const mobileItems = [navigation[0], navigation[1], navigation[2], { label: 'More', icon: MoreHorizontal }];
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {mobileItems.map(({ label, icon: Icon, active }) => (
        <button className={active ? 'mobile-nav-active' : ''} type="button" key={label}>
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function App() {
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void listCaptures(controller.signal).then(setCaptures).catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <TooltipProvider>
      <a className="skip-link" href="#main">Skip to main content</a>
      <div className="app-shell">
        <Sidebar />
        <main className="main" id="main">
          <div className="main-inner">
            <DateHeader />
            <CaptureComposer onCreated={(record) => setCaptures((items) => [record, ...items.filter((item) => item.id !== record.id)])} />
            <RecentCaptures captures={captures} />
            <Timeline />
            <TaskList />
          </div>
        </main>
        <RightRail />
      </div>
      <MobileNavigation />
    </TooltipProvider>
  );
}
