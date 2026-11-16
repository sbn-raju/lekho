import { Alert, Anchor, Button, Loader, Stack, Text, TextInput, Title } from '@mantine/core';
import { isEmail, useForm } from '@mantine/form';
import { IconCircleCheck, IconAlertCircle } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { errorMessage, notifySuccess } from '@/components/feedback/feedback';
import { authApi } from '@/services/api/account';

/** FRD §14.3 screen 4: verifies on open; offers a fresh link when the old one expired. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'verifying' | 'verified' | 'failed'>(token ? 'verifying' : 'failed');
  const [error, setError] = useState<string>('This verification link is incomplete.');
  // Tokens are single-use: guard against StrictMode running the effect twice.
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    authApi
      .verifyEmail(token)
      .then(() => setState('verified'))
      .catch((err) => {
        setError(errorMessage(err));
        setState('failed');
      });
  }, [token]);

  const form = useForm({ mode: 'uncontrolled', initialValues: { email: '' }, validate: { email: isEmail('Enter a valid email address') } });
  const resend = async ({ email }: { email: string }) => {
    await authApi.resendVerification(email).catch(() => undefined);
    notifySuccess('If that address needs verifying, a new link is on its way.', 'Check your email');
  };

  if (state === 'verifying') {
    return (
      <Stack align="center" gap="md">
        <Loader />
        <Text c="dimmed">Verifying your email…</Text>
      </Stack>
    );
  }

  if (state === 'verified') {
    return (
      <Stack gap="lg">
        <Alert color="success" icon={<IconCircleCheck size={18} />} title="Email verified">
          Thanks — your email address is confirmed.
        </Alert>
        <Button component={Link} to="/sign-in" size="md">
          Continue to sign in
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      <Title order={2}>Verify your email</Title>
      <Alert color="error" icon={<IconAlertCircle size={18} />}>
        {error}
      </Alert>
      <Text c="dimmed">Links expire after 24 hours. Enter your email and we'll send a new one.</Text>
      <form onSubmit={form.onSubmit(resend)} noValidate>
        <Stack gap="md">
          <TextInput label="Email" type="email" autoComplete="email" key={form.key('email')} {...form.getInputProps('email')} />
          <Button type="submit" loading={form.submitting}>
            Send a new link
          </Button>
        </Stack>
      </form>
      <Anchor component={Link} to="/sign-in" size="sm" ta="center">
        Back to sign in
      </Anchor>
    </Stack>
  );
}
