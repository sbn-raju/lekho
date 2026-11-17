import { ActionIcon, Alert, Anchor, Badge, Button, Card, EmptyState, Group, Menu, Stack, Text } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconChalkboard, IconChevronDown, IconLayoutGrid, IconLock, IconPlus, IconTemplate } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { EntityStatus } from '@/components/EntityStatus';
import { PageHeader } from '@/components/PageHeader';
import { notifyError } from '@/components/feedback/feedback';
import { QueryError } from '@/components/feedback/QueryState';
import { DataTable } from '@/components/tables/DataTable';
import { useAccess } from '@/services/api/access';
import { academicsApi, useClasses, useSections } from '@/services/api/academics';
import { useSchoolMutation } from '@/services/api/school';
import type { SchoolClass, Section } from '@/types/api';
import { isYearEditable, plural, useYearParam, withYear } from './academic-helpers';
import { ClassFormModal, ClassTemplateModal, SectionSetupModal } from './ClassModals';
import { YearSelect } from './YearSelect';

/** Classes in progression order, with their sections and strength for the chosen year. */
export function ClassesPage() {
  const access = useAccess();
  const navigate = useNavigate();
  const [yearParam, setYear] = useYearParam();
  const classes = useClasses(yearParam);
  const year = classes.data?.academicYear ?? null;
  const sections = useSections(year?.id);
  const [modal, setModal] = useState<'add' | 'template' | 'setup' | null>(null);
  const reorder = useSchoolMutation((ids: string[]) => academicsApi.reorderClasses(ids));

  const list = classes.data?.items ?? [];
  const byClass = new Map<string, Section[]>();
  for (const s of sections.data ?? []) byClass.set(s.classId, [...(byClass.get(s.classId) ?? []), s]);
  const canCreate = access.canOrg('classes.create');
  const canReorder = access.canOrg('classes.update');
  const editable = isYearEditable(year);
  const canSetup = access.canOrg('sections.create') && editable && list.some((c) => c.status === 'active');

  const move = (c: SchoolClass, delta: -1 | 1) => {
    const ids = list.map((x) => x.id);
    const i = ids.indexOf(c.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids, { onError: (e) => notifyError(e) });
  };

  if (classes.isError) return <QueryError error={classes.error} onRetry={() => void classes.refetch()} />;

  const totalSeats = list.reduce((n, c) => n + (c.status === 'active' ? c.totalCapacity : 0), 0);
  const totalSections = list.reduce((n, c) => n + (c.status === 'active' ? c.sectionCount : 0), 0);

  return (
    <>
      <PageHeader
        title="Classes & sections"
        description={
          year
            ? `${year.name}: ${plural(totalSections, 'section')} across ${plural(list.filter((c) => c.status === 'active').length, 'active class', 'active classes')}, ${totalSeats.toLocaleString()} seats.`
            : 'Classes persist across years; sections and their strength are set per academic year.'
        }
        actions={
          <>
            <YearSelect value={year?.id} onChange={setYear} />
            {canSetup && (
              <Button variant="default" leftSection={<IconLayoutGrid size={16} />} onClick={() => setModal('setup')}>
                Set up sections
              </Button>
            )}
            {canCreate && (
              <Menu position="bottom-end" shadow="md">
                <Menu.Target>
                  <Button leftSection={<IconPlus size={16} />} rightSection={<IconChevronDown size={14} />}>
                    Add classes
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<IconChalkboard size={16} stroke={1.75} />} onClick={() => setModal('add')}>
                    One class
                  </Menu.Item>
                  <Menu.Item leftSection={<IconTemplate size={16} stroke={1.75} />} onClick={() => setModal('template')}>
                    From a template
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
          </>
        }
      />

      {!year && list.length > 0 && (
        <Alert color="info" variant="light" mb="md" title="No academic year yet">
          Sections belong to an academic year.{' '}
          {access.canOrg('academic_years.read') && (
            <Anchor component={Link} to="/academics/years">
              Create one
            </Anchor>
          )}{' '}
          to give your classes sections and strength.
        </Alert>
      )}
      {year && !editable && (
        <Alert color="neutral" variant="light" mb="md" icon={<IconLock size={18} />}>
          {year.name} is {year.status}. Its sections are read-only; reopen the year to change them.
        </Alert>
      )}

      {list.length === 0 && !classes.isFetching ? (
        <Card>
          <EmptyState
            icon={<IconChalkboard size={28} stroke={1.75} />}
            title="No classes yet"
            description="Start from a template (for example Nursery to Grade 12) or add classes one at a time. You can rename and reorder them later."
            py="xl"
          >
            {canCreate && (
              <EmptyState.Actions>
                <Button leftSection={<IconTemplate size={16} />} onClick={() => setModal('template')}>
                  Use a template
                </Button>
                <Button variant="default" onClick={() => setModal('add')}>
                  Add one class
                </Button>
              </EmptyState.Actions>
            )}
          </EmptyState>
        </Card>
      ) : (
        <DataTable
          rows={list}
          loading={classes.isFetching || reorder.isPending}
          rowKey={(c) => c.id}
          onRowClick={(c) => navigate(withYear(`/academics/classes/${c.id}`, year?.id))}
          columns={[
            ...(canReorder
              ? [
                  {
                    key: 'order',
                    header: '',
                    width: 64,
                    render: (c: SchoolClass) => {
                      const i = list.indexOf(c);
                      return (
                        <Group gap={0} wrap="nowrap" onClick={(e) => e.stopPropagation()}>
                          <ActionIcon size="sm" variant="subtle" color="neutral" disabled={i === 0} aria-label={`Move ${c.name} up`} onClick={() => move(c, -1)}>
                            <IconArrowUp size={14} stroke={1.75} />
                          </ActionIcon>
                          <ActionIcon size="sm" variant="subtle" color="neutral" disabled={i === list.length - 1} aria-label={`Move ${c.name} down`} onClick={() => move(c, 1)}>
                            <IconArrowDown size={14} stroke={1.75} />
                          </ActionIcon>
                        </Group>
                      );
                    },
                  },
                ]
              : []),
            {
              key: 'name',
              header: 'Class',
              render: (c) => (
                <Stack gap={0}>
                  <Text fw={600}>{c.name}</Text>
                  <Text size="xs" c="dimmed" ff="monospace">
                    {c.code}
                  </Text>
                </Stack>
              ),
            },
            {
              key: 'sections',
              header: 'Sections',
              render: (c) => {
                const mine = (byClass.get(c.id) ?? []).filter((s) => s.status === 'active');
                if (!year) return <Text size="sm" c="dimmed">—</Text>;
                if (mine.length === 0) return <Badge variant="light" color="warning">None yet</Badge>;
                return (
                  <Group gap={4}>
                    {mine.map((s) => (
                      <Badge key={s.id} variant="light" color={s.classTeacher ? 'lekho' : 'neutral'} title={s.classTeacher ? `Class teacher: ${s.classTeacher.name}` : 'No class teacher'}>
                        {s.name} · {s.capacity}
                      </Badge>
                    ))}
                  </Group>
                );
              },
            },
            { key: 'seats', header: 'Strength', numeric: true, render: (c) => (year ? c.totalCapacity.toLocaleString() : '—') },
            { key: 'default', header: 'Default / section', numeric: true, hiddenOnMobile: true, render: (c) => c.defaultSectionCapacity },
            {
              key: 'teachers',
              header: 'Class teachers',
              hiddenOnMobile: true,
              render: (c) =>
                c.sectionCount === 0 ? (
                  <Text size="sm" c="dimmed">
                    —
                  </Text>
                ) : c.sectionsWithoutClassTeacher ? (
                  <Text size="sm" c="warning">
                    {c.sectionsWithoutClassTeacher} missing
                  </Text>
                ) : (
                  <Text size="sm" c="success">
                    All assigned
                  </Text>
                ),
            },
            { key: 'status', header: 'Status', render: (c) => <EntityStatus status={c.status} size="sm" /> },
          ]}
        />
      )}

      {modal === 'add' && <ClassFormModal onClose={() => setModal(null)} />}
      {modal === 'template' && <ClassTemplateModal existing={list} onClose={() => setModal(null)} />}
      {modal === 'setup' && year && <SectionSetupModal year={year} classes={list} onClose={() => setModal(null)} />}
    </>
  );
}
