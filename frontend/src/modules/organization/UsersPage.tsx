import { Avatar, Button, Group, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { IconSearch, IconUserPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { EntityStatus } from '@/components/EntityStatus';
import { PageHeader } from '@/components/PageHeader';
import { QueryError } from '@/components/feedback/QueryState';
import { DataTable } from '@/components/tables/DataTable';
import { useAccess } from '@/services/api/access';
import { useSchoolUsers } from '@/services/api/school';
import { formatDate, fullName, initials } from '@/utils/format';
import { CreateUserModal } from './CreateUserModal';
import { unitOptions, useSchoolLookups } from './useSchoolLookups';

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'invited', label: 'Invited' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'revoked', label: 'Removed' },
];

/** FRD §14.2 screen 2. The list only contains members within the caller's scope. */
export function UsersPage() {
  const navigate = useNavigate();
  const access = useAccess();
  const { roles, units, roleNames, unitNames } = useSchoolLookups();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<string | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [adding, add] = useDisclosure();
  const users = useSchoolUsers({ page, search: debounced || undefined, status: status ?? undefined, roleId: roleId ?? undefined, unitId: unitId ?? undefined });
  const resetPage = () => setPage(1);

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone in your school: staff, students and parents."
        actions={
          access.canOrg('users.create') && (
            <Button leftSection={<IconUserPlus size={16} />} onClick={add.open}>
              Add user
            </Button>
          )
        }
      />
      {users.isError ? (
        <QueryError error={users.error} onRetry={() => void users.refetch()} />
      ) : (
        <DataTable
          toolbar={
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
              <TextInput placeholder="Search name or email" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => { setSearch(e.currentTarget.value); resetPage(); }} aria-label="Search users" />
              <Select placeholder="Any status" data={STATUSES} value={status} onChange={(v) => { setStatus(v); resetPage(); }} clearable aria-label="Filter by status" />
              {roles.length > 0 && <Select placeholder="Any role" data={roles.map((r) => ({ value: r.id, label: r.name }))} value={roleId} onChange={(v) => { setRoleId(v); resetPage(); }} clearable searchable aria-label="Filter by role" />}
              {units.length > 0 && (
                <Select
                  placeholder="Any department or class"
                  data={unitOptions(units)}
                  value={unitId}
                  onChange={(v) => { setUnitId(v); resetPage(); }}
                  clearable
                  searchable
                  aria-label="Filter by department or class"
                />
              )}
            </SimpleGrid>
          }
          rows={users.data?.items ?? []}
          loading={users.isFetching}
          rowKey={(u) => u.id}
          onRowClick={(u) => navigate(`/users/${u.id}`)}
          empty={{
            title: debounced || status || roleId || unitId ? 'No matching users' : 'No users yet',
            description: access.canOrg('users.create') ? 'Add people to invite them to your school.' : undefined,
          }}
          pagination={users.data && { page, totalPages: users.data.totalPages, total: users.data.total, onChange: setPage }}
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (u) => (
                <Group gap="sm" wrap="nowrap">
                  <Avatar color="lekho" radius="xl" size={32}>
                    {initials(u)}
                  </Avatar>
                  <Stack gap={0} miw={0}>
                    <Text fw={500} truncate>
                      {fullName(u)}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {u.email}
                    </Text>
                  </Stack>
                </Group>
              ),
            },
            { key: 'roles', header: 'Roles', render: (u) => <Text size="sm">{roleNames(u.membership.roleIds).join(', ') || '—'}</Text> },
            { key: 'units', header: 'Department / class', hiddenOnMobile: true, render: (u) => <Text size="sm">{unitNames(u.membership.organizationUnitIds).join(', ') || '—'}</Text> },
            { key: 'status', header: 'Status', render: (u) => <EntityStatus status={u.membership.status === 'revoked' ? 'revoked' : u.membership.status} size="sm" /> },
            { key: 'joined', header: 'Joined', hiddenOnMobile: true, render: (u) => formatDate(u.membership.joinedAt) },
          ]}
        />
      )}
      <CreateUserModal opened={adding} onClose={add.close} />
    </>
  );
}
