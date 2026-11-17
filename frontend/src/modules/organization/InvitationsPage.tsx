import { Button, Group, Tabs, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconMailForward, IconUserPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { EntityStatus } from '@/components/EntityStatus';
import { PageHeader } from '@/components/PageHeader';
import { confirmAction, notifyError, notifySuccess } from '@/components/feedback/feedback';
import { QueryError } from '@/components/feedback/QueryState';
import { DataTable } from '@/components/tables/DataTable';
import { useAccess } from '@/services/api/access';
import { schoolApi, useInvitations, useSchoolMutation } from '@/services/api/school';
import type { Invitation, InvitationStatus } from '@/types/api';
import { formatDate, fromNow } from '@/utils/format';
import { CreateUserModal } from './CreateUserModal';
import { useSchoolLookups } from './useSchoolLookups';

const TABS: { value: InvitationStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'expired', label: 'Expired' },
  { value: 'revoked', label: 'Revoked' },
];

/** FRD §14.2 screen 8. */
export function InvitationsPage() {
  const access = useAccess();
  const { roleNames } = useSchoolLookups();
  const [status, setStatus] = useState<InvitationStatus>('pending');
  const [page, setPage] = useState(1);
  const [inviting, invite] = useDisclosure();
  const invitations = useInvitations({ page, status });
  const resend = useSchoolMutation((id: string) => schoolApi.resendInvitation(id));
  const revoke = useSchoolMutation((id: string) => schoolApi.revokeInvitation(id));
  const canSend = access.canOrg('invitations.create');
  const canRevoke = access.canOrg('invitations.delete');

  const actions = (inv: Invitation) => (
    <Group gap={4} justify="flex-end" wrap="nowrap" onClick={(e) => e.stopPropagation()}>
      {canSend && (inv.status === 'pending' || inv.status === 'expired') && (
        <Button size="xs" variant="subtle" leftSection={<IconMailForward size={14} />}
          onClick={() => resend.mutate(inv.id, { onSuccess: () => notifySuccess(`Sent again to ${inv.email}`), onError: (e) => notifyError(e) })}>
          Resend
        </Button>
      )}
      {canRevoke && (inv.status === 'pending' || inv.status === 'expired') && (
        <Button size="xs" variant="subtle" color="error"
          onClick={() =>
            confirmAction({
              title: 'Revoke this invitation?',
              message: `The link sent to ${inv.email} stops working, and they won't join the school.`,
              confirmLabel: 'Revoke',
              destructive: true,
              onConfirm: () => revoke.mutateAsync(inv.id),
              successMessage: 'Invitation revoked',
            })
          }>
          Revoke
        </Button>
      )}
    </Group>
  );

  return (
    <>
      <PageHeader
        title="Invitations"
        description="People invited to your school and whether they've joined."
        actions={
          canSend && (
            <Button leftSection={<IconUserPlus size={16} />} onClick={invite.open}>
              Invite someone
            </Button>
          )
        }
      />
      <Tabs value={status} onChange={(v) => { setStatus((v as InvitationStatus) ?? 'pending'); setPage(1); }} mb="md">
        <Tabs.List>
          {TABS.map((t) => (
            <Tabs.Tab key={t.value} value={t.value}>
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      {invitations.isError ? (
        <QueryError error={invitations.error} onRetry={() => void invitations.refetch()} />
      ) : (
        <DataTable
          rows={invitations.data?.items ?? []}
          loading={invitations.isFetching}
          rowKey={(i) => i.id}
          empty={{ title: `No ${status} invitations` }}
          pagination={invitations.data && { page, totalPages: invitations.data.totalPages, total: invitations.data.total, onChange: setPage }}
          columns={[
            { key: 'email', header: 'Email', render: (i) => <Text fw={500}>{i.email}</Text> },
            { key: 'roles', header: 'Roles', hiddenOnMobile: true, render: (i) => roleNames(i.proposedRoleIds).join(', ') || '—' },
            { key: 'delivery', header: 'Email delivery', hiddenOnMobile: true, render: (i) => <EntityStatus status={i.delivery.status} size="sm" /> },
            { key: 'status', header: 'Status', render: (i) => <EntityStatus status={i.status} size="sm" /> },
            {
              key: 'when',
              header: status === 'accepted' ? 'Accepted' : 'Expires',
              render: (i) => (status === 'accepted' ? formatDate(i.acceptedAt) : <Text size="sm" title={formatDate(i.expiresAt)}>{fromNow(i.expiresAt)}</Text>),
            },
            { key: 'actions', header: '', render: actions },
          ]}
        />
      )}
      <CreateUserModal opened={inviting} onClose={invite.close} inviteOnly />
    </>
  );
}
