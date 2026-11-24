import { Alert, Badge, Button, Card, Group, Menu, Modal, Pagination, Select, SimpleGrid, Skeleton, Stack, Table, Tabs, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconArchive, IconArrowBackUp, IconChevronDown, IconEdit, IconHash, IconId, IconLock, IconPencil, IconRefresh, IconUserCheck } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { EntityStatus } from '@/components/EntityStatus';
import { confirmAction, errorMessage, notifySuccess } from '@/components/feedback/feedback';
import { QueryError } from '@/components/feedback/QueryState';
import { useAccess } from '@/services/api/access';
import { useSchoolMutation } from '@/services/api/school';
import { studentsApi, useStudentHistory, useStudentProfile } from '@/services/api/students';
import type { StudentDetail, StudentStatus } from '@/types/students';
import { formatDate, formatDateTime, humanize } from '@/utils/format';
import { GuardiansPanel } from './GuardiansPanel';
import { IdCardPanel } from './IdCardPanel';
import { PhotoPanel } from './PhotoPanel';
import { PlacementPanel } from './PlacementPanel';
import { StudentAvatar } from './StudentAvatar';
import { StudentDetailsForm } from './StudentDetailsForm';
import { GENDER_LABEL, STATUS_LABEL, addressText, formatPhone, placementText } from './student-helpers';

