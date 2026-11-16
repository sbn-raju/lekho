import { Alert, Anchor, Avatar, Button, Card, Group, Skeleton, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertCircle, IconBuildingCommunity } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { errorMessage } from '@/components/feedback/feedback';
import { NewPasswordFields } from '@/components/forms/NewPasswordFields';
import { PASSWORD_RULES } from '@/components/forms/password-rules';
import { useSelectOrganization } from '@/services/api/access';
import { authApi } from '@/services/api/account';
import { ApiError } from '@/services/api/client';
import { useAuth } from '@/services/auth/auth-context';
import { formatDate } from '@/utils/format';

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * FRD §14.3 screen 5. New identities choose a password here; people who already have a Lekho
 * account sign in as the invited address and accept. Either way they land in the school.
 */
export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { state, login, logout } = useAuth();
  const select = useSelectOrganization();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = useQuery({
    queryKey: ['invitation-preview', token],
    queryFn: () => authApi.previewInvitation(token),
    enabled: !!token,
    retry: false,
  });

  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { firstName: '', lastName: '', password: '', confirmPassword: '' },
    validate: PASSWORD_RULES,
  });

  const enterSchool = async (organizationId: string) => {
    await qc.invalidateQueries({ queryKey: ['me'] });
    await select.mutateAsync(organizationId);
    navigate('/', { replace: true });
  };

  const acceptAsSignedIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.acceptInvitation({ token });
      await enterSchool(result.organizationId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const createAccount = async (values: typeof form.values) => {
    setError(null);
    try {
      const result = await authApi.acceptInvitation({
        token,
        password: values.password,
        ...(values.firstName.trim() && { firstName: values.firstName.trim() }),
        ...(values.lastName.trim() && { lastName: values.lastName.trim() }),
      });
      await login(preview.data!.email, values.password);
      await enterSchool(result.organizationId);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) form.setErrors(err.fieldErrors);
      else setError(errorMessage(err));
    }
  };

  if (!token || preview.isError) {
    return (
      <Stack gap="lg">
        <Title order={2}>Invitation</Title>
        <Alert color="error" icon={<IconAlertCircle size={18} />} title="This invitation can't be used">
          {token ? errorMessage(preview.error) : 'The link is incomplete.'} Ask the person who invited you to send a new one.
        </Alert>
        <Anchor component={Link} to="/sign-in" size="sm" ta="center">
          Go to sign in
        </Anchor>
      </Stack>
    );
  }

  if (!preview.data || state.status === 'loading') return <Skeleton h={280} radius="lg" />;

  const invite = preview.data;
  const signedInAs = state.status === 'authenticated' ? state.user : null;
  const wrongAccount = signedInAs && !sameEmail(signedInAs.email, invite.email);
  const here = `/invitations/accept?token=${encodeURIComponent(token)}`;

  return (
    <Stack gap="lg">
      <Card bg="var(--lekho-background)" shadow="none">
        <Group wrap="nowrap">
          <Avatar color="lekho" radius="md" size={48} src={invite.organization.logo}>
            <IconBuildingCommunity size={24} stroke={1.75} />
          </Avatar>
          <Stack gap={2}>
            <Text size="sm" c="dimmed">
              You're invited to join
            </Text>
            <Title order={3}>{invite.organization.name}</Title>
          </Stack>
        </Group>
        <Text size="sm" c="dimmed" mt="sm">
          Sent to <strong>{invite.email}</strong> · expires {formatDate(invite.expiresAt)}
        </Text>
      </Card>

      {error && (
        <Alert color="error" icon={<IconAlertCircle size={18} />}>
          {error}
        </Alert>
      )}

      {wrongAccount ? (
        <Stack gap="md">
          <Text>
            You're signed in as <strong>{signedInAs.email}</strong>, but this invitation is for <strong>{invite.email}</strong>.
          </Text>
          <Button variant="default" onClick={() => void logout().then(() => navigate(invite.accountExists ? `/sign-in?email=${encodeURIComponent(invite.email)}&redirect=${encodeURIComponent(here)}` : here))}>
            Sign out and continue as {invite.email}
          </Button>
        </Stack>
      ) : invite.accountExists ? (
        signedInAs ? (
          <Button size="md" loading={busy} onClick={() => void acceptAsSignedIn()}>
            Accept and join {invite.organization.name}
          </Button>
        ) : (
          <Stack gap="md">
            <Text>You already have a Lekho account. Sign in as {invite.email} to accept.</Text>
            <Button component={Link} to={`/sign-in?email=${encodeURIComponent(invite.email)}&redirect=${encodeURIComponent(here)}`} size="md">
              Sign in to accept
            </Button>
          </Stack>
        )
      ) : (
        <form onSubmit={form.onSubmit(createAccount)} noValidate>
          <Stack gap="md">
            <Text fw={600}>Create your account</Text>
            <Group grow>
              <TextInput label="First name" description="Optional" autoComplete="given-name" key={form.key('firstName')} {...form.getInputProps('firstName')} />
              <TextInput label="Last name" description="Optional" autoComplete="family-name" key={form.key('lastName')} {...form.getInputProps('lastName')} />
            </Group>
            <NewPasswordFields form={form} label="Password" />
            <Button type="submit" size="md" loading={form.submitting}>
              Create account and join
            </Button>
          </Stack>
        </form>
      )}
    </Stack>
  );
}
