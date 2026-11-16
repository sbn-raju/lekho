import { Alert, Anchor, Button, Stack, Text, TextInput, Title } from '@mantine/core';
import { isEmail, useForm } from '@mantine/form';
import { IconMailCheck } from '@tabler/icons-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { notifyError } from '@/components/feedback/feedback';
import { authApi } from '@/services/api/account';

/** FRD §14.3 screen 2. The response never reveals whether the email has an account. */
export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm({ mode: 'uncontrolled', initialValues: { email: '' }, validate: { email: isEmail('Enter a valid email address') } });

  const handleSubmit = async ({ email }: { email: string }) => {
    try {
      await authApi.forgotPassword(email);
      setSentTo(email);
    } catch (err) {
      notifyError(err);
    }
  };

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Title order={2}>Reset your password</Title>
        <Text c="dimmed">Enter the email you use for Lekho and we'll send you a link to choose a new password.</Text>
      </Stack>

      {sentTo ? (
        <Alert color="success" icon={<IconMailCheck size={18} />} title="Check your email">
          If an account exists for {sentTo}, a reset link is on its way. It expires in 30 minutes and can be used once.
        </Alert>
      ) : (
        <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
          <Stack gap="md">
            <TextInput label="Email" type="email" autoComplete="email" withAsterisk key={form.key('email')} {...form.getInputProps('email')} />
            <Button type="submit" fullWidth size="md" loading={form.submitting}>
              Send reset link
            </Button>
          </Stack>
        </form>
      )}
      <Anchor component={Link} to="/sign-in" size="sm" ta="center">
        Back to sign in
      </Anchor>
    </Stack>
  );
}
