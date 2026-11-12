import { useQuery } from '@tanstack/react-query';
import { hostInfoSchema } from '@whiteboard/core';
import { Spinner } from '@whiteboard/ui';
import { Link, Navigate, Outlet, useLocation } from 'react-router';

import { api } from '../lib/api';
import { useAuth } from './AuthProvider';

export function useHostInfo() {
  return useQuery({
    queryKey: ['host-info'],
    queryFn: () => api('/host/info', { schema: hostInfoSchema }),
  });
}

function FullScreenSpinner() {
  return (
    <div className="grid min-h-screen place-items-center text-muted">
      <Spinner />
    </div>
  );
}

function HostUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <h1 className="text-lg font-semibold">Cannot reach the Host</h1>
        <p className="text-sm text-muted">
          Check that the Host PC is on and that you are on the office network.
        </p>
        <div className="flex gap-4 text-sm">
          <button className="text-accent underline" onClick={onRetry}>
            Try again
          </button>
          <Link to="/connect" className="text-accent underline">
            Use a different Host
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Public pages (setup, login): redirects away when they no longer apply. */
export function PublicOnly({ page }: { page: 'setup' | 'login' | 'join' }) {
  const host = useHostInfo();
  const { user } = useAuth();
  if (host.isPending) return <FullScreenSpinner />;
  if (host.isError) return <HostUnreachable onRetry={() => void host.refetch()} />;
  if (page === 'setup' && host.data.setupDone) return <Navigate to="/login" replace />;
  if (page !== 'setup' && !host.data.setupDone) return <Navigate to="/setup" replace />;
  if (user === undefined) return <FullScreenSpinner />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Everything behind sign-in. */
export function RequireAuth() {
  const location = useLocation();
  const host = useHostInfo();
  const { user } = useAuth();
  if (host.isPending) return <FullScreenSpinner />;
  if (host.isError) return <HostUnreachable onRetry={() => void host.refetch()} />;
  if (!host.data.setupDone) return <Navigate to="/setup" replace />;
  if (user === undefined) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  // An admin-set password must be replaced before anything else.
  const onChangePage = location.pathname === '/change-password';
  if (user.mustChangePassword && !onChangePage) return <Navigate to="/change-password" replace />;
  if (!user.mustChangePassword && onChangePage) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Pages for owners and admins only (members, invites). Others go Home. */
export function RequireAdmin() {
  const { user } = useAuth();
  if (user?.role !== 'owner' && user?.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}
