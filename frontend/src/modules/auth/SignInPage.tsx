import { Alert, Anchor, Button, Group, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { isEmail, isNotEmpty, useForm } from '@mantine/form';
import { IconAlertCircle, IconMailForward } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { safeRedirect } from '@/utils/redirect';
import { brandCopy } from '@/brand';
import { Logo } from '@/components/brand/Logo';
import { errorMessage, notifySuccess } from '@/components/feedback/feedback';
import { authApi } from '@/services/api/account';
import { ApiError } from '@/services/api/client';
import { useAuth } from '@/services/auth/auth-context';

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'That email and password combination is not right.',
  ACCOUNT_LOCKED: 'Too many failed attempts. Try again in a few minutes, or reset your password.',
  ACCOUNT_DISABLED: 'This account is not active. Contact your school administrator.',
  RATE_LIMITED: 'Too many sign-in attempts from this device. Please wait a few minutes.',
};

export function SignInPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { login } = useAuth();
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { email: params.get('email') ?? '', password: '' },
    validate: {
      email: isEmail('Enter a valid email address'),
      password: isNotEmpty('Enter your password'),
    },
  });

  const handleSubmit = async (values: { email: string; password: string }) => {
    setError(null);
    try {
      await login(values.email, values.password);
      navigate(safeRedirect(params.get('redirect')), { replace: true });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN';
      setError({ code, message: MESSAGES[code] ?? errorMessage(err) });
    }
  };

  const resendVerification = async () => {
    await authApi.resendVerification(form.getValues().email).catch(() => undefined);
    notifySuccess('If your account needs verifying, a new link is on its way.', 'Check your email');
  };

  return (
    <Stack gap="lg">
      {/* Full wordmark on sign-in; the panel logo is hidden on small screens. */}
      <Logo size={40} hiddenFrom="md" />
      <Stack gap={4}>
        <Title order={2}>Sign in to {brandCopy.name}</Title>
        <Text c="dimmed">{brandCopy.tagline}</Text>
      </Stack>

      {error && (
        <Alert color={error.code === 'EMAIL_NOT_VERIFIED' ? 'warning' : 'error'} icon={<IconAlertCircle size={18} />}>
          {error.code === 'EMAIL_NOT_VERIFIED' ? (
            <Stack gap="xs" align="flex-start">
              <Text size="sm">Please verify your email address before signing in.</Text>
              <Button size="xs" variant="default" leftSection={<IconMailForward size={14} />} onClick={() => void resendVerification()}>
                Resend verification email
              </Button>
            </Stack>
          ) : (
            error.message
          )}
        </Alert>
      )}

      <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
        <Stack gap="md">
          <TextInput label="Email" placeholder="you@school.edu" type="email" autoComplete="email" withAsterisk key={form.key('email')} {...form.getInputProps('email')} />
          <PasswordInput label="Password" placeholder="Your password" autoComplete="current-password" withAsterisk key={form.key('password')} {...form.getInputProps('password')} />
          <Group justify="flex-end">
            <Anchor component={Link} to="/forgot-password" size="sm">
              Forgot password?
            </Anchor>
          </Group>
          <Button type="submit" fullWidth size="md" loading={form.submitting}>
            Sign in
          </Button>
        </Stack>
      </form>
      <Text size="sm" c="dimmed" ta="center">
        New to Lekho? Accounts are created by invitation from your school.
      </Text>
    </Stack>
  );
}
