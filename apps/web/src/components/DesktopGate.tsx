import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Spinner } from '@whiteboard/ui';
import { Navigate, Outlet, useLocation } from 'react-router';

import { FullScreenSpinner } from '../auth/guards';
import { getHostUrl, setHostUrl, setToken } from '../lib/api';
import { desktopBridge, type DesktopBridge, type DesktopMode } from '../lib/desktop';
import { AuthShell, FormError } from './AuthShell';

/**
 * Wraps every page. In a browser it does nothing. In the desktop app it asks once whether this PC
 * is the Host or connects to one, and in Host mode waits until this PC's Host server answers.
 */
export function DesktopGate() {
  const bridge = desktopBridge();
  return bridge ? <DesktopStart bridge={bridge} /> : <Outlet />;
}

/** The desktop bridge rejects with a plain string. */
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

function DesktopStart({ bridge }: { bridge: DesktopBridge }) {
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const mode = useQuery({
    queryKey: ['desktop', 'mode'],
    queryFn: () => bridge.getMode(),
    staleTime: Infinity,
  });
  const host = useQuery({
    queryKey: ['desktop', 'host'],
    queryFn: async () => {
      const url = await bridge.startHost();
      if (url !== getHostUrl()) {
        setToken(null); // a session belongs to one Host
        setHostUrl(url);
      }
      return url;
    },
    enabled: mode.data === 'host',
    staleTime: Infinity,
    retry: false,
  });
  const choose = useMutation({
    mutationFn: (choice: DesktopMode) => bridge.setMode(choice),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['desktop', 'mode'] }),
  });

  if (mode.isPending) return <FullScreenSpinner />;

  if (!mode.data) {
    return (
      <AuthShell
        title="Welcome to Whiteboard"
        subtitle="One office PC is the Host: it stores everyone's projects and files."
      >
        <div className="flex flex-col gap-2">
          <Button
            onClick={() => choose.mutate('host')}
            loading={choose.isPending && choose.variables === 'host'}
            disabled={choose.isPending}
          >
            Set up this PC as the Host
          </Button>
          <p className="mb-4 text-sm text-muted">
            Choose this on one PC that stays on while people work.
          </p>
          <Button
            variant="secondary"
            onClick={() => choose.mutate('client')}
            loading={choose.isPending && choose.variables === 'client'}
            disabled={choose.isPending}
          >
            Connect to the office Host
          </Button>
          <p className="text-sm text-muted">Choose this on every other PC.</p>
          <FormError message={choose.error ? reason(choose.error) : null} />
        </div>
      </AuthShell>
    );
  }

  if (mode.data === 'host') {
    if (host.isPending) {
      return (
        <AuthShell title="Starting the Host" subtitle="This takes a few seconds.">
          <div className="flex justify-center text-muted">
            <Spinner />
          </div>
        </AuthShell>
      );
    }
    if (host.isError) {
      return (
        <AuthShell title="The Host did not start">
          <div className="flex flex-col gap-4">
            <FormError message={reason(host.error)} />
            <Button onClick={() => void host.refetch()}>Try again</Button>
          </div>
        </AuthShell>
      );
    }
  }

  if (mode.data === 'client' && !getHostUrl() && pathname !== '/connect') {
    return <Navigate to="/connect" replace />;
  }
  return <Outlet />;
}
