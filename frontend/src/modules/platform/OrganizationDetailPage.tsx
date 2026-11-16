import {
  Alert,
  Anchor,
  Breadcrumbs,
  Button,
  Card,
  Grid,
  Group,
  Menu,
  Modal,
  NumberInput,
  SimpleGrid,
  Skeleton,
  Stack,
  Stepper,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { hasLength, isEmail, useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { IconChevronDown, IconMailForward, IconPencil, IconUserPlus } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { EntityStatus } from '@/components/EntityStatus';
import { notifyError, notifySuccess } from '@/components/feedback/feedback';
import { QueryError } from '@/components/feedback/QueryState';
import { DataTable } from '@/components/tables/DataTable';
import { useAccess } from '@/services/api/access';
import { platformApi, useOrganization, useOrganizationMembers, usePlatformMutation } from '@/services/api/platform';
import type { OrganizationStatus, PlatformOrganization } from '@/types/api';
import { formatDate, fullName } from '@/utils/format';
import { OrganizationFields } from './OrganizationForm';
import { toOrganizationInput, useOrganizationForm } from './organization-form';

/** Mirrors ORGANIZATION_STATUS_TRANSITIONS in the backend. */
const TRANSITIONS: Record<OrganizationStatus, OrganizationStatus[]> = {
  draft: ['archived'],
  onboarding: ['active', 'archived'],
  active: ['suspended', 'inactive', 'archived'],
  suspended: ['active', 'inactive', 'archived'],
  inactive: ['active', 'archived'],
  archived: [],
};

const STATUS_COPY: Record<OrganizationStatus, { verb: string; help: string }> = {
  active: { verb: 'Activate', help: 'Members can use the school again.' },
  suspended: { verb: 'Suspend', help: 'Every member loses access immediately until the school is reactivated.' },
  inactive: { verb: 'Deactivate', help: 'The school stops being usable. Use for schools that have left.' },
  archived: { verb: 'Archive', help: 'Permanent: archived schools cannot be reactivated or edited.' },
  draft: { verb: 'Draft', help: '' },
  onboarding: { verb: 'Onboarding', help: '' },
};

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm">{children || '—'}</Text>
    </Stack>
  );
}