/** Student profile (FRD §10). Read-only for teachers; fields the viewer can't see aren't sent. */
export function StudentProfilePage() {
  const { id } = useParams() as { id: string };
  const access = useAccess();
  const [params, setParams] = useSearchParams();
  const profile = useStudentProfile(id);
  const [modal, setModal] = useState<'edit' | 'status' | 'admission' | null>(null);

  if (profile.isError) return <QueryError error={profile.error} onRetry={() => void profile.refetch()} />;
  if (!profile.data) return <Skeleton h={400} radius="lg" />;
  const { student: s, guardians, assignments, admission, idCards } = profile.data;
  const tab = params.get('tab') ?? 'overview';
  const canUpdate = access.canOrg('students.update') && !s.archived;
  const canCards = access.canOrg('student_id_cards.generate') && s.registrationStatus === 'completed';

  return (
    <>
      <Group justify="space-between" align="flex-start" mb="lg" gap="md">
        <Group gap="md" wrap="nowrap">
          <StudentAvatar student={s} large size={88} radius="lg" />
          <Stack gap={4}>
            <Group gap="sm">
              <Title order={1} fz={{ base: 22, sm: 26 }}>
                {s.fullName}
              </Title>
              <EntityStatus status={s.archived ? 'archived' : s.status} />
            </Group>
            <Text c="dimmed" className="tabular-nums">
              {s.admissionNumber ? `Admission no. ${s.admissionNumber}` : 'Registration not completed'}
              {s.currentAssignment ? ` · ${placementText(s.currentAssignment)} (${s.currentAssignment.academicYear?.name})` : ''}
            </Text>
            {s.statusReason && s.status !== 'active' && (
              <Text size="sm" c="dimmed">
                {STATUS_LABEL[s.status]} {formatDate(s.statusChangedAt)}: {s.statusReason}
              </Text>
            )}
          </Stack>
        </Group>
        <Group gap="sm">
          {s.registrationStatus === 'draft' && access.canOrg('students.create') && (
            <Button component={Link} to={`/students/${s.id}/register`} leftSection={<IconUserCheck size={16} />}>
              Continue registration
            </Button>
          )}
          {canUpdate && s.registrationStatus === 'completed' && (
            <Button variant="default" leftSection={<IconEdit size={16} />} onClick={() => setModal('edit')}>
              Edit
            </Button>
          )}
          <ProfileActions student={s} onStatus={() => setModal('status')} onAdmission={() => setModal('admission')} onIdCard={canCards ? () => setParams({ tab: 'id-card' }) : undefined} />
        </Group>
      </Group>

      {s.archived && (
        <Alert color="neutral" variant="light" icon={<IconArchive size={18} />} mb="md">
          This record was archived {formatDate(s.archivedAt)}. It is kept for history and can be restored.
        </Alert>
      )}
      {s.registrationStatus === 'completed' && s.hasVerifiedContact === false && (
        <Alert color="warning" variant="light" mb="md">
          No parent or guardian mobile number is verified. Verify one under Parents & guardians.
        </Alert>
      )}

      <Tabs value={tab} onChange={(v) => setParams({ tab: v ?? 'overview' }, { replace: true })} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="personal">Personal information</Tabs.Tab>
          {guardians && <Tabs.Tab value="guardians">Parents & guardians</Tabs.Tab>}
          <Tabs.Tab value="academic">Academic history</Tabs.Tab>
          <Tabs.Tab value="photo">Photo</Tabs.Tab>
          {canCards && <Tabs.Tab value="id-card">ID card</Tabs.Tab>}
          {access.canOrg('audit_logs.read') && <Tabs.Tab value="activity">Activity</Tabs.Tab>}
        </Tabs.List>

        <Tabs.Panel value="overview">
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <Card>
              <Title order={4} mb="sm">
                Student
              </Title>
              <Facts
                rows={[
                  ['Admission number', s.admissionNumber ?? '—'],
                  ['Admitted', formatDate(s.admittedAt)],
                  ['Date of birth', s.dateOfBirth ? `${formatDate(s.dateOfBirth)} (age ${s.age})` : '—'],
                  ['Gender', s.gender ? GENDER_LABEL[s.gender] : '—'],
                  ['Blood group', s.bloodGroup ?? '—'],
                ]}
              />
            </Card>
            <Card>
              <Title order={4} mb="sm">
                Current class
              </Title>
              <Facts
                rows={[
                  ['Academic year', s.currentAssignment?.academicYear?.name ?? '—'],
                  ['Class', s.currentAssignment?.class?.name ?? 'Not placed'],
                  ['Section', s.currentAssignment?.section?.name ?? '—'],
                  ['Since', formatDate(s.currentAssignment?.startDate)],
                ]}
              />
            </Card>
            {s.primaryContact !== undefined && (
              <Card>
                <Title order={4} mb="sm">
                  Primary contact
                </Title>
                {s.primaryContact ? (
                  <Facts
                    rows={[
                      ['Name', s.primaryContact.name],
                      ['Relationship', humanize(s.primaryContact.relationship)],
                      ['Mobile', <Group gap="xs" key="m">{formatPhone(s.primaryContact.mobileNumber)}<EntityStatus status={s.primaryContact.verified ? 'verified' : 'unverified'} size="sm" /></Group>],
                    ]}
                  />
                ) : (
                  <Text c="dimmed">{guardians ? 'No primary contact yet.' : "You don't have access to contact details."}</Text>
                )}
              </Card>
            )}
          </SimpleGrid>
        </Tabs.Panel>

        <Tabs.Panel value="personal">
          <PersonalTab student={s} />
        </Tabs.Panel>
        {guardians && (
          <Tabs.Panel value="guardians">
            <GuardiansPanel studentId={s.id} guardians={guardians} canManage={access.canOrg('guardians.manage') && !s.archived} />
          </Tabs.Panel>
        )}
        <Tabs.Panel value="academic">
          <PlacementPanel student={s} placements={assignments} canManage={access.canOrg('student_assignments.manage') && access.canOrg('classes.read')} />
          {admission.history.length > 0 && (
            <Card mt="lg">
              <Title order={5} mb="xs">
                Admission number corrections
              </Title>
              {admission.history.map((h) => (
                <Text size="sm" key={h.changedAt}>
                  {formatDate(h.changedAt)}: {h.from} → {h.to} ({h.reason})
                </Text>
              ))}
            </Card>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="photo">
          <PhotoPanel student={s} canEdit={canUpdate} />
        </Tabs.Panel>
        {canCards && (
          <Tabs.Panel value="id-card">
            <IdCardPanel studentId={s.id} history={idCards} />
          </Tabs.Panel>
        )}
        {access.canOrg('audit_logs.read') && (
          <Tabs.Panel value="activity">
            <ActivityTab studentId={s.id} />
          </Tabs.Panel>
        )}
      </Tabs>

      {modal === 'edit' && (
        <Modal opened onClose={() => setModal(null)} title={`Edit ${s.fullName}`} size="xl">
          <EditStudent student={s} onDone={() => setModal(null)} />
        </Modal>
      )}
      {modal === 'status' && <StatusModal student={s} onClose={() => setModal(null)} />}
      {modal === 'admission' && <AdmissionModal student={s} onClose={() => setModal(null)} />}
    </>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <Table variant="vertical" withRowBorders={false} verticalSpacing={6}>
      <Table.Tbody>
        {rows.map(([k, v]) => (
          <Table.Tr key={k}>
            <Table.Th w={180} fw={500} c="dimmed">
              {k}
            </Table.Th>
            <Table.Td>{v}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function PersonalTab({ student: s }: { student: StudentDetail }) {
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      <Card>
        <Facts
          rows={[
            ['First name', s.firstName],
            ['Middle name', s.middleName ?? '—'],
            ['Last name', s.lastName ?? '—'],
            ['Nationality', s.nationality ?? '—'],
            ['Mother tongue', s.motherTongue ?? '—'],
            ['Previous school', s.previousSchool ?? '—'],
            ['Previous class', s.previousClass ?? '—'],
          ]}
        />
      </Card>
      <Card>
        <Facts
          rows={[
            ['Residential address', addressText(s.addresses.residential)],
            ['Permanent address', s.addresses.permanentSameAsResidential ? 'Same as residential' : addressText(s.addresses.permanent)],
          ]}
        />
      </Card>
      {s.sensitive && (
        <Card>
          <Group gap="xs" mb="sm">
            <IconLock size={16} stroke={1.75} />
            <Title order={5}>Sensitive information</Title>
            <Badge size="xs" variant="light" color="neutral">
              Views are audited
            </Badge>
          </Group>
          <Facts
            rows={[
              ['Religion', s.sensitive.religion ?? '—'],
              ['Caste category', s.sensitive.casteCategory ?? '—'],
              ['Caste / sub-caste', s.sensitive.caste ?? '—'],
              ['Medical notes', s.sensitive.medicalNotes ?? '—'],
            ]}
          />
        </Card>
      )}
    </SimpleGrid>
  );
}

function EditStudent({ student, onDone }: { student: StudentDetail; onDone: () => void }) {
  const update = useSchoolMutation((body: Parameters<typeof studentsApi.update>[1]) => studentsApi.update(student.id, body));
  return (
    <StudentDetailsForm
      student={student}
      mode="registered"
      sensitiveAllowed={student.permissions.sensitive}
      submitLabel="Save changes"
      onSubmit={async (input) => {
        await update.mutateAsync(input);
        notifySuccess('Student updated');
        onDone();
      }}
      secondaryAction={
        <Button variant="default" onClick={onDone}>
          Cancel
        </Button>
      }
    />
  );
}

function ProfileActions({ student: s, onStatus, onAdmission, onIdCard }: { student: StudentDetail; onStatus: () => void; onAdmission: () => void; onIdCard?: () => void }) {
  const access = useAccess();
  const navigate = useNavigate();
  const remove = useSchoolMutation(() => studentsApi.remove(s.id));
  const restore = useSchoolMutation(() => studentsApi.restore(s.id));
  const items: ReactNode[] = [];
  if (onIdCard) items.push(<Menu.Item key="card" leftSection={<IconId size={16} stroke={1.75} />} onClick={onIdCard}>Generate ID card</Menu.Item>);
  if (access.canOrg('students.update') && !s.archived && s.registrationStatus === 'completed') items.push(<Menu.Item key="status" leftSection={<IconRefresh size={16} stroke={1.75} />} onClick={onStatus}>Change status…</Menu.Item>);
  if (access.canOrg('students.configure') && s.admissionNumber) items.push(<Menu.Item key="adm" leftSection={<IconHash size={16} stroke={1.75} />} onClick={onAdmission}>Correct admission number…</Menu.Item>);
  if (access.canOrg('students.delete')) {
    items.push(
      s.archived ? (
        <Menu.Item key="restore" leftSection={<IconArrowBackUp size={16} stroke={1.75} />} onClick={() => restore.mutate(undefined, { onSuccess: () => notifySuccess('Student restored') })}>
          Restore
        </Menu.Item>
      ) : (
        <Menu.Item
          key="archive"
          color="error"
          leftSection={<IconArchive size={16} stroke={1.75} />}
          onClick={() =>
            confirmAction({
              title: s.registrationStatus === 'draft' ? `Delete draft for ${s.fullName}?` : `Archive ${s.fullName}?`,
              message:
                s.registrationStatus === 'draft'
                  ? 'The draft and its contacts are deleted permanently.'
                  : 'The student is hidden from lists but the record, admission number and history are kept. You can restore it later.',
              confirmLabel: s.registrationStatus === 'draft' ? 'Delete draft' : 'Archive',
              destructive: true,
              onConfirm: async () => {
                const r = await remove.mutateAsync(undefined);
                if (r.deleted) navigate('/students', { replace: true });
              },
              successMessage: s.registrationStatus === 'draft' ? 'Draft deleted' : 'Student archived',
            })
          }
        >
          {s.registrationStatus === 'draft' ? 'Delete draft' : 'Archive'}
        </Menu.Item>
      ),
    );
  }
  if (items.length === 0) return null;
  return (
    <Menu position="bottom-end" shadow="md">
      <Menu.Target>
        <Button variant="default" rightSection={<IconChevronDown size={14} />}>
          Actions
        </Button>
      </Menu.Target>
      <Menu.Dropdown>{items}</Menu.Dropdown>
    </Menu>
  );
}

const NEXT_STATUSES: Record<StudentStatus, Exclude<StudentStatus, 'draft'>[]> = {
  draft: [],
  active: ['inactive', 'transferred', 'withdrawn', 'graduated'],
  inactive: ['active', 'transferred', 'withdrawn', 'graduated'],
  transferred: ['active'],
  withdrawn: ['active'],
  graduated: ['active'],
};

function StatusModal({ student, onClose }: { student: StudentDetail; onClose: () => void }) {
  const options = NEXT_STATUSES[student.status];
  const [status, setStatus] = useState(options[0]!);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const change = useSchoolMutation(() => studentsApi.setStatus(student.id, { status, reason: reason.trim() || undefined, effectiveDate: date || undefined }));
  const leaving = ['transferred', 'withdrawn', 'graduated'].includes(status);
  return (
    <Modal opened onClose={onClose} title={`Change status of ${student.fullName}`}>
      <Stack gap="md">
        <Select
          label="New status"
          data={options.map((o) => ({ value: o, label: o === 'active' && student.status !== 'inactive' ? 'Active (re-admit)' : o === 'transferred' ? 'Transferred to another school' : STATUS_LABEL[o] }))}
          value={status}
          onChange={(v) => v && setStatus(v as typeof status)}
          allowDeselect={false}
        />
        {leaving && (
          <Alert color="info" variant="light">
            The current class placement is closed. The record and its history are kept.
          </Alert>
        )}
        <Textarea label="Reason" withAsterisk={leaving} autosize minRows={2} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        {leaving && <TextInput type="date" label="Effective date" description="Defaults to today." value={date} onChange={(e) => setDate(e.currentTarget.value)} />}
        {error && (
          <Alert color="error" variant="light">
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={change.isPending}
            disabled={leaving && !reason.trim()}
            onClick={() =>
              change.mutate(undefined, {
                onSuccess: () => {
                  notifySuccess('Status updated');
                  onClose();
                },
                onError: (e) => setError(errorMessage(e)),
              })
            }
          >
            Update status
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function AdmissionModal({ student, onClose }: { student: StudentDetail; onClose: () => void }) {
  const [value, setValue] = useState(student.admissionNumber ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const correct = useSchoolMutation(() => studentsApi.correctAdmissionNumber(student.id, { admissionNumber: value.trim(), reason: reason.trim() }));
  return (
    <Modal opened onClose={onClose} title="Correct admission number">
      <Stack gap="md">
        <Alert color="warning" variant="light">
          Only correct an admission number in exceptional cases, such as matching an existing paper register. The old number is retired and never reissued.
        </Alert>
        <TextInput label="Admission number" value={value} onChange={(e) => setValue(e.currentTarget.value)} />
        <Textarea label="Reason" withAsterisk autosize minRows={2} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        {error && (
          <Alert color="error" variant="light">
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            leftSection={<IconPencil size={16} />}
            loading={correct.isPending}
            disabled={!value.trim() || !reason.trim() || value.trim() === student.admissionNumber}
            onClick={() =>
              correct.mutate(undefined, {
                onSuccess: () => {
                  notifySuccess('Admission number corrected');
                  onClose();
                },
                onError: (e) => setError(errorMessage(e)),
              })
            }
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

const ACTION_LABEL: Record<string, string> = {
  'student.created': 'Registration started',
  'student.updated': 'Details updated',
  'student.registered': 'Registration completed',
  'student.admission_number_generated': 'Admission number issued',
  'student.admission_number_corrected': 'Admission number corrected',
  'student.status_changed': 'Status changed',
  'student.archived': 'Archived',
  'student.restored': 'Restored',
  'student.photo_uploaded': 'Photo uploaded',
  'student.photo_replaced': 'Photo replaced',
  'student.photo_removed': 'Photo removed',
  'student.sensitive_viewed': 'Sensitive information viewed',
  'guardian.added': 'Contact added',
  'guardian.updated': 'Contact updated',
  'guardian.removed': 'Contact removed',
  'guardian.mobile_changed': 'Contact mobile changed',
  'guardian.otp_sent': 'OTP sent',
  'guardian.otp_failed': 'OTP attempt failed',
  'guardian.otp_limited': 'OTP limit reached',
  'guardian.mobile_verified': 'Mobile verified',
  'student_assignment.created': 'Class assigned',
  'student_assignment.transferred': 'Transferred section',
  'student_assignment.corrected': 'Placement corrected',
  'student_assignment.closed': 'Placement closed',
  'id_card.generated': 'ID card generated',
};

function ActivityTab({ studentId }: { studentId: string }) {
  const [page, setPage] = useState(1);
  const history = useStudentHistory(studentId, page);
  if (history.isError) return <QueryError error={history.error} />;
  if (!history.data) return <Skeleton h={200} />;
  const describe = (m: Record<string, unknown> | null) => {
    if (!m) return '';
    const parts: string[] = [];
    if (Array.isArray(m.changedFields)) parts.push(`Fields: ${(m.changedFields as string[]).map(humanize).join(', ')}`);
    if (typeof m.reason === 'string') parts.push(`Reason: ${m.reason}`);
    if (typeof m.to === 'string') parts.push(`To ${m.to}`);
    if (typeof m.mobile === 'string') parts.push(m.mobile);
    return parts.join(' · ');
  };
  return (
    <Card p={0}>
      <Table verticalSpacing="sm" horizontalSpacing="md">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>When</Table.Th>
            <Table.Th>What</Table.Th>
            <Table.Th visibleFrom="sm">Details</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {history.data.items.map((e) => (
            <Table.Tr key={e.id}>
              <Table.Td className="tabular-nums">{formatDateTime(e.createdAt)}</Table.Td>
              <Table.Td>{ACTION_LABEL[e.action] ?? humanize(e.action)}</Table.Td>
              <Table.Td visibleFrom="sm">
                <Text size="sm" c="dimmed">
                  {describe(e.metadata)}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {history.data.totalPages > 1 && (
        <Group justify="flex-end" p="md">
          <Pagination value={page} total={history.data.totalPages} onChange={setPage} size="sm" />
        </Group>
      )}
    </Card>
  );
}
