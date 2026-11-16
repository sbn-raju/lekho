import { Alert, Anchor, Badge, Breadcrumbs, Button, Group, Menu, Modal, NumberInput, Skeleton, Stack, Tabs, Text, TextInput, Textarea, Title } from '@mantine/core';
import { hasLength, useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { IconCopy, IconDots, IconLock, IconPencil, IconPlayerPause, IconPlayerPlay, IconTrash } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { EntityStatus } from '@/components/EntityStatus';
import { confirmAction, notifyError, notifySuccess } from '@/components/feedback/feedback';
import { QueryError } from '@/components/feedback/QueryState';
import { PermissionMatrix } from '@/components/permission-matrix/PermissionMatrix';
import { ScopeBuilder } from '@/components/scope-builder/ScopeBuilder';
import { DataTable } from '@/components/tables/DataTable';
import { useAccess } from '@/services/api/access';
import { rolesApi, usePermissionCatalog, usePermissionModules, useRole, useRoleMutation, type PermissionEntry, type RolesApi } from '@/services/api/roles';
import { useUnits } from '@/services/api/school';
import type { PermissionLevel, Role } from '@/types/api';
import { fullName } from '@/utils/format';
import { rolePermission } from './role-permissions';

function EditRoleModal({ r, role, opened, onClose }: { r: RolesApi; role: Role; opened: boolean; onClose: () => void }) {
  const update = useRoleMutation(r, (v: { name: string; description: string; level: number }) => r.update(role.id, v));
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { name: role.name, description: role.description ?? '', level: role.level },
    validate: { name: hasLength({ min: 2, max: 100 }, 'Use 2–100 characters') },
  });
  const submit = async (values: typeof form.values) => {
    try {
      await update.mutateAsync(values);
      notifySuccess('Role updated');
      onClose();
    } catch (err) {
      notifyError(err);
    }
  };
  return (
    <Modal opened={opened} onClose={onClose} title="Edit role">
      <form onSubmit={form.onSubmit(submit)} noValidate>
        <Stack gap="md">
          <TextInput label="Role name" withAsterisk key={form.key('name')} {...form.getInputProps('name')} />
          <Textarea label="Description" autosize minRows={2} key={form.key('description')} {...form.getInputProps('description')} />
          <NumberInput label="Seniority" description="Lower numbers sort first. Used for ordering only; it grants nothing." min={2} max={1000} key={form.key('level')} {...form.getInputProps('level')} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.submitting}>
              Save
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function PermissionsTab({ r, role, editable }: { r: RolesApi; role: Role; editable: boolean }) {
  const catalog = usePermissionCatalog(r);
  const modules = usePermissionModules(r);
  const initial = new Set(role.permissions.map((p) => p.code));
  const [selected, setSelected] = useState(initial);
  const dirty = selected.size !== initial.size || [...selected].some((c) => !initial.has(c));
  const save = useRoleMutation(r, (permissions: PermissionEntry[]) => r.update(role.id, { permissions }));
  const narrowed = new Set(role.permissions.filter((p) => p.scopes.some((s) => s.type !== 'organization' && s.type !== 'platform')).map((p) => p.code));

  const submit = async () => {
    // Keep existing scopes for permissions that stay; new ones start school-wide.
    const entries: PermissionEntry[] = [...selected].map((code) => {
      const existing = role.permissions.find((p) => p.code === code);
      return existing && r.level === 'organization' ? { permission: code, scopes: existing.scopes.map((s) => ({ type: s.type, resourceIds: s.resourceIds })) } : code;
    });
    try {
      await save.mutateAsync(entries);
      notifySuccess('Permissions saved');
    } catch (err) {
      notifyError(err);
    }
  };

  if (catalog.isError) return <QueryError error={catalog.error} />;
  if (!catalog.data || !modules.data) return <Skeleton h={320} radius="lg" />;

  return (
    <Stack gap="md">
      {role.allPermissions && (
        <Alert color="info" icon={<IconLock size={18} />}>
          This role always holds every {r.level === 'platform' ? 'platform' : 'school'} permission, including ones added in future. It can't be edited.
        </Alert>
      )}
      <PermissionMatrix
        catalog={catalog.data}
        modules={modules.data}
        selected={selected}
        allGranted={role.allPermissions}
        readOnly={!editable}
        narrowed={narrowed}
        onToggle={(code, checked) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (checked) next.add(code);
            else next.delete(code);
            return next;
          })
        }
      />
      {editable && !role.allPermissions && (
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {selected.size} permission{selected.size === 1 ? '' : 's'} selected
          </Text>
          <Group>
            <Button variant="default" disabled={!dirty} onClick={() => setSelected(initial)}>
              Discard changes
            </Button>
            <Button disabled={!dirty} loading={save.isPending} onClick={() => void submit()}>
              Save permissions
            </Button>
          </Group>
        </Group>
      )}
    </Stack>
  );
}

