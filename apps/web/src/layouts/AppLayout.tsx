import { Button, cn } from '@whiteboard/ui';
import { NavLink, Outlet } from 'react-router';

import { useAuth } from '../auth/AuthProvider';

const NAV = [
  { to: '/', label: 'Home', end: true, adminOnly: false },
  { to: '/projects', label: 'Projects', end: false, adminOnly: false },
  { to: '/members', label: 'Members', end: false, adminOnly: true },
  { to: '/settings', label: 'Settings', end: false, adminOnly: false },
];

/** App chrome: top bar with navigation and the signed-in user. */
export function AppLayout() {
  const { user, signOut } = useAuth();
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <span className="font-semibold">Whiteboard</span>
          <nav aria-label="Main" className="flex gap-1">
            {NAV.filter((item) => !item.adminOnly || isAdmin).map((item) => (
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
