import { Alert, Anchor, Button, Card, Checkbox, Group, List, Skeleton, Stack, Stepper, Text, ThemeIcon } from '@mantine/core';
import { IconAlertTriangle, IconCircleCheck, IconCircleX } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { confirmAction, errorMessage, notifySuccess } from '@/components/feedback/feedback';
import { QueryError } from '@/components/feedback/QueryState';
import { useAccess } from '@/services/api/access';
import { useSchoolMutation } from '@/services/api/school';
import { studentsApi, useGuardians, useStudent, useStudentSettings, type PlacementInput, type StudentInput } from '@/services/api/students';
import type { StudentDetail } from '@/types/students';
import { formatDate } from '@/utils/format';
import { GuardiansPanel } from './GuardiansPanel';
import { PhotoPanel } from './PhotoPanel';
import { PlacementPicker } from './PlacementPanel';
import { StudentDetailsForm } from './StudentDetailsForm';
import { GENDER_LABEL, addressText } from './student-helpers';

const STEPS = ['details', 'guardians', 'photo', 'review'] as const;

/**
 * Multi-step registration (FRD §3.1): details → parents & guardians (OTP) → photo → review and
 * complete. Step 1 saves a draft, so a registration can be resumed from the student list.
 */
export function RegisterStudentPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const access = useAccess();
  const [params, setParams] = useSearchParams();
  const student = useStudent(id);
  const guardians = useGuardians(id, !!id);
  const create = useSchoolMutation((body: StudentInput & { firstName: string }) => studentsApi.create(body));
  const update = useSchoolMutation((body: StudentInput) => studentsApi.update(id!, body));
  const stepIndex = Math.max(0, STEPS.indexOf((params.get('step') ?? 'details') as (typeof STEPS)[number]));
  const go = (i: number) => setParams({ step: STEPS[i]! }, { replace: true });
  const sensitiveAllowed = access.canOrg('students.read_sensitive');

  if (student.data && student.data.registrationStatus === 'completed') return <Navigate to={`/students/${id}`} replace />;
  if (student.isError) return <QueryError error={student.error} onRetry={() => void student.refetch()} />;

  const s = student.data;
  const name = s?.fullName ?? 'New student';
  return (
    <>
      <PageHeader
        title={id ? `Register ${name}` : 'Register a student'}
        description="Drafts are saved as you go. The admission number is issued when you complete the registration."
        actions={
          <Button variant="default" component={Link} to="/students">
            Back to students
          </Button>
        }
      />
      <Card>
        <Stepper active={stepIndex} onStepClick={(i) => id && go(i)} allowNextStepsSelect={!!id} size="sm">
          <Stepper.Step label="Student details" description="Name, birth date, address">
            {id && !s ? (
              <Skeleton h={300} />
            ) : (
              <StudentDetailsForm
                key={s?.updatedAt ?? 'new'}
                student={s}
                mode="draft"
                sensitiveAllowed={sensitiveAllowed}
                submitLabel={id ? 'Save and continue' : 'Save draft and continue'}
                onSubmit={async (input) => {
                  if (id) {
                    await update.mutateAsync(input);
                    go(1);
                  } else {
                    const created = await create.mutateAsync({ ...input, firstName: input.firstName! });
                    navigate(`/students/${created.id}/register?step=guardians`, { replace: true });
                  }
                }}
              />
            )}
          </Stepper.Step>
          <Stepper.Step label="Parents & guardians" description="Verify a mobile by OTP">
            {id && (
              <Stack gap="md" mt="md">
                {guardians.data ? <GuardiansPanel studentId={id} guardians={guardians.data} canManage={access.canOrg('guardians.manage')} /> : <Skeleton h={160} />}
                <StepNav onBack={() => go(0)} onNext={() => go(2)} />
              </Stack>
            )}
          </Stepper.Step>
          <Stepper.Step label="Photo" description="For the ID card">
            {s && (
              <Stack gap="md" mt="md">
                <PhotoPanel student={s} canEdit={access.canOrg('students.update')} />
                <StepNav onBack={() => go(1)} onNext={() => go(3)} nextLabel={s.photo ? 'Continue' : 'Skip for now'} />
              </Stack>
            )}
          </Stepper.Step>
          <Stepper.Step label="Review & complete" description="Admission number and class">
            {s && guardians.data && <ReviewStep student={s} guardianCount={guardians.data.length} onBack={() => go(2)} onEdit={go} />}
          </Stepper.Step>
        </Stepper>
      </Card>
    </>
  );
}

function StepNav({ onBack, onNext, nextLabel = 'Continue' }: { onBack: () => void; onNext: () => void; nextLabel?: string }) {
  return (
    <Group justify="space-between">
      <Button variant="default" onClick={onBack}>
        Back
      </Button>
      <Button onClick={onNext}>{nextLabel}</Button>
    </Group>
  );
}

