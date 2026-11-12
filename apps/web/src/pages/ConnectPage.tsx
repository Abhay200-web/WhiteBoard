import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input } from '@whiteboard/ui';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { AuthShell, FormError } from '../components/AuthShell';
import { getHostUrl, setHostUrl, setToken } from '../lib/api';
import { discoverHosts, normalizeHostAddress, probeHost } from '../lib/hostAddress';

/** Choose which Host this PC talks to: discovered on the LAN, or typed by hand. */
export function ConnectPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const discovered = useQuery({ queryKey: ['discovered-hosts'], queryFn: discoverHosts });

  const connect = useMutation({
    mutationFn: async (url: string) => {
      try {
        await probeHost(url);
      } catch {
        throw new Error(
          `Could not find a Whiteboard Host at ${url}. Check the address and that the Host PC is on.`,
        );
      }
      return url;
    },
    onSuccess: async (url) => {
      if (url !== getHostUrl()) setToken(null); // a session belongs to one Host
      setHostUrl(url);
      queryClient.clear();
      void navigate('/', { replace: true });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = normalizeHostAddress(
      String(new FormData(event.currentTarget).get('address') ?? ''),
    );
    if (!url) return setFormError('Enter the Host address, for example 192.168.1.20');
    setFormError(null);
    connect.mutate(url);
  }

  return (
    <AuthShell
      title="Connect to a Host"
      subtitle="The Host is the office PC that stores your projects."
    >
      {discovered.data && discovered.data.length > 0 && (
        <section aria-label="Hosts found on this network" className="mb-6">
          <h2 className="mb-2 text-sm font-medium">Found on this network</h2>
          <ul className="flex flex-col gap-2">
            {discovered.data.map((host) => (
              <li key={host.url}>
                <Button
                  variant="secondary"
                  className="w-full justify-between"
                  onClick={() => connect.mutate(host.url)}
                  disabled={connect.isPending}
                >
                  <span>{host.name}</span>
                  <span className="text-muted">{host.url.replace(/^https?:\/\//, '')}</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Host address" hint="IP address or name of the Host PC, e.g. 192.168.1.20">
          <Input name="address" defaultValue={getHostUrl().replace(/^https?:\/\//, '')} autoFocus />
        </Field>
        <FormError message={formError ?? (connect.error ? connect.error.message : null)} />
        <Button type="submit" loading={connect.isPending}>
          Connect
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        <Link to="/" className="text-accent underline">
          Back
        </Link>
      </p>
    </AuthShell>
  );
}