function ScopesTab({ r, role, editable }: { r: RolesApi; role: Role; editable: boolean }) {
  const catalog = usePermissionCatalog(r);
  const units = useUnits();
  const save = useRoleMutation(r, (entries: Parameters<RolesApi['setScopes']>[1]) => r.setScopes(role.id, entries));
  if (role.allPermissions) {
    return (
      <Alert color="info" icon={<IconLock size={18} />}>
        This role applies to the entire school.
      </Alert>
    );
  }
  if (!catalog.data || !units.data) return <Skeleton h={240} radius="lg" />;
  return (
    <ScopeBuilder
      key={role.updatedAt}
      grants={role.permissions}
      catalog={catalog.data}
      units={units.data}
      readOnly={!editable}
      saving={save.isPending}
      onSave={(entries) =>
        save.mutate(entries, { onSuccess: () => notifySuccess('Scopes saved'), onError: (e) => notifyError(e) })
      }
    />
  );
}

function MembersTab({ r, role }: { r: RolesApi; role: Role }) {
  const [page, setPage] = useState(1);
  const holders = useQuery({ queryKey: r.keys.holders(role.id, page), queryFn: () => r.holders(role.id, page), placeholderData: keepPreviousData });
  const navigate = useNavigate();
  if (holders.isError) return <QueryError error={holders.error} />;
  return (
    <DataTable
      rows={holders.data?.items ?? []}
      loading={holders.isLoading}
      rowKey={(u) => u.id}
      onRowClick={r.level === 'organization' ? (u) => navigate(`/users/${u.id}`) : (u) => navigate(`/platform/staff?user=${u.id}`)}
      empty={{ title: 'Nobody has this role yet' }}
      pagination={holders.data && { page, totalPages: holders.data.totalPages, total: holders.data.total, onChange: setPage }}
      columns={[
        { key: 'name', header: 'Name', render: (u) => <Text fw={500}>{fullName(u)}</Text> },
        { key: 'email', header: 'Email', render: (u) => u.email },
        { key: 'status', header: 'Status', render: (u) => <EntityStatus status={u.membershipStatus} size="sm" /> },
      ]}
    />
  );
}

