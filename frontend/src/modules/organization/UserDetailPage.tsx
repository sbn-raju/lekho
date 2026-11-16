import { ActionIcon, Anchor, Avatar, Badge, Breadcrumbs, Button, Card, Grid, Group, Modal, Select, SimpleGrid, Skeleton, Stack, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { hasLength, useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { IconMailForward, IconPencil, IconPlus, IconUserMinus, IconX } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { EntityStatus } from '@/components/EntityStatus';
import { confirmAction, notifyError, notifySuccess } from '@/components/feedback/feedback';
import { QueryError } from '@/components/feedback/QueryState';
import { useAccess } from '@/services/api/access';
import { schoolApi, useSchoolMutation, useSchoolUser, useUserPermissions } from '@/services/api/school';
import { useCurrentUser } from '@/services/auth/auth-context';
import type { OrgUser } from '@/types/api';
import { formatDate, fromNow, fullName, humanize, initials } from '@/utils/format';
import { unitOptions, useSchoolLookups } from './useSchoolLookups';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="md">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text size="sm" ta="right">
        {children || '—'}
      </Text>
    </Group>
  );
}

function EditProfileModal({ user, onClose }: { user: OrgUser; onClose: () => void }) {
  const update = useSchoolMutation((v: { firstName: string; lastName: string; phone: string }) =>
    schoolApi.updateUser(user.id, { firstName: v.firstName, lastName: v.lastName, phone: v.phone.trim() || null }),
  );
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { firstName: user.firstName, lastName: user.lastName, phone: user.phone ?? '' },
    validate: { firstName: hasLength({ min: 1 }, 'Required'), lastName: hasLength({ min: 1 }, 'Required') },
  });
  return (
    <Modal opened onClose={onClose} title="Edit profile">
      <form
        onSubmit={form.onSubmit((v) =>
          update.mutate(v, {
            onSuccess: () => {
              notifySuccess('Profile updated');
              onClose();
            },
            onError: (e) => notifyError(e),
          }),
        )}
        noValidate
      >
        <Stack gap="md">
          <TextInput label="First name" withAsterisk key={form.key('firstName')} {...form.getInputProps('firstName')} />
          <TextInput label="Last name" withAsterisk key={form.key('lastName')} {...form.getInputProps('lastName')} />
          <TextInput label="Phone" type="tel" key={form.key('phone')} {...form.getInputProps('phone')} />
          <Text size="xs" c="dimmed">
            Email is the person's sign-in and can't be changed here. Profiles shared with another school can only be edited by their owner.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={update.isPending}>
              Save
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** FRD §14.2: profile, membership status, roles, units and effective permissions for one member. */
export function UserDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const me = useCurrentUser();
  const access = useAccess();
  const user = useSchoolUser(id);
  const permissions = useUserPermissions(id);
  const { roles, units, roleNames, unitNames } = useSchoolLookups();
  const [editing, edit] = useDisclosure();
  const [roleToAdd, setRoleToAdd] = useState<string | null>(null);
  const [unitToAdd, setUnitToAdd] = useState<string | null>(null);

  const setStatus = useSchoolMutation((status: 'active' | 'suspended' | 'inactive') => schoolApi.setUserStatus(id, status));
  const remove = useSchoolMutation(() => schoolApi.removeUser(id));
  const invite = useSchoolMutation(() => schoolApi.inviteUser(id));
  const resend = useSchoolMutation(() => schoolApi.resendUserInvitation(id));
  const assignRole = useSchoolMutation((roleId: string) => schoolApi.assignRole(id, roleId));
  const removeRole = useSchoolMutation((roleId: string) => schoolApi.removeRole(id, roleId));
  const addUnit = useSchoolMutation((unitId: string) => schoolApi.addUnitMember(unitId, id));
  const removeUnit = useSchoolMutation((unitId: string) => schoolApi.removeUnitMember(unitId, id));

  if (user.isError) return <QueryError error={user.error} onRetry={() => void user.refetch()} />;
  if (!user.data) return <Skeleton h={480} radius="lg" />;
  const u = user.data;
  const m = u.membership;
  const isSelf = u.id === me.id;
  const canUpdate = access.canOrg('users.update');
  const canAssignRoles = access.canOrg('roles.assign') && !isSelf && m.status !== 'revoked';
  const canPlace = access.canOrg('organization_units.assign') && !isSelf && m.status !== 'revoked';

  const statusAction = (status: 'active' | 'suspended' | 'inactive', label: string, destructive: boolean, message: string) => (
    <Button
      variant="default"
      color={destructive ? 'error' : undefined}
      onClick={() =>
        confirmAction({
          title: `${label} ${fullName(u)}?`,
          message,
          confirmLabel: label,
          destructive,
          onConfirm: () => setStatus.mutateAsync(status),
          successMessage: `${fullName(u)} is now ${status} in this school`,
        })
      }
    >
      {label}
    </Button>
  );

  return (
    <>
      <Breadcrumbs mb="md">
        <Anchor component={Link} to="/users" size="sm">
          Users
        </Anchor>
        <Text size="sm">{fullName(u)}</Text>
      </Breadcrumbs>

      <Group justify="space-between" align="flex-start" mb="lg">
        <Group wrap="nowrap">
          <Avatar color="lekho" radius="xl" size={56}>
            {initials(u)}
          </Avatar>
          <Stack gap={2}>
            <Group gap="sm">
              <Title order={1} fz={{ base: 22, sm: 26 }}>
                {fullName(u)}
              </Title>
              <EntityStatus status={m.status} />
              {isSelf && <Badge color="lekho">You</Badge>}
            </Group>
            <Text c="dimmed">{u.email}</Text>
          </Stack>
        </Group>
        <Group gap="sm">
          {canUpdate && !isSelf && m.status === 'active' && statusAction('suspended', 'Suspend', true, 'They lose access to this school immediately. Their Lekho account and other schools are unaffected.')}
          {canUpdate && !isSelf && m.status === 'active' && statusAction('inactive', 'Deactivate', true, 'Use for people who have left. You can reactivate them later.')}
          {canUpdate && !isSelf && (m.status === 'suspended' || m.status === 'inactive') && statusAction('active', 'Reactivate', false, 'They regain access to this school.')}
          {access.canOrg('invitations.create') && m.status === 'invited' && (
            <Button variant="default" leftSection={<IconMailForward size={16} />} loading={resend.isPending}
              onClick={() => resend.mutate(undefined, { onSuccess: () => notifySuccess('Invitation sent again'), onError: (e) => notifyError(e) })}>
              Resend invitation
            </Button>
          )}
          {access.canOrg('invitations.create') && m.status === 'revoked' && (
            <Button variant="default" leftSection={<IconMailForward size={16} />} loading={invite.isPending}
              onClick={() => invite.mutate(undefined, { onSuccess: () => notifySuccess('Invitation sent'), onError: (e) => notifyError(e) })}>
              Invite again
            </Button>
          )}
          {access.canOrg('users.delete') && !isSelf && m.status !== 'revoked' && (
            <Button
              color="error"
              variant="light"
              leftSection={<IconUserMinus size={16} />}
              onClick={() =>
                confirmAction({
                  title: `Remove ${fullName(u)} from the school?`,
                  message: 'Their membership here is revoked. Their Lekho account and memberships in other schools stay as they are.',
                  confirmLabel: 'Remove',
                  destructive: true,
                  onConfirm: async () => {
                    await remove.mutateAsync(undefined);
                    navigate('/users');
                  },
                  successMessage: 'Removed from the school',
                })
              }
            >
              Remove
            </Button>
          )}
        </Group>
      </Group>

      <Grid gap="md">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Stack gap="md">
            <Card>
              <Group justify="space-between" mb="sm">
                <Title order={3} fz={18}>
                  Roles
                </Title>
              </Group>
              <Group gap="xs" mb={canAssignRoles ? 'md' : 0}>
                {m.roleIds.length === 0 && <Text size="sm" c="dimmed">No roles yet. Without a role they can only sign in.</Text>}
                {m.roleIds.map((roleId, i) => (
                  <Badge
                    key={roleId}
                    size="lg"
                    variant="light"
                    rightSection={
                      canAssignRoles && (
                        <ActionIcon
                          size="xs"
                          variant="transparent"
                          aria-label={`Remove role ${roleNames([roleId])[0]}`}
                          onClick={() =>
                            confirmAction({
                              title: `Remove ${roleNames([roleId])[0]}?`,
                              message: 'They lose this role’s permissions immediately.',
                              confirmLabel: 'Remove role',
                              destructive: true,
                              onConfirm: () => removeRole.mutateAsync(roleId),
                              successMessage: 'Role removed',
                            })
                          }
                        >
                          <IconX size={12} />
                        </ActionIcon>
                      )
                    }
                  >
                    {roleNames(m.roleIds)[i]}
                  </Badge>
                ))}
              </Group>
              {canAssignRoles && (
                <Group gap="xs" align="flex-end">
                  <Select
                    placeholder="Add a role"
                    data={roles.filter((r) => r.status === 'active' && !m.roleIds.includes(r.id)).map((r) => ({ value: r.id, label: r.name }))}
                    value={roleToAdd}
                    onChange={setRoleToAdd}
                    searchable
                    flex={1}
                    aria-label="Role to add"
                  />
                  <Button
                    leftSection={<IconPlus size={16} />}
                    disabled={!roleToAdd}
                    loading={assignRole.isPending}
                    onClick={() =>
                      roleToAdd &&
                      assignRole.mutate(roleToAdd, {
                        onSuccess: () => {
                          setRoleToAdd(null);
                          notifySuccess('Role assigned');
                        },
                        onError: (e) => notifyError(e),
                      })
                    }
                  >
                    Assign
                  </Button>
                </Group>
              )}
            </Card>

            <Card>
              <Title order={3} fz={18} mb="sm">
                Departments, classes and sections
              </Title>
              <Stack gap="xs" mb={canPlace ? 'md' : 0}>
                {m.organizationUnitIds.length === 0 && <Text size="sm" c="dimmed">Not placed in any unit.</Text>}
                {m.organizationUnitIds.map((unitId) => (
                  <Group key={unitId} justify="space-between">
                    <Text size="sm">{unitNames([unitId])[0] ?? 'Unit'}</Text>
                    {canPlace && (
                      <Button size="xs" variant="subtle" color="error"
                        onClick={() => removeUnit.mutate(unitId, { onSuccess: () => notifySuccess('Removed from unit'), onError: (e) => notifyError(e) })}>
                        Remove
                      </Button>
                    )}
                  </Group>
                ))}
              </Stack>
              {canPlace && units.length > 0 && (
                <Group gap="xs" align="flex-end">
                  <Select
                    placeholder="Place in a unit"
                    data={unitOptions(units, (x) => x.status === 'active' && !m.organizationUnitIds.includes(x.id))}
                    value={unitToAdd}
                    onChange={setUnitToAdd}
                    searchable
                    flex={1}
                    aria-label="Unit to add"
                  />
                  <Button
                    leftSection={<IconPlus size={16} />}
                    disabled={!unitToAdd}
                    loading={addUnit.isPending}
                    onClick={() =>
                      unitToAdd &&
                      addUnit.mutate(unitToAdd, {
                        onSuccess: () => {
                          setUnitToAdd(null);
                          notifySuccess('Placed in unit');
                        },
                        onError: (e) => notifyError(e),
                      })
                    }
                  >
                    Add
                  </Button>
                </Group>
              )}
            </Card>

            <Card>
              <Title order={3} fz={18} mb="sm">
                Effective permissions
              </Title>
              {permissions.data ? (
                <Stack gap="xs">
                  {!permissions.data.effective && (
                    <Text size="sm" c="warning.8">
                      Not in effect while the membership is {permissions.data.membershipStatus}.
                    </Text>
                  )}
                  {permissions.data.allPermissions ? (
                    <Text size="sm">Every school permission (School Admin).</Text>
                  ) : permissions.data.permissions.length === 0 ? (
                    <Text size="sm" c="dimmed">None.</Text>
                  ) : (
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={4}>
                      {permissions.data.permissions.map((p) => (
                        <Tooltip key={p.code} label={p.code} withArrow>
                          <Text size="sm">{p.name}</Text>
                        </Tooltip>
                      ))}
                    </SimpleGrid>
                  )}
                </Stack>
              ) : permissions.isError ? (
                <QueryError error={permissions.error} />
              ) : (
                <Skeleton h={80} />
              )}
            </Card>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Card>
            <Group justify="space-between" mb="sm">
              <Title order={3} fz={18}>
                Profile
              </Title>
              {canUpdate && (
                <Button size="xs" variant="subtle" leftSection={<IconPencil size={14} />} onClick={edit.open}>
                  Edit
                </Button>
              )}
            </Group>
            <Stack gap="xs">
              <Row label="Email">{u.email}</Row>
              <Row label="Phone">{u.phone}</Row>
              <Row label="Account">{humanize(u.status)}</Row>
              <Row label="Joined this school">{formatDate(m.joinedAt)}</Row>
              <Row label="Membership expires">{m.expiresAt ? formatDate(m.expiresAt) : 'Never'}</Row>
              <Row label="Last sign-in">{fromNow(u.lastLoginAt)}</Row>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      {editing && <EditProfileModal user={u} onClose={edit.close} />}
    </>
  );
}
