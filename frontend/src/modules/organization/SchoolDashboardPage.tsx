import { Anchor, Badge, Button, Card, Grid, Group, Progress, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconHierarchy2, IconMailForward, IconUserPlus, IconUserShield, IconUsers, IconUserCheck } from '@tabler/icons-react';
import { useDisclosure } from '@mantine/hooks';
import { Link } from 'react-router';
import { EntityStatus } from '@/components/EntityStatus';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { useAccess, useAccessContext } from '@/services/api/access';
import { auditApi, useAuditLogs } from '@/services/api/audit';
import { rolesApi, useRoles } from '@/services/api/roles';
import { useInvitations, useSchool, useSchoolUsers, useUnits } from '@/services/api/school';
import { useCurrentUser } from '@/services/auth/auth-context';
import { fromNow } from '@/utils/format';
import { CreateUserModal } from './CreateUserModal';

const schoolAudit = auditApi('organization');

/**
 * FRD §14.2 screen 1. Every widget is shown only if the user can read its data, so a teacher
 * sees a calm welcome rather than a wall of 403s.
 */
export function SchoolDashboardPage() {
  const user = useCurrentUser();
  const access = useAccess();
  const context = useAccessContext();
  const school = useSchool();
  const canUsers = access.canOrg('users.read');
  const total = useSchoolUsers({ page: 1 }, canUsers);
  const active = useSchoolUsers({ page: 1, status: 'active' }, canUsers);
  const invitedMembers = useSchoolUsers({ page: 1, status: 'invited' }, canUsers);
  const pending = useInvitations({ page: 1, status: 'pending' }, access.canOrg('invitations.read'));
  const roles = useRoles(rolesApi('organization'), access.canOrg('roles.read'));
  const units = useUnits(access.canOrg('organization_units.read'));
  const activity = useAuditLogs(schoolAudit, { page: 1, limit: 8 }, access.canOrg('audit_logs.read'));
  const [adding, add] = useDisclosure();

  const isAdmin = canUsers || access.canOrg('roles.read');
  const activeRoles = roles.data?.filter((r) => r.status === 'active');
  const maxHolders = Math.max(1, ...(activeRoles ?? []).map((r) => r.userCount ?? 0));
  const myRoles = context.data?.organization?.roles ?? [];

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.firstName}`}
        description={[school.data?.name, school.data?.settings.academicYear && `Academic year ${school.data.settings.academicYear}`].filter(Boolean).join(' · ')}
        actions={
          access.canOrg('users.create') && (
            <Button leftSection={<IconUserPlus size={16} />} onClick={add.open}>
              Add user
            </Button>
          )
        }
      />

      {isAdmin ? (
        <>
          <SimpleGrid cols={{ base: 1, xs: 2, lg: 3, xl: 6 }} spacing="md" mb="lg">
            {canUsers && <StatCard label="Members" value={total.data?.total} hint="Excludes removed" icon={IconUsers} />}
            {canUsers && <StatCard label="Active" value={active.data?.total} icon={IconUserCheck} color="success" />}
            {canUsers && <StatCard label="Awaiting acceptance" value={invitedMembers.data?.total} icon={IconMailForward} color="warning" />}
            {access.canOrg('invitations.read') && <StatCard label="Pending invitations" value={pending.data?.total} icon={IconMailForward} color="info" />}
            {access.canOrg('roles.read') && <StatCard label="Active roles" value={activeRoles?.length} icon={IconUserShield} color="draft" />}
            {access.canOrg('organization_units.read') && <StatCard label="Departments & classes" value={units.data?.length} icon={IconHierarchy2} color="neutral" />}
          </SimpleGrid>

          <Grid gap="md">
            {activeRoles && (
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <Card h="100%">
                  <Group justify="space-between" mb="md">
                    <Title order={3} fz={18}>
                      Members by role
                    </Title>
                    <Anchor component={Link} to="/roles" size="sm">
                      Manage roles
                    </Anchor>
                  </Group>
                  <Stack gap="sm">
                    {activeRoles.map((r) => (
                      <Stack key={r.id} gap={4}>
                        <Group justify="space-between">
                          <Text size="sm">{r.name}</Text>
                          <Text size="sm" fw={600} className="tabular-nums">
                            {r.userCount ?? 0}
                          </Text>
                        </Group>
                        <Progress value={((r.userCount ?? 0) / maxHolders) * 100} size="sm" aria-label={`${r.name} members`} />
                      </Stack>
                    ))}
                  </Stack>
                </Card>
              </Grid.Col>
            )}
            {access.canOrg('audit_logs.read') && (
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <Card h="100%" p={0}>
                  <Group justify="space-between" p="md">
                    <Title order={3} fz={18}>
                      Recent activity
                    </Title>
                    <Anchor component={Link} to="/audit-logs" size="sm">
                      Audit logs
                    </Anchor>
                  </Group>
                  {(activity.data?.items ?? []).map((l) => (
                    <Group key={l.id} justify="space-between" px="md" py="sm" wrap="nowrap" style={{ borderTop: '1px solid var(--lekho-border)' }}>
                      <Stack gap={0} miw={0}>
                        <Text size="sm" ff="monospace" truncate>
                          {l.action}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {fromNow(l.createdAt)}
                        </Text>
                      </Stack>
                      <EntityStatus status={l.result} size="sm" />
                    </Group>
                  ))}
                </Card>
              </Grid.Col>
            )}
          </Grid>
        </>
      ) : (
        <Card maw={640}>
          <Stack gap="sm">
            <Title order={3} fz={18}>
              You're signed in to {school.data?.name ?? 'your school'}
            </Title>
            <Group gap="xs">
              {myRoles.length ? myRoles.map((r) => <Badge key={r.id}>{r.name}</Badge>) : <Text c="dimmed">No roles assigned yet.</Text>}
            </Group>
            <Text c="dimmed">Attendance, courses, assignments and more will appear in the sidebar as your school turns them on.</Text>
          </Stack>
        </Card>
      )}
      <CreateUserModal opened={adding} onClose={add.close} />
    </>
  );
}