/** Role detail with permission matrix, scope builder (school roles) and holders. */
export function RoleDetailPage({ level }: { level: PermissionLevel }) {
  const { id = '' } = useParams();
  const r = rolesApi(level);
  const role = useRole(r, id);
  const access = useAccess();
  const navigate = useNavigate();
  const [editOpened, edit] = useDisclosure();
  const can = (action: 'update' | 'delete' | 'create') =>
    level === 'platform' ? access.canPlatform(rolePermission(level, action)) : access.canOrg(rolePermission(level, action));
  const setStatus = useRoleMutation(r, (status: 'active' | 'inactive') => r.setStatus(id, status));
  const remove = useRoleMutation(r, () => r.remove(id));
  const clone = useRoleMutation(r, (name: string) => r.clone(id, { name }));

  if (role.isError) return <QueryError error={role.error} onRetry={() => void role.refetch()} />;
  if (!role.data) return <Skeleton h={400} radius="lg" />;
  const x = role.data;
  const editable = can('update') && !x.isProtected;

  return (
    <>
      <Breadcrumbs mb="md">
        <Anchor component={Link} to={r.basePath} size="sm">
          {level === 'platform' ? 'Platform roles' : 'Roles & permissions'}
        </Anchor>
        <Text size="sm">{x.name}</Text>
      </Breadcrumbs>

      <Group justify="space-between" align="flex-start" mb="lg">
        <Stack gap={4}>
          <Group gap="sm">
            <Title order={1} fz={{ base: 24, sm: 28 }}>
              {x.name}
            </Title>
            <EntityStatus status={x.status} />
            {x.isProtected && (
              <Badge color="neutral" leftSection={<IconLock size={12} />}>
                Protected
              </Badge>
            )}
          </Group>
          <Text c="dimmed">{x.description ?? `Code ${x.code}`}</Text>
          <Text size="sm" c="dimmed">
            {x.userCount ?? 0} {level === 'platform' ? 'staff member' : 'member'}
            {x.userCount === 1 ? '' : 's'}
          </Text>
        </Stack>
        {!x.isProtected && (can('update') || can('delete') || can('create')) && (
          <Menu position="bottom-end" shadow="md" width={220}>
            <Menu.Target>
              <Button variant="default" rightSection={<IconDots size={16} />}>
                Actions
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {can('update') && (
                <Menu.Item leftSection={<IconPencil size={16} />} onClick={edit.open}>
                  Edit details
                </Menu.Item>
              )}
              {can('create') && (
                <Menu.Item
                  leftSection={<IconCopy size={16} />}
                  onClick={() =>
                    clone.mutate(`${x.name} (copy)`, {
                      onSuccess: (copy) => {
                        notifySuccess(`Created ${copy.name}`);
                        navigate(`${r.basePath}/${copy.id}`);
                      },
                      onError: (e) => notifyError(e),
                    })
                  }
                >
                  Clone role
                </Menu.Item>
              )}
              {can('update') && (
                <Menu.Item
                  leftSection={x.status === 'active' ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
                  onClick={() =>
                    confirmAction({
                      title: x.status === 'active' ? 'Deactivate this role?' : 'Activate this role?',
                      message:
                        x.status === 'active'
                          ? `Everyone with ${x.name} loses its permissions immediately. You can reactivate it later.`
                          : `Everyone with ${x.name} regains its permissions.`,
                      confirmLabel: x.status === 'active' ? 'Deactivate' : 'Activate',
                      destructive: x.status === 'active',
                      onConfirm: () => setStatus.mutateAsync(x.status === 'active' ? 'inactive' : 'active'),
                      successMessage: 'Role updated',
                    })
                  }
                >
                  {x.status === 'active' ? 'Deactivate' : 'Activate'}
                </Menu.Item>
              )}
              {can('delete') && (
                <>
                  <Menu.Divider />
                  <Menu.Item
                    color="error"
                    leftSection={<IconTrash size={16} />}
                    disabled={(x.userCount ?? 0) > 0}
                    onClick={() =>
                      confirmAction({
                        title: `Delete ${x.name}?`,
                        message: 'This permanently removes the role.',
                        confirmLabel: 'Delete role',
                        destructive: true,
                        onConfirm: async () => {
                          await remove.mutateAsync(undefined);
                          navigate(r.basePath);
                        },
                        successMessage: 'Role deleted',
                      })
                    }
                  >
                    {(x.userCount ?? 0) > 0 ? 'Delete (remove holders first)' : 'Delete role'}
                  </Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>

      <Tabs defaultValue="permissions" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="permissions">Permissions</Tabs.Tab>
          {level === 'organization' && <Tabs.Tab value="scopes">Scopes</Tabs.Tab>}
          <Tabs.Tab value="members">{level === 'platform' ? 'Staff' : 'Members'}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="permissions">
          <PermissionsTab key={x.updatedAt} r={r} role={x} editable={editable} />
        </Tabs.Panel>
        {level === 'organization' && (
          <Tabs.Panel value="scopes">
            <ScopesTab r={r} role={x} editable={editable} />
          </Tabs.Panel>
        )}
        <Tabs.Panel value="members">
          <MembersTab r={r} role={x} />
        </Tabs.Panel>
      </Tabs>

      {editOpened && <EditRoleModal r={r} role={x} opened={editOpened} onClose={edit.close} />}
    </>
  );
}
