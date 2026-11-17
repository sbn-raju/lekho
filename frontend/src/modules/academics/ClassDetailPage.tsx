import { ActionIcon, Alert, Anchor, Breadcrumbs, Button, Group, Menu, Modal, NumberInput, SimpleGrid, Skeleton, Stack, Text, TextInput } from '@mantine/core';
import { hasLength, isInRange, useForm } from '@mantine/form';
import { IconArmchair, IconDots, IconLayoutGrid, IconLock, IconPlus, IconUserStar, IconUsers } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { EntityStatus } from '@/components/EntityStatus';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { confirmAction, errorMessage, notifyError, notifySuccess } from '@/components/feedback/feedback';
import { QueryError } from '@/components/feedback/QueryState';
import { MemberSelect } from '@/components/forms/MemberSelect';
import { DataTable } from '@/components/tables/DataTable';
import { useAccess } from '@/services/api/access';
import { academicsApi, useClassDetail, type SectionInput } from '@/services/api/academics';
import { ApiError } from '@/services/api/client';
import { useSchoolMutation } from '@/services/api/school';
import type { ClassDetail, Section, YearRef } from '@/types/api';
import { isYearEditable, plural, useYearParam, withYear } from './academic-helpers';
import { ClassFormModal, SectionSetupModal } from './ClassModals';
import { YearSelect } from './YearSelect';

