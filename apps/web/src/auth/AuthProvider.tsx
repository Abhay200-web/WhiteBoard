import { useQuery, useQueryClient } from '@tanstack/react-query';
import { sessionUserSchema, type AuthResponse, type SessionUser } from '@whiteboard/core';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { api, getToken, onTokenChange, setToken } from '../lib/api';

interface AuthValue {
  /** `undefined` while loading, `null` when signed out. */
  user: SessionUser | null | undefined;
  /** Store the session returned by `/setup` or `/auth/sign-in`. */
  startSession: (response: AuthResponse) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const token = useSyncExternalStore(onTokenChange, getToken);

  const me = useQuery({
    queryKey: ['me', token],
    enabled: token !== null,
    queryFn: () => api('/auth/me', { schema: sessionUserSchema }),
    retry: false,
  });

  const startSession = useCallback(
    (response: AuthResponse) => {
      queryClient.setQueryData(['me', response.token], response.user);
      setToken(response.token);
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await api('/auth/sign-out', { method: 'POST' });
    } catch {
      /* already signed out or Host unreachable: still drop the local session */
    } finally {
      setToken(null);
      queryClient.clear();
    }
  }, [queryClient]);

  const value = useMemo<AuthValue>(() => {
    let user: SessionUser | null | undefined;
    if (token === null) user = null;
    else if (me.isPending) user = undefined;
    else user = me.data ?? null;
    return { user, startSession, signOut };
  }, [token, me.isPending, me.data, startSession, signOut]);

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