function ReviewStep({ student, guardianCount, onBack, onEdit }: { student: StudentDetail; guardianCount: number; onBack: () => void; onEdit: (step: number) => void }) {
  const access = useAccess();
  const navigate = useNavigate();
  const settings = useStudentSettings();
  const canPlace = access.canOrg('student_assignments.manage') && access.canOrg('classes.read');
  const [placeNow, setPlaceNow] = useState(canPlace);
  const [placement, setPlacement] = useState<Partial<PlacementInput>>({});
  const [error, setError] = useState<string | null>(null);
  const complete = useSchoolMutation((assignment?: PlacementInput) => studentsApi.completeRegistration(student.id, assignment));
  const remove = useSchoolMutation(() => studentsApi.remove(student.id, 'Draft discarded'));
  const missing = student.registration.missing;
  const placementReady = !placeNow || (placement.academicYearId && placement.classId && placement.sectionId);

  const submit = async () => {
    setError(null);
    try {
      const done = await complete.mutateAsync(placeNow ? (placement as PlacementInput) : undefined);
      notifySuccess(`Admission number ${done.admissionNumber}`, `${done.fullName} is registered`);
      navigate(`/students/${done.id}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const check = (ok: boolean, text: string, step?: number) => (
    <List.Item icon={<ThemeIcon size={20} radius="xl" color={ok ? 'success' : 'error'} variant="light">{ok ? <IconCircleCheck size={14} /> : <IconCircleX size={14} />}</ThemeIcon>}>
      {text}
      {!ok && step !== undefined && (
        <Anchor component="button" size="sm" ml="xs" onClick={() => onEdit(step)}>
          Fix
        </Anchor>
      )}
    </List.Item>
  );
  const has = (field: string) => !missing.some((m) => m.field === field);

  return (
    <Stack gap="lg" mt="md">
      <Card withBorder>
        <Stack gap={4}>
          <Text fw={700} size="lg">
            {student.fullName}
          </Text>
          <Text size="sm" c="dimmed">
            {student.gender ? GENDER_LABEL[student.gender] : 'Gender not set'} · Born {formatDate(student.dateOfBirth)}
            {student.age !== null ? ` (age ${student.age})` : ''}
          </Text>
          <Text size="sm">{addressText(student.addresses.residential)}</Text>
        </Stack>
      </Card>

      <List spacing="xs" size="sm" center>
        {check(has('lastName') && has('dateOfBirth') && has('gender'), 'Name, date of birth and gender', 0)}
        {check(has('residentialAddress') && has('permanentAddress'), 'Address', 0)}
        {check(guardianCount > 0, 'At least one parent or guardian', 1)}
        {check(!missing.some((m) => m.field === 'guardians'), 'A verified parent or guardian mobile, and a primary contact', 1)}
        <List.Item icon={<ThemeIcon size={20} radius="xl" color={student.photo ? 'success' : 'warning'} variant="light">{student.photo ? <IconCircleCheck size={14} /> : <IconAlertTriangle size={14} />}</ThemeIcon>}>
          {student.photo ? 'Photo uploaded' : 'No photo yet (needed for the ID card, not for registration)'}
        </List.Item>
      </List>

      {missing.length > 0 && (
        <Alert color="warning" variant="light" title="Before you can complete the registration">
          <List size="sm">
            {missing.map((m) => (
              <List.Item key={m.message}>{m.message}</List.Item>
            ))}
          </List>
        </Alert>
      )}

      {canPlace && (
        <Stack gap="sm">
          <Checkbox label="Place the student in a class now" checked={placeNow} onChange={(e) => setPlaceNow(e.currentTarget.checked)} />
          {placeNow && <PlacementPicker value={placement} onChange={setPlacement} />}
        </Stack>
      )}

      {settings.data && (
        <Text size="sm" c="dimmed">
          The next admission number will look like <b className="tabular-nums">{settings.data.admissionNumberPreview}</b>. It is issued on completion and can't be reused.
        </Text>
      )}
      {error && (
        <Alert color="error" variant="light">
          {error}
        </Alert>
      )}

      <Group justify="space-between">
        <Group>
          <Button variant="default" onClick={onBack}>
            Back
          </Button>
          {access.canOrg('students.delete') && (
            <Button
              variant="subtle"
              color="error"
              onClick={() =>
                confirmAction({
                  title: 'Discard this draft?',
                  message: 'The draft and its contacts are deleted. This cannot be undone.',
                  confirmLabel: 'Discard draft',
                  destructive: true,
                  onConfirm: async () => {
                    await remove.mutateAsync(undefined);
                    navigate('/students', { replace: true });
                  },
                  successMessage: 'Draft discarded',
                })
              }
            >
              Discard draft
            </Button>
          )}
        </Group>
        <Button onClick={() => void submit()} loading={complete.isPending} disabled={missing.length > 0 || !placementReady}>
          Complete registration
        </Button>
      </Group>
    </Stack>
  );
}
