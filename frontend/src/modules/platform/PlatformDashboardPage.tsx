import { Anchor, Button, Card, Grid, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconBuildingCommunity, IconCircleCheck, IconCircleX, IconHourglass, IconPlus, IconUsers, IconUsersGroup } from '@tabler/icons-react';
import { Link, useNavigate } from 'react-router';
import { EntityStatus } from '@/components/EntityStatus';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { DataTable } from '@/components/tables/DataTable';
import { useAccess } from '@/services/api/access';
import { auditApi, useAuditLogs } from '@/services/api/audit';
import { useOrganizations, usePlatformDashboard } from '@/services/api/platform';
import { useCurrentUser } from '@/services/auth/auth-context';
import { formatDate, fromNow } from '@/utils/format';

const platformAudit = auditApi('platform');

/** FRD §14.1 screen 1. */
export function PlatformDashboardPage() {
  const user = useCurrentUser();
  const access = useAccess();
  const navigate = useNavigate();
  const canReadOrgs = access.canPlatform('organizations.read');
  const stats = usePlatformDashboard();
  const pending = useOrganizations({ page: 1, status: 'onboarding' });
  const activity = useAuditLogs(platformAudit, { page: 1, limit: 8 }, access.canPlatform('platform_audit.read'));
  const s = stats.data;

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.firstName}`}
        description={access.isSuperAdmin ? 'Super Admin · Lekho platform overview' : 'Lekho platform overview'}
        actions={
          access.canPlatform('organizations.create') && (
            <Button component={Link} to="/platform/organizations/new" leftSection={<IconPlus size={16} />}>
              Create organization
            </Button>
          )
        }
      />

      {canReadOrgs && (
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 3, xl: 6 }} spacing="md" mb="lg">
          <StatCard label="Organizations" value={s?.organizations.total} icon={IconBuildingCommunity} />
          <StatCard label="Active" value={s?.organizations.active} icon={IconCircleCheck} color="success" />
          <StatCard label="Suspended" value={s?.organizations.suspended} icon={IconCircleX} color="error" />
          <StatCard label="Pending onboarding" value={s?.pendingOnboarding} hint="Draft or onboarding" icon={IconHourglass} color="warning" />
          <StatCard label="Total users" value={s?.totalUsers} icon={IconUsers} color="info" />
          <StatCard label="Platform staff" value={s?.platformStaff} icon={IconUsersGroup} color="draft" />
        </SimpleGrid>
      )}

      <Grid gap="md">
        {canReadOrgs && (
          <Grid.Col span={{ base: 12, lg: 7 }}>
            <Stack gap="sm">
              <Group justify="space-between">
                <Title order={3} fz={18}>
                  Onboarding in progress
                </Title>
                <Anchor component={Link} to="/platform/organizations?status=onboarding" size="sm">
                  View all
                </Anchor>
              </Group>
              <DataTable
                rows={pending.data?.items ?? []}
                loading={pending.isLoading}
                rowKey={(o) => o.id}
                onRowClick={(o) => navigate(`/platform/organizations/${o.id}`)}
                empty={{ title: 'No schools are onboarding', description: 'Schools waiting for their School Admin appear here.' }}
                columns={[
                  { key: 'name', header: 'School', render: (o) => <Text fw={500}>{o.name}</Text> },
                  { key: 'state', header: 'Step', render: (o) => <EntityStatus status={o.onboarding.state === 'invitation_pending' ? 'invited' : o.status} size="sm" /> },
                  { key: 'created', header: 'Created', render: (o) => formatDate(o.createdAt) },
                ]}
              />
            </Stack>
          </Grid.Col>
        )}
        {access.canPlatform('platform_audit.read') && (
          <Grid.Col span={{ base: 12, lg: canReadOrgs ? 5 : 12 }}>
            <Stack gap="sm">
              <Group justify="space-between">
                <Title order={3} fz={18}>
                  Recent activity
                </Title>
                <Anchor component={Link} to="/platform/audit-logs" size="sm">
                  Audit logs
                </Anchor>
              </Group>
              <Card p={0}>
                {(activity.data?.items ?? []).map((l) => (
                  <Group key={l.id} justify="space-between" px="md" py="sm" wrap="nowrap" style={{ borderBottom: '1px solid var(--lekho-border)' }}>
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
                {activity.data?.items.length === 0 && (
                  <Text c="dimmed" size="sm" p="md">
                    No activity yet.
                  </Text>
                )}
              </Card>
            </Stack>
          </Grid.Col>
        )}
      </Grid>
    </>
  );
}
