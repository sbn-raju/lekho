import { Badge, Button, Card, Grid, Group, PasswordInput, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { isNotEmpty, useForm } from '@mantine/form';
import { IconClock, IconDevices, IconKey, IconLogout, IconMailCheck, IconShieldLock } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { confirmAction, notifyError, notifySuccess } from '@/components/feedback/feedback';
import { NewPasswordFields } from '@/components/forms/NewPasswordFields';
import { PASSWORD_RULES } from '@/components/forms/password-rules';
import { DataTable } from '@/components/tables/DataTable';
import { logoutAll, useChangePassword, useRevokeSession, useSecuritySummary, useSessions } from '@/services/api/account';
import { ApiError } from '@/services/api/client';
import { useAuth } from '@/services/auth/auth-context';
import { describeUserAgent, formatDateTime, fromNow } from '@/utils/format';
import type { Session } from '@/types/api';

function ChangePasswordCard() {
  const change = useChangePassword();
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { currentPassword: '', password: '', confirmPassword: '' },
    validate: { currentPassword: isNotEmpty('Enter your current password'), ...PASSWORD_RULES },
  });

  const submit = async (values: typeof form.values) => {
    try {
      await change.mutateAsync({ currentPassword: values.currentPassword, newPassword: values.password });
      form.reset();
      notifySuccess('Your other devices have been signed out.', 'Password changed');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS') form.setFieldError('currentPassword', 'Current password is incorrect');
      else if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') form.setFieldError('password', err.message);
      else notifyError(err);
    }
  };

  return (
    <Card h="100%">
      <Title order={3} fz={18} mb="xs">
        Change password
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        This device stays signed in; every other device is signed out.
      </Text>
      <form onSubmit={form.onSubmit(submit)} noValidate>
        <Stack gap="md">
          <PasswordInput label="Current password" autoComplete="current-password" withAsterisk key={form.key('currentPassword')} {...form.getInputProps('currentPassword')} />
          <NewPasswordFields form={form} />
          <Group justify="flex-end">
            <Button type="submit" loading={form.submitting}>
              Change password
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}

/** FRD §14.3 screen 6: password, sessions, sign out everywhere, MFA status. */
export function AccountSecurityPage() {
  const navigate = useNavigate();
  const { forgetSession } = useAuth();
  const summary = useSecuritySummary();
  const sessions = useSessions();
  const revoke = useRevokeSession();

  const revokeSession = (s: Session) =>
    confirmAction({
      title: s.current ? 'Sign out of this device?' : 'Sign out this device?',
      message: s.current ? "You'll need to sign in again here." : `${describeUserAgent(s.userAgent)} will be signed out immediately.`,
      confirmLabel: 'Sign out',
      destructive: true,
      onConfirm: async () => {
        await revoke.mutateAsync(s.id);
        if (s.current) {
          forgetSession();
          navigate('/sign-in', { replace: true });
        }
      },
      successMessage: s.current ? undefined : 'Device signed out',
    });

  const signOutEverywhere = () =>
    confirmAction({
      title: 'Sign out of all devices?',
      message: 'Every session, including this one, ends now. Use this if you think someone else has access to your account.',
      confirmLabel: 'Sign out everywhere',
      destructive: true,
      onConfirm: async () => {
        await logoutAll();
        forgetSession();
        navigate('/sign-in', { replace: true });
      },
    });

  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Account security"
        description="Manage your password and the devices signed in to your account."
        actions={
          <Button variant="default" color="error" leftSection={<IconLogout size={16} />} onClick={signOutEverywhere}>
            Sign out everywhere
          </Button>
        }
      />

      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md" mb="lg">
        <StatCard label="Active sessions" value={s?.activeSessions} icon={IconDevices} />
        <StatCard label="Last sign-in" value={s ? fromNow(s.lastLoginAt) : undefined} icon={IconClock} color="info" />
        <StatCard label="Password changed" value={s ? fromNow(s.passwordChangedAt) : undefined} icon={IconKey} color="draft" />
        <StatCard label="Email" value={s ? (s.emailVerified ? 'Verified' : 'Unverified') : undefined} icon={IconMailCheck} color={s?.emailVerified ? 'success' : 'warning'} />
      </SimpleGrid>

      <Grid gap="md">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Stack gap="md">
            <Title order={3} fz={18}>
              Signed-in devices
            </Title>
            <DataTable
              rows={sessions.data ?? []}
              loading={sessions.isLoading}
              rowKey={(r) => r.id}
              empty={{ title: 'No active sessions' }}
              columns={[
                {
                  key: 'device',
                  header: 'Device',
                  render: (r) => (
                    <Group gap="xs" wrap="nowrap">
                      <Text size="md">{r.deviceName ?? describeUserAgent(r.userAgent)}</Text>
                      {r.current && (
                        <Badge size="sm" color="lekho">
                          This device
                        </Badge>
                      )}
                    </Group>
                  ),
                },
                { key: 'ip', header: 'IP address', render: (r) => r.ipAddress ?? '—', hiddenOnMobile: true },
                { key: 'last', header: 'Last active', render: (r) => <Text title={formatDateTime(r.lastUsedAt)}>{fromNow(r.lastUsedAt)}</Text> },
                {
                  key: 'actions',
                  header: '',
                  width: 110,
                  render: (r) => (
                    <Button size="xs" variant="subtle" color="error" onClick={() => revokeSession(r)}>
                      Sign out
                    </Button>
                  ),
                },
              ]}
            />
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Stack gap="md">
            <ChangePasswordCard />
            <Card>
              <Group gap="sm" wrap="nowrap" align="flex-start">
                <IconShieldLock size={22} stroke={1.75} />
                <Stack gap={4}>
                  <Text fw={600}>Two-step verification</Text>
                  <Text size="sm" c="dimmed">
                    Authenticator apps and passkeys are coming to Lekho. You'll be able to turn them on here.
                  </Text>
                </Stack>
              </Group>
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>
    </>
  );
}
