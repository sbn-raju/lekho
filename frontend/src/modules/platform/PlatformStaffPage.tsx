import { Badge, Button, Drawer, Group, Modal, MultiSelect, Select, SimpleGrid, Skeleton, Stack, Text, TextInput, Title } from '@mantine/core';
import { hasLength, isEmail, useForm } from '@mantine/form';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { EntityStatus } from '@/components/EntityStatus';
import { PageHeader } from '@/components/PageHeader';
import { notifyError, notifySuccess } from '@/components/feedback/feedback';
import { QueryError } from '@/components/feedback/QueryState';
import { DataTable } from '@/components/tables/DataTable';
import { useAccess } from '@/services/api/access';
import { platformApi, platformKeys, usePlatformMutation, usePlatformStaff } from '@/services/api/platform';
import { rolesApi, useRoles } from '@/services/api/roles';
import type { PlatformStaff } from '@/types/api';
import { describeUserAgent, fromNow, fullName, humanize } from '@/utils/format';

const platformRoles = rolesApi('platform');

function AddStaffModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const roles = useRoles(platformRoles, opened);
  const create = usePlatformMutation((v: { firstName: string; lastName: string; email: string; phone: string; roleIds: string[] }) =>
    platformApi.createStaff({ ...v, phone: v.phone || undefined }),
  );
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { firstName: '', lastName: '', email: '', phone: '', roleIds: [] as string[] },
    validate: {
      firstName: hasLength({ min: 1 }, 'Required'),
      lastName: hasLength({ min: 1 }, 'Required'),
      email: isEmail('Enter a valid email address'),
    },
  });
  const submit = async (v: typeof form.values) => {
    try {
      await create.mutateAsync(v);
      notifySuccess(`${v.email} added. New accounts get an email to set their password.`);
      form.reset();
      onClose();
    } catch (err) {
      notifyError(err);
    }
  };
  return (
    <Modal opened={opened} onClose={onClose} title="Add platform staff" size="lg">
      <form onSubmit={form.onSubmit(submit)} noValidate>
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput label="First name" withAsterisk data-autofocus key={form.key('firstName')} {...form.getInputProps('firstName')} />
            <TextInput label="Last name" withAsterisk key={form.key('lastName')} {...form.getInputProps('lastName')} />
            <TextInput label="Email" type="email" withAsterisk key={form.key('email')} {...form.getInputProps('email')} />
            <TextInput label="Phone" type="tel" key={form.key('phone')} {...form.getInputProps('phone')} />
          </SimpleGrid>
          <MultiSelect
            label="Platform roles"
            description="You can only grant roles whose permissions you hold."
            data={(roles.data ?? []).filter((r) => r.status === 'active').map((r) => ({ value: r.id, label: r.name }))}
            searchable
            key={form.key('roleIds')}
            {...form.getInputProps('roleIds')}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.submitting}>
              Add staff
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function StaffDrawer({ staff, onClose }: { staff: PlatformStaff; onClose: () => void }) {
  const access = useAccess();
  const canUpdate = access.canPlatform('platform_users.update');
  const roles = useRoles(platformRoles);
  const permissions = useQuery({ queryKey: platformKeys.staffDetail(staff.id, 'permissions'), queryFn: () => platformApi.staffPermissions(staff.id) });
  const sessions = useQuery({ queryKey: platformKeys.staffDetail(staff.id, 'sessions'), queryFn: () => platformApi.staffSessions(staff.id) });
  const [roleIds, setRoleIds] = useState(staff.platformMembership.roles.map((r) => r.id));
  const update = usePlatformMutation((body: { roleIds?: string[]; status?: 'active' | 'suspended' | 'inactive' }) => platformApi.updateStaff(staff.id, body));
  const dirty = roleIds.slice().sort().join() !== staff.platformMembership.roles.map((r) => r.id).sort().join();

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Stack gap={0}>
          <Title order={3}>{fullName(staff)}</Title>
          <Text c="dimmed" size="sm">
            {staff.email}
          </Text>
        </Stack>
        <EntityStatus status={staff.status === 'active' ? staff.platformMembership.status : staff.status} />
      </Group>

      <Stack gap="xs">
        <MultiSelect
          label="Platform roles"
          data={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
          value={roleIds}
          onChange={setRoleIds}
          disabled={!canUpdate}
          searchable
        />
        {canUpdate && (
          <Group justify="flex-end">
            <Button
              size="xs"
              disabled={!dirty}
              loading={update.isPending}
              onClick={() => update.mutate({ roleIds }, { onSuccess: () => notifySuccess('Roles updated'), onError: (e) => notifyError(e) })}
            >
              Save roles
            </Button>
          </Group>
        )}
      </Stack>

      {canUpdate && (
        <Select
          label="Platform access"
          data={[
            { value: 'active', label: 'Active' },
            { value: 'suspended', label: 'Suspended' },
            { value: 'inactive', label: 'Inactive' },
          ]}
          value={staff.platformMembership.status}
          allowDeselect={false}
          onChange={(v) =>
            v && update.mutate({ status: v as 'active' | 'suspended' | 'inactive' }, { onSuccess: () => notifySuccess('Access updated'), onError: (e) => notifyError(e) })
          }
        />
      )}

      <Stack gap="xs">
        <Text fw={600}>Effective permissions</Text>
        {permissions.data ? (
          <Group gap={6}>
            {permissions.data.permissions.length === 0 && <Text size="sm" c="dimmed">None</Text>}
            {permissions.data.permissions.map((p) => (
              <Badge key={p} variant="outline" color="neutral" size="sm">
                {humanize(p)}
              </Badge>
            ))}
          </Group>
        ) : (
          <Skeleton h={40} />
        )}
      </Stack>

      <Stack gap="xs">
        <Text fw={600}>Active sessions</Text>
        {(sessions.data ?? []).map((s) => (
          <Group key={s.id} justify="space-between">
            <Text size="sm">{describeUserAgent(s.userAgent)}</Text>
            <Text size="xs" c="dimmed">
              {fromNow(s.lastUsedAt)}
            </Text>
          </Group>
        ))}
        {sessions.data?.length === 0 && (
          <Text size="sm" c="dimmed">
            Not signed in anywhere.
          </Text>
        )}
      </Stack>
      <Button variant="default" onClick={onClose}>
        Close
      </Button>
    </Stack>
  );
}