function SectionFormModal({ cls, year, section, onClose }: { cls: ClassDetail; year: YearRef; section?: Section; onClose: () => void }) {
  const save = useSchoolMutation((v: SectionInput & { name: string }) =>
    section ? academicsApi.updateSection(section.id, v) : academicsApi.createSection({ ...v, academicYearId: year.id, classId: cls.id }),
  );
  const nextLetter = String.fromCharCode(65 + Math.min(25, cls.sections.length));
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { name: section?.name ?? nextLetter, code: section?.code ?? '', capacity: section?.capacity ?? cls.defaultSectionCapacity, room: section?.room ?? '' },
    validate: {
      name: hasLength({ min: 1, max: 30 }, 'Required'),
      code: (v) => (v && !/^[A-Za-z0-9_-]{1,10}$/.test(v) ? 'Up to 10 letters, digits, hyphens or underscores' : null),
      capacity: isInRange({ min: 1, max: 500 }, 'Between 1 and 500'),
    },
  });
  const submit = async (v: typeof form.values) => {
    try {
      await save.mutateAsync({
        name: v.name.trim(),
        ...(v.code && { code: v.code.toUpperCase() }),
        capacity: v.capacity,
        room: v.room.trim() || (section ? null : undefined),
      });
      notifySuccess(section ? 'Section updated' : `Section ${v.name} added`);
      onClose();
    } catch (err) {
      const details = err instanceof ApiError ? ((err.details ?? {}) as Record<string, unknown>) : {};
      if (Array.isArray(details.code) || details.reason === 'unit_code_taken') form.setFieldError('code', (err as Error).message);
      else if (Array.isArray(details.name)) form.setFieldError('name', (err as Error).message);
      else notifyError(err);
    }
  };
  return (
    <Modal opened onClose={onClose} title={section ? `Edit ${cls.name} ${section.name}` : `Add a section to ${cls.name}`}>
      <form onSubmit={form.onSubmit(submit)} noValidate>
        <Stack gap="md">
          <SimpleGrid cols={2} spacing="md">
            <TextInput label="Section name" placeholder="A" withAsterisk data-autofocus key={form.key('name')} {...form.getInputProps('name')} />
            <TextInput label="Code" placeholder="From the name" key={form.key('code')} {...form.getInputProps('code')} />
            <NumberInput label="Strength" description="Sanctioned seats" min={1} max={500} allowDecimal={false} withAsterisk key={form.key('capacity')} {...form.getInputProps('capacity')} />
            <TextInput label="Room" placeholder="Room 12" description="Optional" key={form.key('room')} {...form.getInputProps('room')} />
          </SimpleGrid>
          <Text size="xs" c="dimmed">
            In {year.name}.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.submitting}>
              {section ? 'Save' : 'Add section'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function ClassTeacherModal({ section, className, onClose }: { section: Section; className: string; onClose: () => void }) {
  const [userId, setUserId] = useState<string | null>(section.classTeacher?.id ?? null);
  const save = useSchoolMutation((id: string | null) => academicsApi.setClassTeacher(section.id, id));
  const run = (id: string | null) =>
    save.mutate(id, {
      onSuccess: () => {
        notifySuccess(id ? 'Class teacher assigned' : 'Class teacher removed');
        onClose();
      },
      onError: (e) => notifyError(e),
    });
  return (
    <Modal opened onClose={onClose} title={`Class teacher · ${className} ${section.name}`}>
      <Stack gap="md">
        <MemberSelect label="Teacher" value={userId} onChange={setUserId} data-autofocus />
        <Text size="xs" c="dimmed">
          The class teacher is placed in this section in the hierarchy and shown as its head. What they can do still comes from their role and its scopes.
        </Text>
        <Group justify="space-between">
          {section.classTeacher ? (
            <Button variant="subtle" color="error" onClick={() => run(null)} loading={save.isPending && save.variables === null}>
              Remove class teacher
            </Button>
          ) : (
            <span />
          )}
          <Group gap="sm">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!userId || userId === section.classTeacher?.id} loading={save.isPending && save.variables !== null} onClick={() => run(userId)}>
              Assign
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

type ModalState = { kind: 'editClass' } | { kind: 'setup' } | { kind: 'section'; section?: Section } | { kind: 'teacher'; section: Section } | null;

/** One class: its sections in the chosen year, their strength, rooms and class teachers. */
export function ClassDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const access = useAccess();
  const [yearParam, setYear] = useYearParam();
  const detail = useClassDetail(id, yearParam);
  const [modal, setModal] = useState<ModalState>(null);
  const updateClass = useSchoolMutation((status: 'active' | 'inactive') => academicsApi.updateClass(id, { status }));
  const removeClass = useSchoolMutation(() => academicsApi.deleteClass(id));
  const updateSection = useSchoolMutation((v: { id: string; body: SectionInput }) => academicsApi.updateSection(v.id, v.body));
  const removeSection = useSchoolMutation((sectionId: string) => academicsApi.deleteSection(sectionId));

  if (detail.isError) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />;
  if (!detail.data) return <Skeleton h={400} radius="lg" />;
  const c = detail.data;
  const year = c.academicYear;
  const editable = isYearEditable(year) && c.status === 'active';
  const canEditSections = access.canOrg('sections.update') && isYearEditable(year);
  const canAssign = canEditSections && access.canOrg('organization_units.assign');
  const canCreateSections = access.canOrg('sections.create') && editable;
  const canDeleteSections = access.canOrg('sections.delete') && isYearEditable(year);
  const active = c.sections.filter((s) => s.status === 'active');

  const toggleClass = () =>
    confirmAction({
      title: c.status === 'active' ? `Deactivate ${c.name}?` : `Activate ${c.name}?`,
      message:
        c.status === 'active'
          ? 'No new sections can be added, and class or section scoped access to it stops until it is reactivated. Its history is kept.'
          : 'Its sections and scoped access work again.',
      confirmLabel: c.status === 'active' ? 'Deactivate' : 'Activate',
      destructive: c.status === 'active',
      onConfirm: () => updateClass.mutateAsync(c.status === 'active' ? 'inactive' : 'active'),
      successMessage: 'Class updated',
    });

  const deleteClass = () =>
    confirmAction({
      title: `Delete ${c.name}?`,
      message: c.totalSectionsAllYears
        ? `${c.name} has ${plural(c.totalSectionsAllYears, 'section')} across academic years, so it can't be deleted. Deactivate it instead.`
        : 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await removeClass.mutateAsync(undefined);
          navigate(withYear('/academics/classes', year?.id));
        } catch (err) {
          throw new Error(errorMessage(err), { cause: err });
        }
      },
      successMessage: 'Class deleted',
    });

  const deleteSection = (s: Section) =>
    confirmAction({
      title: `Delete ${c.name} ${s.name}?`,
      message: s.memberCount
        ? `${plural(s.memberCount, 'person is', 'people are')} placed in this section. Remove them (and the class teacher) first, or deactivate the section.`
        : 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await removeSection.mutateAsync(s.id);
        } catch (err) {
          throw new Error(errorMessage(err), { cause: err });
        }
      },
      successMessage: 'Section deleted',
    });

  const toggleSection = (s: Section) =>
    updateSection.mutate(
      { id: s.id, body: { status: s.status === 'active' ? 'inactive' : 'active' } },
      { onSuccess: () => notifySuccess(s.status === 'active' ? 'Section deactivated' : 'Section activated'), onError: (e) => notifyError(e) },
    );

  return (
    <>
      <Breadcrumbs mb="xs">
        <Anchor component={Link} to={withYear('/academics/classes', year?.id)} size="sm">
          Classes & sections
        </Anchor>
        <Text size="sm">{c.name}</Text>
      </Breadcrumbs>
      <PageHeader
        title={c.name}
        description={
          <Group gap="xs" component="span">
            <Text span ff="monospace" size="sm">
              {c.code}
            </Text>
            {c.status !== 'active' && <EntityStatus status={c.status} size="sm" />}
            {c.description && <Text span size="sm">· {c.description}</Text>}
          </Group>
        }
        actions={
          <>
            <YearSelect value={year?.id} onChange={setYear} />
            {canCreateSections && (
              <Button leftSection={<IconPlus size={16} />} onClick={() => setModal({ kind: 'section' })}>
                Add section
              </Button>
            )}
            {(access.canOrg('classes.update') || access.canOrg('classes.delete') || canCreateSections) && (
              <Menu position="bottom-end" shadow="md">
                <Menu.Target>
                  <ActionIcon variant="default" size="lg" aria-label="Class actions">
                    <IconDots size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  {access.canOrg('classes.update') && <Menu.Item onClick={() => setModal({ kind: 'editClass' })}>Edit class</Menu.Item>}
                  {canCreateSections && (
                    <Menu.Item leftSection={<IconLayoutGrid size={16} stroke={1.75} />} onClick={() => setModal({ kind: 'setup' })}>
                      Add several sections
                    </Menu.Item>
                  )}
                  {access.canOrg('classes.update') && <Menu.Item onClick={toggleClass}>{c.status === 'active' ? 'Deactivate class' : 'Activate class'}</Menu.Item>}
                  {access.canOrg('classes.delete') && (
                    <>
                      <Menu.Divider />
                      <Menu.Item color="error" onClick={deleteClass}>
                        Delete class
                      </Menu.Item>
                    </>
                  )}
                </Menu.Dropdown>
              </Menu>
            )}
          </>
        }
      />

      {!year ? (
        <Alert color="info" variant="light">
          Sections belong to an academic year. Create one under{' '}
          <Anchor component={Link} to="/academics/years">
            Academic years
          </Anchor>{' '}
          to add sections to {c.name}.
        </Alert>
      ) : (
        <>
          {!isYearEditable(year) && (
            <Alert color="neutral" variant="light" mb="md" icon={<IconLock size={18} />}>
              {year.name} is {year.status}. These sections are read-only history.
            </Alert>
          )}
          <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md" mb="lg">
            <StatCard label="Sections" value={active.length} hint={year.name} icon={IconLayoutGrid} />
            <StatCard label="Total strength" value={c.totalCapacity} hint="Seats across active sections" icon={IconUsers} color="success" />
            <StatCard label="Default per section" value={c.defaultSectionCapacity} icon={IconArmchair} color="neutral" />
            <StatCard label="Without class teacher" value={c.sectionsWithoutClassTeacher} icon={IconUserStar} color={c.sectionsWithoutClassTeacher ? 'warning' : 'success'} />
          </SimpleGrid>

          <DataTable
            rows={c.sections}
            loading={detail.isFetching}
            rowKey={(s) => s.id}
            empty={{
              title: `No sections in ${year.name}`,
              description: canCreateSections ? 'Add sections one at a time, or several at once.' : undefined,
              action: canCreateSections && (
                <Group gap="sm">
                  <Button onClick={() => setModal({ kind: 'setup' })}>Add several sections</Button>
                  <Button variant="default" onClick={() => setModal({ kind: 'section' })}>
                    Add one
                  </Button>
                </Group>
              ),
            }}
            columns={[
              {
                key: 'name',
                header: 'Section',
                render: (s) => (
                  <Stack gap={0}>
                    <Text fw={600}>
                      {c.name} {s.name}
                    </Text>
                    <Text size="xs" c="dimmed" ff="monospace">
                      {s.code}
                    </Text>
                  </Stack>
                ),
              },
              { key: 'capacity', header: 'Strength', numeric: true, render: (s) => s.capacity },
              { key: 'room', header: 'Room', hiddenOnMobile: true, render: (s) => s.room ?? <Text size="sm" c="dimmed">—</Text> },
              {
                key: 'teacher',
                header: 'Class teacher',
                render: (s) =>
                  s.classTeacher ? (
                    <Stack gap={0}>
                      <Text size="sm" fw={500}>
                        {s.classTeacher.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {s.classTeacher.email}
                      </Text>
                    </Stack>
                  ) : canAssign && s.status === 'active' ? (
                    <Button size="compact-xs" variant="light" color="warning" onClick={() => setModal({ kind: 'teacher', section: s })}>
                      Assign
                    </Button>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Not assigned
                    </Text>
                  ),
              },
              { key: 'placed', header: 'Placed', numeric: true, hiddenOnMobile: true, render: (s) => s.memberCount },
              { key: 'status', header: 'Status', render: (s) => <EntityStatus status={s.status} size="sm" /> },
              {
                key: 'actions',
                header: '',
                width: 48,
                render: (s) =>
                  (canEditSections || canDeleteSections) && (
                    <Menu position="bottom-end" shadow="md">
                      <Menu.Target>
                        <ActionIcon variant="subtle" color="neutral" aria-label={`Actions for section ${s.name}`}>
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {canEditSections && <Menu.Item onClick={() => setModal({ kind: 'section', section: s })}>Edit strength and room</Menu.Item>}
                        {canAssign && s.status === 'active' && (
                          <Menu.Item onClick={() => setModal({ kind: 'teacher', section: s })}>{s.classTeacher ? 'Change class teacher' : 'Assign class teacher'}</Menu.Item>
                        )}
                        {canEditSections && (s.status === 'active' || c.status === 'active') && (
                          <Menu.Item onClick={() => toggleSection(s)}>{s.status === 'active' ? 'Deactivate' : 'Activate'}</Menu.Item>
                        )}
                        {canDeleteSections && (
                          <>
                            <Menu.Divider />
                            <Menu.Item color="error" onClick={() => deleteSection(s)}>
                              Delete
                            </Menu.Item>
                          </>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  ),
              },
            ]}
          />
          <Text size="xs" c="dimmed" mt="xs">
            “Placed” counts people assigned to the section in the hierarchy (students, teachers). Enrollment against strength arrives with the Students module.
          </Text>
        </>
      )}

      {modal?.kind === 'editClass' && <ClassFormModal cls={c} onClose={() => setModal(null)} />}
      {modal?.kind === 'setup' && year && <SectionSetupModal year={year} classes={[c]} onClose={() => setModal(null)} />}
      {modal?.kind === 'section' && year && <SectionFormModal cls={c} year={year} section={modal.section} onClose={() => setModal(null)} />}
      {modal?.kind === 'teacher' && <ClassTeacherModal section={modal.section} className={c.name} onClose={() => setModal(null)} />}
    </>
  );
}
