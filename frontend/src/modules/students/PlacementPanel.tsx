import { ActionIcon, Alert, Badge, Button, Checkbox, Group, Menu, Modal, Select, SimpleGrid, Stack, Text, TextInput, Textarea, Timeline } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconArrowsExchange, IconDots, IconFlag, IconPencil, IconPlus, IconSchool } from '@tabler/icons-react';
import { useState } from 'react';
import { EntityStatus } from '@/components/EntityStatus';
import { errorMessage, notifySuccess } from '@/components/feedback/feedback';
import { ApiError } from '@/services/api/client';
import { useAcademicYears, useClasses, useSections } from '@/services/api/academics';
import { useSchoolMutation } from '@/services/api/school';
import { studentsApi, type PlacementInput } from '@/services/api/students';
import type { Placement, StudentSummary } from '@/types/students';
import { formatDate } from '@/utils/format';
import { OUTCOME_LABEL, PLACEMENT_TYPE_LABEL } from './student-helpers';

/** Academic history (FRD §7.4): placements newest first, with assign / transfer / correct / close. */
export function PlacementPanel({ student, placements, canManage }: { student: StudentSummary; placements: Placement[]; canManage: boolean }) {
  const [modal, setModal] = useState<{ kind: 'assign' } | { kind: 'transfer'; current: Placement } | { kind: 'correct'; placement: Placement } | { kind: 'close'; placement: Placement } | null>(null);
  const enrolled = student.registrationStatus === 'completed' && ['active', 'inactive'].includes(student.status) && !student.archived;
  const current = placements.find((p) => p.status === 'active' && p.academicYear?.status === 'active') ?? placements.find((p) => p.status === 'active');

  return (
    <Stack gap="md">
      {canManage && enrolled && (
        <Group>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setModal({ kind: 'assign' })}>
            Assign class
          </Button>
          {current && (
            <Button variant="default" leftSection={<IconArrowsExchange size={16} />} onClick={() => setModal({ kind: 'transfer', current })}>
              Transfer section
            </Button>
          )}
        </Group>
      )}
      {!enrolled && student.registrationStatus === 'draft' && (
        <Alert color="info" variant="light">
          Complete the registration to place this student in a class.
        </Alert>
      )}
      {placements.length === 0 ? (
        <Text c="dimmed">No class placements yet.</Text>
      ) : (
        <Timeline bulletSize={28} lineWidth={2} active={placements.findIndex((p) => p.status === 'active')}>
          {placements.map((p) => (
            <Timeline.Item key={p.id} bullet={<IconSchool size={14} />}>
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Stack gap={2}>
                  <Group gap="xs">
                    <Text fw={600}>
                      {p.class?.name} – Section {p.section?.name}
                    </Text>
                    <EntityStatus status={p.status} size="sm" />
                    {p.outcome && (
                      <Badge size="sm" variant="light" color="neutral">
                        {OUTCOME_LABEL[p.outcome]}
                      </Badge>
                    )}
                  </Group>
                  <Text size="sm" c="dimmed">
                    {p.academicYear?.name} · {PLACEMENT_TYPE_LABEL[p.assignmentType]} · {formatDate(p.startDate)}
                    {p.endDate ? ` – ${formatDate(p.endDate)}` : ''}
                    {p.section?.room ? ` · Room ${p.section.room}` : ''}
                  </Text>
                  {p.notes && <Text size="sm">{p.notes}</Text>}
                  {p.corrections.length > 0 && (
                    <Text size="xs" c="dimmed">
                      Corrected {p.corrections.length}×; last: “{p.corrections[p.corrections.length - 1]!.reason}”
                    </Text>
                  )}
                </Stack>
                {canManage && (
                  <Menu position="bottom-end" shadow="md">
                    <Menu.Target>
                      <ActionIcon variant="subtle" color="neutral" aria-label="Placement actions">
                        <IconDots size={18} stroke={1.75} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item leftSection={<IconPencil size={16} stroke={1.75} />} onClick={() => setModal({ kind: 'correct', placement: p })}>
                        Correct…
                      </Menu.Item>
                      {p.status === 'active' && (
                        <Menu.Item leftSection={<IconFlag size={16} stroke={1.75} />} onClick={() => setModal({ kind: 'close', placement: p })}>
                          Close year (promoted / retained)
                        </Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Group>
            </Timeline.Item>
          ))}
        </Timeline>
      )}
      {modal?.kind === 'assign' && <AssignModal studentId={student.id} placements={placements} onClose={() => setModal(null)} />}
      {modal?.kind === 'transfer' && <TransferModal studentId={student.id} current={modal.current} onClose={() => setModal(null)} />}
      {modal?.kind === 'correct' && <CorrectModal studentId={student.id} placement={modal.placement} onClose={() => setModal(null)} />}
      {modal?.kind === 'close' && <CloseModal studentId={student.id} placement={modal.placement} onClose={() => setModal(null)} />}
    </Stack>
  );
}

/** Year → class → section pickers. Only open (planned / active) years can take new placements. */
export function PlacementPicker({ value, onChange, lockYear, openYearsOnly = true }: { value: Partial<PlacementInput>; onChange: (v: Partial<PlacementInput>) => void; lockYear?: boolean; openYearsOnly?: boolean }) {
  const years = useAcademicYears();
  const classes = useClasses(value.academicYearId, !!value.academicYearId);
  const sections = useSections(value.academicYearId);
  const yearOptions = (years.data ?? []).filter((y) => !openYearsOnly || y.status === 'planned' || y.status === 'active').map((y) => ({ value: y.id, label: y.isCurrent ? `${y.name} · current` : `${y.name} · ${y.status}` }));
  const sectionOptions = (sections.data ?? [])
    .filter((s) => s.classId === value.classId && s.status === 'active')
    .map((s) => ({ value: s.id, label: `Section ${s.name}${s.room ? ` · Room ${s.room}` : ''} (${s.capacity} seats)` }));
  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
      <Select label="Academic year" withAsterisk data={yearOptions} value={value.academicYearId ?? null} disabled={lockYear} onChange={(v) => onChange({ academicYearId: v ?? undefined, classId: undefined, sectionId: undefined })} />
      <Select
        label="Class"
        withAsterisk
        data={(classes.data?.items ?? []).filter((c) => c.status === 'active').map((c) => ({ value: c.id, label: c.name }))}
        value={value.classId ?? null}
        disabled={!value.academicYearId}
        onChange={(v) => onChange({ ...value, classId: v ?? undefined, sectionId: undefined })}
        searchable
      />
      <Select label="Section" withAsterisk data={sectionOptions} value={value.sectionId ?? null} disabled={!value.classId} onChange={(v) => onChange({ ...value, sectionId: v ?? undefined })} nothingFoundMessage="No sections" />
    </SimpleGrid>
  );
}

function useCapacityRetry() {
  const [full, setFull] = useState<string | null>(null);
  const handle = (err: unknown) => {
    if (err instanceof ApiError && (err.details as { reason?: string })?.reason === 'section_full') {
      setFull(err.message);
      return true;
    }
    return false;
  };
  return { full, setFull, handle };
}

function AssignModal({ studentId, placements, onClose }: { studentId: string; placements: Placement[]; onClose: () => void }) {
  const years = useAcademicYears();
  const current = years.data?.find((y) => y.isCurrent);
  const [value, setValue] = useState<Partial<PlacementInput>>({});
  const [type, setType] = useState<PlacementInput['assignmentType']>(placements.some((p) => p.status === 'active') ? 'promotion' : 'placement');
  const [startDate, setStartDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const capacity = useCapacityRetry();
  const assign = useSchoolMutation((body: PlacementInput) => studentsApi.assign(studentId, body));
  const yearId = value.academicYearId ?? current?.id;

  const submit = async (allowOverCapacity = false) => {
    setError(null);
    try {
      await assign.mutateAsync({ ...value, academicYearId: yearId!, classId: value.classId!, sectionId: value.sectionId!, assignmentType: type, startDate: startDate || undefined, allowOverCapacity });
      notifySuccess('Class assigned');
      onClose();
    } catch (err) {
      if (!capacity.handle(err)) setError(errorMessage(err));
    }
  };
  return (
    <Modal opened onClose={onClose} title="Assign class" size="lg">
      <Stack gap="md">
        <PlacementPicker value={{ ...value, academicYearId: yearId }} onChange={setValue} />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Select
            label="Placement type"
            data={[
              { value: 'placement', label: 'New placement' },
              { value: 'admission', label: 'Admission' },
              { value: 'promotion', label: 'Promotion (closes last year as promoted)' },
              { value: 'retention', label: 'Retained (closes last year as retained)' },
              { value: 'readmission', label: 'Re-admission' },
            ]}
            value={type}
            onChange={(v) => setType((v as PlacementInput['assignmentType']) ?? 'placement')}
            allowDeselect={false}
          />
          <TextInput type="date" label="Start date" description="Defaults to today (within the year)." value={startDate} onChange={(e) => setStartDate(e.currentTarget.value)} />
        </SimpleGrid>
        {error && (
          <Alert color="error" variant="light">
            {error}
          </Alert>
        )}
        {capacity.full && (
          <Alert color="warning" variant="light" title="Section is full">
            <Stack gap="xs" align="flex-start">
              {capacity.full}
              <Button size="xs" variant="default" onClick={() => void submit(true)} loading={assign.isPending}>
                Place anyway
              </Button>
            </Stack>
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={assign.isPending} disabled={!yearId || !value.classId || !value.sectionId}>
            Assign
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function TransferModal({ studentId, current, onClose }: { studentId: string; current: Placement; onClose: () => void }) {
  const [value, setValue] = useState<Partial<PlacementInput>>({ academicYearId: current.academicYear?.id, classId: current.class?.id });
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const capacity = useCapacityRetry();
  const transfer = useSchoolMutation((body: { sectionId: string; effectiveDate?: string; reason?: string; allowOverCapacity?: boolean }) => studentsApi.transfer(studentId, body));
  const submit = async (allowOverCapacity = false) => {
    setError(null);
    try {
      await transfer.mutateAsync({ sectionId: value.sectionId!, effectiveDate: effectiveDate || undefined, reason: reason.trim() || undefined, allowOverCapacity });
      notifySuccess('Student transferred');
      onClose();
    } catch (err) {
      if (!capacity.handle(err)) setError(errorMessage(err));
    }
  };
  return (
    <Modal opened onClose={onClose} title="Transfer to another section" size="lg">
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Currently in {current.class?.name} – Section {current.section?.name} ({current.academicYear?.name}). The current placement is closed and kept in the history.
        </Text>
        <PlacementPicker value={value} onChange={setValue} lockYear />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <TextInput type="date" label="Effective date" description="Defaults to today." value={effectiveDate} onChange={(e) => setEffectiveDate(e.currentTarget.value)} />
          <TextInput label="Reason" value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        </SimpleGrid>
        {error && (
          <Alert color="error" variant="light">
            {error}
          </Alert>
        )}
        {capacity.full && (
          <Alert color="warning" variant="light" title="Section is full">
            <Stack gap="xs" align="flex-start">
              {capacity.full}
              <Button size="xs" variant="default" onClick={() => void submit(true)}>
                Transfer anyway
              </Button>
            </Stack>
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={transfer.isPending} disabled={!value.sectionId || value.sectionId === current.section?.id}>
            Transfer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function CorrectModal({ studentId, placement, onClose }: { studentId: string; placement: Placement; onClose: () => void }) {
  const [value, setValue] = useState<Partial<PlacementInput>>({ academicYearId: placement.academicYear?.id, classId: placement.class?.id, sectionId: placement.section?.id });
  const [error, setError] = useState<string | null>(null);
  const correct = useSchoolMutation((body: Parameters<typeof studentsApi.correctAssignment>[2]) => studentsApi.correctAssignment(studentId, placement.id, body));
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { startDate: placement.startDate, endDate: placement.endDate ?? '', notes: placement.notes ?? '', reason: '' },
    validate: { reason: (v) => (v.trim() ? null : 'Say why this is being corrected') },
  });
  const locked = placement.academicYear && !['planned', 'active'].includes(placement.academicYear.status);
  const submit = async (v: typeof form.values) => {
    setError(null);
    try {
      await correct.mutateAsync({
        ...(value.classId !== placement.class?.id && { classId: value.classId }),
        ...(value.sectionId !== placement.section?.id && { sectionId: value.sectionId }),
        ...(v.startDate !== placement.startDate && { startDate: v.startDate }),
        ...(v.endDate !== (placement.endDate ?? '') && { endDate: v.endDate || null }),
        ...(v.notes !== (placement.notes ?? '') && { notes: v.notes.trim() || null }),
        reason: v.reason.trim(),
      });
      notifySuccess('Placement corrected');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal opened onClose={onClose} title="Correct placement" size="lg">
      <form onSubmit={form.onSubmit(submit)} noValidate>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Use a correction to fix a data-entry mistake. To move a student who changed sections, transfer them instead so the history shows both.
            {locked ? ` ${placement.academicYear?.name} is ${placement.academicYear?.status}; corrections are still allowed and audited.` : ''}
          </Text>
          <PlacementPicker value={value} onChange={setValue} lockYear openYearsOnly={false} />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput type="date" label="Start date" key={form.key('startDate')} {...form.getInputProps('startDate')} />
            <TextInput type="date" label="End date" key={form.key('endDate')} {...form.getInputProps('endDate')} />
          </SimpleGrid>
          <TextInput label="Notes" key={form.key('notes')} {...form.getInputProps('notes')} />
          <Textarea label="Reason for correction" withAsterisk autosize minRows={2} key={form.key('reason')} {...form.getInputProps('reason')} />
          {error && (
            <Alert color="error" variant="light">
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.submitting} disabled={!value.sectionId}>
              Save correction
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function CloseModal({ studentId, placement, onClose }: { studentId: string; placement: Placement; onClose: () => void }) {
  const [outcome, setOutcome] = useState<'promoted' | 'retained'>('promoted');
  const [useYearEnd, setUseYearEnd] = useState(true);
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const close = useSchoolMutation(() => studentsApi.closeAssignment(studentId, placement.id, { outcome, endDate: useYearEnd ? undefined : endDate || undefined }));
  return (
    <Modal opened onClose={onClose} title={`Close ${placement.academicYear?.name}`}>
      <Stack gap="md">
        <Select
          label="Outcome"
          data={[
            { value: 'promoted', label: 'Promoted' },
            { value: 'retained', label: 'Retained' },
          ]}
          value={outcome}
          onChange={(v) => setOutcome((v as 'promoted' | 'retained') ?? 'promoted')}
          allowDeselect={false}
        />
        <Checkbox label="Ends on the last day of the academic year" checked={useYearEnd} onChange={(e) => setUseYearEnd(e.currentTarget.checked)} />
        {!useYearEnd && <TextInput type="date" label="End date" value={endDate} onChange={(e) => setEndDate(e.currentTarget.value)} />}
        <Text size="xs" c="dimmed">
          Students who move up a class are usually closed automatically when you assign them with “Promotion”.
        </Text>
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
            loading={close.isPending}
            onClick={() =>
              close.mutate(undefined, {
                onSuccess: () => {
                  notifySuccess('Placement closed');
                  onClose();
                },
                onError: (e) => setError(errorMessage(e)),
              })
            }
          >
            Close placement
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
