import { cn } from '@whiteboard/ui';
import { NavLink, Outlet } from 'react-router';

import { useAuth } from '../auth/AuthProvider';

/** Settings shell: section nav on the left, the section on the right. */
export function SettingsLayout() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const sections = [
    { to: 'account', label: 'Account' },
    { to: 'connection', label: 'Connection' },
    ...(isAdmin ? [{ to: 'host', label: 'Host' }] : []),
  ];
  return (
    <div>
      <h1 className="text-xl font-semibold">Settings</h1>
      <div className="mt-6 grid gap-6 md:grid-cols-[12rem_1fr]">
        <nav aria-label="Settings sections" className="flex gap-1 md:flex-col">
          {sections.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-1.5 text-sm',
                  isActive ? 'bg-surface-2 font-medium' : 'text-muted hover:text-text',
                )
              }
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
        <section>
          <Outlet />
        </section>
      </div>
    </div>
  );
}