/** FRD §14.1 screen 5. */
export function PlatformStaffPage() {
  const access = useAccess();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const staff = usePlatformStaff({ page, search: debounced || undefined });
  const [adding, add] = useDisclosure();
  const selectedId = params.get('user');
  const selected = staff.data?.items.find((s) => s.id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        title="Platform staff"
        description="People who help run Lekho. They get only what their platform roles grant — never Super Admin."
        actions={
          access.canPlatform('platform_users.create') && (
            <Button leftSection={<IconPlus size={16} />} onClick={add.open}>
              Add staff
            </Button>
          )
        }
      />
      {staff.isError ? (
        <QueryError error={staff.error} onRetry={() => void staff.refetch()} />
      ) : (
        <DataTable
          toolbar={
            <TextInput
              placeholder="Search name or email"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => {
                setSearch(e.currentTarget.value);
                setPage(1);
              }}
              w={{ base: '100%', sm: 320 }}
              aria-label="Search staff"
            />
          }
          rows={staff.data?.items ?? []}
          loading={staff.isFetching}
          rowKey={(s) => s.id}
          onRowClick={(s) => setParams({ user: s.id })}
          empty={{ title: 'No platform staff yet', description: 'Add people who help onboard and support schools.' }}
          pagination={staff.data && { page, totalPages: staff.data.totalPages, total: staff.data.total, onChange: setPage }}
          columns={[
            { key: 'name', header: 'Name', render: (s) => <Text fw={500}>{fullName(s)}</Text> },
            { key: 'email', header: 'Email', render: (s) => s.email },
            { key: 'roles', header: 'Roles', hiddenOnMobile: true, render: (s) => s.platformMembership.roles.map((r) => r.name).join(', ') || '—' },
            { key: 'status', header: 'Status', render: (s) => <EntityStatus status={s.status === 'active' ? s.platformMembership.status : s.status} size="sm" /> },
          ]}
        />
      )}
      <AddStaffModal opened={adding} onClose={add.close} />
      <Drawer opened={!!selected} onClose={() => setParams({})} position="right" size="md" title="Staff member">
        {selected && <StaffDrawer key={selected.id + selected.platformMembership.roles.length} staff={selected} onClose={() => setParams({})} />}
      </Drawer>
    </>
  );
}
