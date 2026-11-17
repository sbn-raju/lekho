import { Badge, Button, Group, Modal, Select, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { hasLength, useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { IconLock, IconPlus } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { EntityStatus } from '@/components/EntityStatus';
import { PageHeader } from '@/components/PageHeader';
import { notifyError, notifySuccess } from '@/components/feedback/feedback';
import { QueryError } from '@/components/feedback/QueryState';
import { DataTable } from '@/components/tables/DataTable';
import { useAccess } from '@/services/api/access';
import { ApiError } from '@/services/api/client';
import { rolesApi, useRoleMutation, useRoles, type RolesApi } from '@/services/api/roles';
import type { PermissionLevel, Role } from '@/types/api';
import { rolePermission } from './role-permissions';

function CreateRoleModal({ r, roles, opened, onClose }: { r: RolesApi; roles: Role[]; opened: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const create = useRoleMutation(r, (v: { name: string; description: string; cloneFrom: string | null }) =>
    v.cloneFrom ? r.clone(v.cloneFrom, { name: v.name }) : r.create({ name: v.name, description: v.description || undefined }),
  );
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { name: '', description: '', cloneFrom: null as string | null },
    validate: { name: hasLength({ min: 2, max: 100 }, 'Use 2–100 characters') },
  });

  const submit = async (values: typeof form.values) => {
    try {
      const role = await create.mutateAsync(values);
      notifySuccess(`${role.name} created. Choose its permissions next.`);
      onClose();
      form.reset();
      navigate(`${r.basePath}/${role.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') form.setFieldError('name', 'A role with this code already exists');
      else notifyError(err);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Create role">
      <form onSubmit={form.onSubmit(submit)} noValidate>
        <Stack gap="md">
          <TextInput label="Role name" placeholder={r.level === 'platform' ? 'Onboarding executive' : 'Academic coordinator'} withAsterisk data-autofocus key={form.key('name')} {...form.getInputProps('name')} />
          <Textarea label="Description" autosize minRows={2} key={form.key('description')} {...form.getInputProps('description')} />
          <Select
            label="Start from"
            description="Copy the permissions and scopes of an existing role, or start empty."
            placeholder="Empty role"
            clearable
            data={roles.map((x) => ({ value: x.id, label: x.name }))}
            key={form.key('cloneFrom')}
            {...form.getInputProps('cloneFrom')}
          />
          <Text size="xs" c="dimmed">
            A role's name never grants anything by itself; only the permissions you tick do.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.submitting}>
              Create role
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Roles list for a school (FRD §14.2 screen 4) or the platform (§14.1 screen 6). */
export function RolesListPage({ level }: { level: PermissionLevel }) {
  const r = rolesApi(level);
  const roles = useRoles(r);
  const access = useAccess();
  const navigate = useNavigate();
  const [opened, { open, close }] = useDisclosure();
  const canCreate = level === 'platform' ? access.canPlatform(rolePermission(level, 'create')) : access.canOrg(rolePermission(level, 'create'));

  return (
    <>
      <PageHeader
        title={level === 'platform' ? 'Platform roles' : 'Roles & permissions'}
        description={
          level === 'platform'
            ? 'Roles for Lekho platform staff. Nobody can be given Super Admin through a role.'
            : 'Define what each role can do in your school, and where.'
        }
        actions={
          canCreate && (
            <Button leftSection={<IconPlus size={16} />} onClick={open}>
              Create role
            </Button>
          )
        }
      />
      {roles.isError ? (
        <QueryError error={roles.error} onRetry={() => void roles.refetch()} />
      ) : (
        <DataTable
          rows={roles.data ?? []}
          loading={roles.isLoading}
          rowKey={(x) => x.id}
          onRowClick={(x) => navigate(`${r.basePath}/${x.id}`)}
          empty={{ title: 'No roles yet', description: 'Create a role to give people access.' }}
          columns={[
            {
              key: 'name',
              header: 'Role',
              render: (x) => (
                <Stack gap={0}>
                  <Group gap={6} wrap="nowrap">
                    <Text fw={600}>{x.name}</Text>
                    {x.isProtected && (
                      <Badge size="sm" color="neutral" leftSection={<IconLock size={12} />}>
                        Protected
                      </Badge>
                    )}
                  </Group>
                  {x.description && (
                    <Text size="sm" c="dimmed" lineClamp={1}>
                      {x.description}
                    </Text>
                  )}
                </Stack>
              ),
            },
            { key: 'perms', header: 'Permissions', numeric: true, render: (x) => (x.allPermissions ? 'All' : x.permissions.length) },
            { key: 'users', header: level === 'platform' ? 'Staff' : 'Members', numeric: true, render: (x) => x.userCount ?? 0 },
            { key: 'status', header: 'Status', render: (x) => <EntityStatus status={x.status} size="sm" /> },
          ]}
        />
      )}
      <CreateRoleModal r={r} roles={roles.data ?? []} opened={opened} onClose={close} />
    </>
  );
}
