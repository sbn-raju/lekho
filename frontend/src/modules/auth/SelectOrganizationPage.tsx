import { Avatar, Button, Card, Center, EmptyState, Group, Skeleton, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { IconBuildingCommunity, IconChevronRight, IconWorld } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { Logo } from '@/components/brand/Logo';
import { EntityStatus } from '@/components/EntityStatus';
import { notifyError } from '@/components/feedback/feedback';
import { useAccess, useMyMemberships, useSelectOrganization } from '@/services/api/access';
import { useAuth, useCurrentUser } from '@/services/auth/auth-context';

/** Shown when a user belongs to several schools (or none) and hasn't picked one in this tab. */
export function SelectOrganizationPage() {
  const user = useCurrentUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const memberships = useMyMemberships();
  const access = useAccess();
  const select = useSelectOrganization();

  const choose = (organizationId: string) =>
    select.mutate(organizationId, { onSuccess: () => navigate('/', { replace: true }), onError: (e) => notifyError(e) });

  return (
    <Center mih="100vh" p="md" bg="var(--lekho-background)">
      <Stack w="100%" maw={520} gap="lg">
        <Logo size={36} />
        <Stack gap={4}>
          <Title order={2}>Choose a workspace</Title>
          <Text c="dimmed">Signed in as {user.email}</Text>
        </Stack>

        {!memberships.data ? (
          <Skeleton h={180} radius="lg" />
        ) : (
          <Stack gap="sm">
            {memberships.data.map((m) => (
              <UnstyledButton key={m.id} disabled={!m.usable || select.isPending} onClick={() => choose(m.organizationId)}>
                <Card style={{ opacity: m.usable ? 1 : 0.7 }}>
                  <Group justify="space-between" wrap="nowrap">
                    <Group wrap="nowrap">
                      <Avatar color="lekho" radius="md" src={m.organization.logo}>
                        <IconBuildingCommunity size={20} stroke={1.75} />
                      </Avatar>
                      <Stack gap={2}>
                        <Text fw={600}>{m.organization.name}</Text>
                        <Text size="sm" c="dimmed">
                          {m.roles.map((r) => r.name).join(', ') || 'Member'}
                        </Text>
                      </Stack>
                    </Group>
                    {m.usable ? (
                      <IconChevronRight size={18} stroke={1.75} />
                    ) : (
                      <EntityStatus status={m.organization.status !== 'active' ? m.organization.status : m.status} size="sm" />
                    )}
                  </Group>
                </Card>
              </UnstyledButton>
            ))}

            {access.hasPlatformAccess && (
              <UnstyledButton onClick={() => navigate('/platform')}>
                <Card>
                  <Group justify="space-between" wrap="nowrap">
                    <Group wrap="nowrap">
                      <Avatar color="draft" radius="md">
                        <IconWorld size={20} stroke={1.75} />
                      </Avatar>
                      <Stack gap={2}>
                        <Text fw={600}>Lekho platform console</Text>
                        <Text size="sm" c="dimmed">
                          {access.isSuperAdmin ? 'Super Admin' : 'Platform staff'}
                        </Text>
                      </Stack>
                    </Group>
                    <IconChevronRight size={18} stroke={1.75} />
                  </Group>
                </Card>
              </UnstyledButton>
            )}

            {memberships.data.length === 0 && !access.hasPlatformAccess && (
              <EmptyState
                title="You're not part of a school yet"
                description="When a school invites you, open the link in the invitation email to join."
                py="xl"
              />
            )}
          </Stack>
        )}

        <Button variant="subtle" color="neutral" onClick={() => void logout().then(() => navigate('/sign-in'))}>
          Sign out
        </Button>
      </Stack>
    </Center>
  );
}
