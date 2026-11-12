import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';

import { AuthProvider } from './auth/AuthProvider';
import { routes as defaultRoutes } from './routes';

/** Providers shared by the app and by tests. */
export function Providers({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [fallback] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } }),
  );
  return (
    <QueryClientProvider client={client ?? fallback}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

export function App({ routes = defaultRoutes }: { routes?: RouteObject[] }) {
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  );
}
