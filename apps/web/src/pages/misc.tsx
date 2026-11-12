import { Link } from 'react-router';

import { useAuth } from '../auth/AuthProvider';

export function HomePage() {
  const { user } = useAuth();
  return (
    <div>
      <h1 className="text-xl font-semibold">Home</h1>
      <p className="mt-2 text-sm text-muted">
        Welcome, {user?.name}. Your projects will appear here.
      </p>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <Link to="/" className="mt-2 inline-block text-sm text-accent underline">
          Go home
        </Link>
      </div>
    </main>
  );
}
