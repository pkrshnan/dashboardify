import { useEffect, useState } from 'react';

import shellStyles from './AppShell.module.css';
import {
  Activity,
  CalendarDays,
  Inbox,
  LayoutDashboard,
  MoreHorizontal,
  NotebookText,
  Settings,
  Users,
} from 'lucide-react';

import { listCaptures, listInbox } from '@/api';
import { CalendarScreen } from '@/components/CalendarScreen';
import { InboxScreen } from '@/components/InboxScreen';
import { TodayScreen } from '@/components/TodayScreen';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { CaptureRecord } from '@/types';

const navigation = [
  { label: 'Today', icon: LayoutDashboard, path: '/' },
  { label: 'Inbox', icon: Inbox, path: '/inbox' },
  { label: 'Calendar', icon: CalendarDays, path: '/calendar' },
  { label: 'Notes', icon: NotebookText },
  { label: 'People', icon: Users },
  { label: 'Habits', icon: Activity },
];

function Sidebar({ route, inboxCount, onNavigate }: { route: string; inboxCount: number; onNavigate(path: string): void }) {
  return (
    <aside className={shellStyles.sidebar} aria-label="Primary navigation">
      <div className={shellStyles.wordmark}>
        <span className={shellStyles.wordmarkMark} aria-hidden="true"><i /><i /><i /><i /></span>
        Dashboardify
      </div>
      <nav className={shellStyles.sidebarNav}>
        {navigation.map(({ label, icon: Icon, path }) => {
          const active = path === route;
          return (
            <Button
              className={active ? `${shellStyles.navButton} ${shellStyles.navButtonActive}` : shellStyles.navButton}
              variant="ghost"
              key={label}
              disabled={!path}
              onClick={() => path && onNavigate(path)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {label === 'Inbox' && inboxCount > 0 ? <Badge>{inboxCount}</Badge> : null}
            </Button>
          );
        })}
      </nav>
      <div className={shellStyles.sidebarBottom}>
        <Button className={shellStyles.navButton} variant="ghost" disabled><Settings aria-hidden="true" /><span>Settings</span></Button>
        <Separator />
        <div className={shellStyles.profile}>
          <Avatar size="sm"><AvatarFallback>PK</AvatarFallback></Avatar>
          <span>Personal space</span>
        </div>
      </div>
    </aside>
  );
}


function MobileNavigation({ route, onNavigate }: { route: string; onNavigate(path: string): void }) {
  const mobileItems = [navigation[0], navigation[1], navigation[2], { label: 'More', icon: MoreHorizontal }];
  return (
    <nav className={shellStyles.mobileNav} aria-label="Mobile navigation">
      {mobileItems.map(({ label, icon: Icon, path }) => (
        <button
          className={path === route ? shellStyles.mobileNavActive : ''}
          type="button"
          key={label}
          disabled={!path}
          onClick={() => path && onNavigate(path)}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function App() {
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [route, setRoute] = useState(['/inbox', '/calendar'].includes(window.location.pathname) ? window.location.pathname : '/');

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([listCaptures(controller.signal), listInbox(controller.signal)])
      .then(([recent, inbox]) => {
        setCaptures(recent);
        setInboxCount(inbox.length);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const updateRoute = () => setRoute(['/inbox', '/calendar'].includes(window.location.pathname) ? window.location.pathname : '/');
    window.addEventListener('popstate', updateRoute);
    return () => window.removeEventListener('popstate', updateRoute);
  }, []);

  function navigate(path: string) {
    if (path === route) return;
    window.history.pushState(null, '', path);
    setRoute(path);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function captureChanged(record: CaptureRecord) {
    setCaptures((items) => [record, ...items.filter((item) => item.id !== record.id)]);
  }

  function captureCreated(record: CaptureRecord) {
    captureChanged(record);
    if (record.inbox_state === 'open') setInboxCount((count) => count + 1);
  }

  return (
    <TooltipProvider>
      <a className="skip-link" href="#main">Skip to main content</a>
      <div className={route === '/inbox' ? `${shellStyles.appShell} ${shellStyles.appShellWide}` : shellStyles.appShell}>
        <Sidebar route={route} inboxCount={inboxCount} onNavigate={navigate} />
        <main className={shellStyles.main} id="main">
          <div className={route === '/inbox' ? `${shellStyles.mainInner} ${shellStyles.mainInnerInbox}` : shellStyles.mainInner}>
            {route === '/inbox' ? (
              <InboxScreen onNavigate={navigate} onInboxCountChange={setInboxCount} onCaptureChange={captureChanged} />
            ) : route === '/calendar' ? (
              <CalendarScreen />
            ) : (
              <TodayScreen
                captures={captures}
                inboxCount={inboxCount}
                onCaptureCreated={captureCreated}
                onNavigate={navigate}
              />
            )}
          </div>
        </main>
      </div>
      <MobileNavigation route={route} onNavigate={navigate} />
    </TooltipProvider>
  );
}
