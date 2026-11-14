import { isAdminRole, type WorkspaceRole } from '@whiteboard/core';
import { Button, cn } from '@whiteboard/ui';
import { NavLink, Outlet } from 'react-router';

import { useAuth } from '../auth/AuthProvider';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { NotificationBell } from '../components/NotificationBell';
import { useLiveEvents } from '../lib/events';

/** `who`: everyone, staff (not freelancers, who never manage a project) or admins. */
const NAV = [
  { to: '/', label: 'Home', end: true, who: 'all' },
  { to: '/my-tasks', label: 'My tasks', end: false, who: 'all' },
  { to: '/projects', label: 'Projects', end: false, who: 'all' },
  { to: '/review-queue', label: 'Review queue', end: false, who: 'staff' },
  { to: '/members', label: 'Members', end: false, who: 'admin' },
  { to: '/settings', label: 'Settings', end: false, who: 'all' },
] as const;

const canSee = (who: (typeof NAV)[number]['who'], role: WorkspaceRole | undefined) =>
  who === 'all' || (who === 'staff' ? role !== 'guest' : isAdminRole(role));

/** App chrome: top bar with navigation and the signed-in user. */
export function AppLayout() {
  const { user, signOut } = useAuth();
  const live = useLiveEvents(!!user);
  return (
    <div className="min-h-screen">
      <ConnectionBanner status={live} />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <span className="font-semibold">Whiteboard</span>
          <nav aria-label="Main" className="flex gap-1">
            {NAV.filter((item) => canSee(item.who, user?.role)).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-sm',
                    isActive ? 'bg-surface-2 font-medium' : 'text-muted hover:text-text',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <NotificationBell />
            <span className="text-sm text-muted">{user?.name}</span>
            <Button variant="secondary" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl p-4">
        <Outlet />
      </div>
    </div>
  );
}
