import { Alert, Anchor, Button, Stack, Text, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { errorMessage, notifySuccess } from '@/components/feedback/feedback';
import { NewPasswordFields } from '@/components/forms/NewPasswordFields';
import { PASSWORD_RULES } from '@/components/forms/password-rules';
import { authApi } from '@/services/api/account';
import { ApiError } from '@/services/api/client';
import { useAuth } from '@/services/auth/auth-context';

const COPY = {
  reset: { title: 'Choose a new password', intro: 'Your new password signs you out of every device.', done: 'Password updated. Sign in with your new password.' },
  setup: { title: 'Set up your account', intro: 'Choose a password to activate your Lekho account.', done: 'Your account is ready. Sign in to continue.' },
};

/**
 * FRD §14.3 screen 3. `setup` is the same flow for platform staff activating a new account
 * (the backend issues them a single-use password link).
 */
export function ResetPasswordPage({ mode = 'reset' }: { mode?: 'reset' | 'setup' }) {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const { state, forgetSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[mode];

  const form = useForm({ mode: 'uncontrolled', initialValues: { password: '', confirmPassword: '' }, validate: PASSWORD_RULES });

  const handleSubmit = async ({ password }: { password: string }) => {
    setError(null);
    try {
      await authApi.resetPassword(token!, password);
      // The backend revoked every session; drop ours too.
      if (state.status === 'authenticated') forgetSession();
      notifySuccess(copy.done);
      navigate('/sign-in', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) form.setErrors(err.fieldErrors);
      else setError(errorMessage(err));
    }
  };

  if (!token) {
    return (
      <Alert color="error" icon={<IconAlertCircle size={18} />} title="This link is incomplete">
        Open the link from your email again, or <Anchor component={Link} to="/forgot-password">request a new one</Anchor>.
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Title order={2}>{copy.title}</Title>
        <Text c="dimmed">{copy.intro}</Text>
      </Stack>
      {error && (
        <Alert color="error" icon={<IconAlertCircle size={18} />}>
          {error}{' '}
          {mode === 'reset' && (
            <Anchor component={Link} to="/forgot-password">
              Request a new link
            </Anchor>
          )}
        </Alert>
      )}
      <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
        <Stack gap="md">
          <NewPasswordFields form={form} label={mode === 'setup' ? 'Password' : 'New password'} />
          <Button type="submit" fullWidth size="md" loading={form.submitting}>
            {mode === 'setup' ? 'Activate account' : 'Update password'}
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}
