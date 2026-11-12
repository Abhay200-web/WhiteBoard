import { AuthShell } from '../components/AuthShell';
import { ChangePasswordForm } from '../components/ChangePasswordForm';

/** Shown to anyone whose password was set by an admin, before they can use the app. */
export function ChangePasswordPage() {
  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Your password was set by an administrator. Pick one only you know."
    >
      <ChangePasswordForm />
    </AuthShell>
  );
}