function StatusModal({ org, target, onClose }: { org: PlatformOrganization; target: OrganizationStatus; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const change = usePlatformMutation(() => platformApi.setOrganizationStatus(org.id, target, reason || undefined));
  const copy = STATUS_COPY[target];
  return (
    <Modal opened onClose={onClose} title={`${copy.verb} ${org.name}?`}>
      <Stack gap="md">
        <Text>{copy.help}</Text>
        <Textarea label="Reason" description="Recorded in the audit log." autosize minRows={2} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            color={target === 'active' ? 'lekho' : 'error'}
            loading={change.isPending}
            onClick={() =>
              change.mutate(undefined, {
                onSuccess: () => {
                  notifySuccess(`${org.name} is now ${target}.`);
                  onClose();
                },
                onError: (e) => notifyError(e),
              })
            }
          >
            {copy.verb}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function EditModal({ org, onClose }: { org: PlatformOrganization; onClose: () => void }) {
  const form = useOrganizationForm(org);
  const update = usePlatformMutation((v: ReturnType<typeof form.getValues>) => platformApi.updateOrganization(org.id, toOrganizationInput(v)));
  return (
    <Modal opened onClose={onClose} title="Edit organization" size="xl">
      <form
        onSubmit={form.onSubmit((v) =>
          update.mutate(v, {
            onSuccess: () => {
              notifySuccess('Organization updated');
              onClose();
            },
            onError: (e) => notifyError(e),
          }),
        )}
        noValidate
      >
        <OrganizationFields form={form} lockIdentity />
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={update.isPending}>
            Save
          </Button>
        </Group>
      </form>
    </Modal>
  );
}

/** FRD §14.1 screen 4: provision (or replace, while unaccepted) the initial School Admin. */
function ProvisionAdminForm({ org, replacing }: { org: PlatformOrganization; replacing: boolean }) {
  const provision = usePlatformMutation((v: { firstName: string; lastName: string; email: string; phone: string; invitationExpiryDays: number }) =>
    platformApi.provisionAdmin(org.id, { ...v, phone: v.phone || undefined }),
  );
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { firstName: '', lastName: '', email: '', phone: '', invitationExpiryDays: 7 },
    validate: {
      firstName: hasLength({ min: 1, max: 100 }, 'Required'),
      lastName: hasLength({ min: 1, max: 100 }, 'Required'),
      email: isEmail('Enter a valid email address'),
    },
  });
  const submit = async (v: typeof form.values) => {
    try {
      const res = await provision.mutateAsync(v);
      notifySuccess(res.idempotent ? 'This admin was already invited; the invitation is queued again if needed.' : `Invitation sent to ${v.email}.`);
      form.reset();
    } catch (err) {
      notifyError(err);
    }
  };
  return (
    <form onSubmit={form.onSubmit(submit)} noValidate>
      <Stack gap="md">
        {replacing && (
          <Text size="sm" c="dimmed">
            Inviting a different person withdraws the current, unaccepted invitation.
          </Text>
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <TextInput label="First name" withAsterisk key={form.key('firstName')} {...form.getInputProps('firstName')} />
          <TextInput label="Last name" withAsterisk key={form.key('lastName')} {...form.getInputProps('lastName')} />
          <TextInput label="Email" type="email" withAsterisk key={form.key('email')} {...form.getInputProps('email')} />
          <TextInput label="Phone" type="tel" key={form.key('phone')} {...form.getInputProps('phone')} />
          <NumberInput label="Invitation expires after (days)" min={1} max={30} key={form.key('invitationExpiryDays')} {...form.getInputProps('invitationExpiryDays')} />
        </SimpleGrid>
        <Group justify="flex-end">
          <Button type="submit" leftSection={<IconUserPlus size={16} />} loading={form.submitting}>
            {replacing ? 'Invite this person instead' : 'Create School Admin and send invitation'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function OnboardingCard({ org }: { org: PlatformOrganization }) {
  const access = useAccess();
  const canAssign = access.canPlatform('organizations.assign');
  const members = useOrganizationMembers(org.id, 1);
  const resend = usePlatformMutation(() => platformApi.resendAdminInvitation(org.id));
  const [showReplace, setShowReplace] = useState(false);
  const state = org.onboarding.state;
  const step = state === 'active' || org.status === 'active' ? 4 : state === 'invitation_pending' || state === 'admin_activated' ? 2 : 1;
  const invited = members.data?.items.find((m) => m.user?.id === org.primaryAdminUserId);
  const pending = state === 'invitation_pending';
  const canProvision = canAssign && ['draft', 'onboarding'].includes(org.status) && (state === 'draft' || state === 'organization_created' || pending);

  return (
    <Card>
      <Title order={3} fz={18} mb="md">
        Onboarding
      </Title>
      <Stepper active={step} size="sm" mb="lg" allowNextStepsSelect={false}>
        <Stepper.Step label="Organization created" description={formatDate(org.createdAt)} />
        <Stepper.Step label="School Admin invited" description={pending ? 'Waiting for acceptance' : undefined} />
        <Stepper.Step label="Admin activated" description={org.onboarding.adminActivatedAt ? formatDate(org.onboarding.adminActivatedAt) : undefined} />
        <Stepper.Step label="Live" description={org.onboarding.completedAt ? formatDate(org.onboarding.completedAt) : undefined} />
      </Stepper>

      {pending && (
        <Alert color="info" icon={<IconMailForward size={18} />} mb="md">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">
              {invited?.user ? `${fullName(invited.user)} (${invited.user.email}) has been invited` : 'The School Admin has been invited'} and hasn't accepted yet. The school goes live when they do.
            </Text>
            {canAssign && (
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="default"
                  loading={resend.isPending}
                  onClick={() => resend.mutate(undefined, { onSuccess: () => notifySuccess('Invitation sent again'), onError: (e) => notifyError(e) })}
                >
                  Resend invitation
                </Button>
                <Button size="xs" variant="subtle" onClick={() => setShowReplace((v) => !v)}>
                  {showReplace ? 'Keep current admin' : 'Invite someone else'}
                </Button>
              </Group>
            )}
          </Stack>
        </Alert>
      )}

      {canProvision && (!pending || showReplace) && <ProvisionAdminForm org={org} replacing={pending} />}
      {step === 4 && (
        <Text size="sm" c="dimmed">
          Onboarding is complete. The School Admin manages users and roles from the school console.
        </Text>
      )}
    </Card>
  );
}

export function OrganizationDetailPage() {
  const { id = '' } = useParams();
  const access = useAccess();
  const org = useOrganization(id);
  const [membersPage, setMembersPage] = useState(1);
  const members = useOrganizationMembers(id, membersPage);
  const [editing, edit] = useDisclosure();
  const [target, setTarget] = useState<OrganizationStatus | null>(null);

  if (org.isError) return <QueryError error={org.error} onRetry={() => void org.refetch()} />;
  if (!org.data) return <Skeleton h={480} radius="lg" />;
  const o = org.data;
  const transitions = TRANSITIONS[o.status];

  return (
    <>
      <Breadcrumbs mb="md">
        <Anchor component={Link} to="/platform/organizations" size="sm">
          Organizations
        </Anchor>
        <Text size="sm">{o.name}</Text>
      </Breadcrumbs>

      <Group justify="space-between" align="flex-start" mb="lg">
        <Stack gap={4}>
          <Group gap="sm">
            <Title order={1} fz={{ base: 24, sm: 28 }}>
              {o.name}
            </Title>
            <EntityStatus status={o.status} />
          </Group>
          <Text c="dimmed">
            {o.code} · {o.slug}
          </Text>
        </Stack>
        <Group gap="sm">
          {access.canPlatform('organizations.update') && o.status !== 'archived' && (
            <Button variant="default" leftSection={<IconPencil size={16} />} onClick={edit.open}>
              Edit
            </Button>
          )}
          {access.canPlatform('organizations.manage') && transitions.length > 0 && (
            <Menu position="bottom-end" shadow="md">
              <Menu.Target>
                <Button variant="default" rightSection={<IconChevronDown size={16} />}>
                  Change status
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {transitions.map((t) => (
                  <Menu.Item key={t} color={t === 'active' ? undefined : 'error'} onClick={() => setTarget(t)}>
                    {STATUS_COPY[t].verb}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>

      <Grid gap="md">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="md">
            <OnboardingCard org={o} />
            <Stack gap="sm">
              <Title order={3} fz={18}>
                Members
              </Title>
              <DataTable
                rows={members.data?.items ?? []}
                loading={members.isFetching}
                rowKey={(m) => m.id}
                empty={{ title: 'No members yet' }}
                pagination={members.data && { page: membersPage, totalPages: members.data.totalPages, total: members.data.total, onChange: setMembersPage }}
                columns={[
                  { key: 'name', header: 'Name', render: (m) => <Text fw={500}>{fullName(m.user)}</Text> },
                  { key: 'email', header: 'Email', render: (m) => m.user?.email ?? '—' },
                  { key: 'roles', header: 'Roles', hiddenOnMobile: true, render: (m) => m.roles.map((r) => r.name).join(', ') || '—' },
                  { key: 'status', header: 'Status', render: (m) => <EntityStatus status={m.status} size="sm" /> },
                ]}
              />
            </Stack>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Card>
            <Title order={3} fz={18} mb="md">
              Details
            </Title>
            <Stack gap="sm">
              <Detail label="Contact email">{o.contact.email}</Detail>
              <Detail label="Phone">{o.contact.phone}</Detail>
              <Detail label="Address">{[o.address.line1, o.address.city, o.address.state, o.address.postalCode, o.address.country].filter(Boolean).join(', ')}</Detail>
              <Detail label="Timezone">{o.settings.timezone}</Detail>
              <Detail label="Academic year">{o.settings.academicYear}</Detail>
              <Detail label="Created">{formatDate(o.createdAt)}</Detail>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      {editing && <EditModal org={o} onClose={edit.close} />}
      {target && <StatusModal org={o} target={target} onClose={() => setTarget(null)} />}
    </>
  );
}
