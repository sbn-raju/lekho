import { Alert, Button, Group, Menu, Select, SimpleGrid, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconAlertTriangle, IconCamera, IconChevronDown, IconCircleCheck, IconId, IconPlus, IconSearch, IconSettings, IconUserPlus, IconUsers } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { EntityStatus } from '@/components/EntityStatus';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { QueryError } from '@/components/feedback/QueryState';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { useAccess } from '@/services/api/access';
import { useClasses, useSections } from '@/services/api/academics';
import { useStudentStats, useStudents, type StudentFilters } from '@/services/api/students';
import type { StudentSummary } from '@/types/students';
import { formatDate } from '@/utils/format';
import { YearSelect } from '@/modules/academics/YearSelect';
import { GENDER_LABEL, STATUS_LABEL, formatPhone, genderOptions } from './student-helpers';
import { StudentAvatar } from './StudentAvatar';

/**
 * Student list (FRD §9). The backend limits rows to the viewer's scope, so teachers see only
 * their sections here whatever filters they pick.
 */
export function StudentsPage() {
  const access = useAccess();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [debounced] = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const param = (k: string) => params.get(k) ?? undefined;
  const set = (k: string, v: string | null) => {
    setPage(1);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set(k, v);
        else next.delete(k);
        if (k === 'year') ['class', 'section'].forEach((x) => next.delete(x));
        if (k === 'class') next.delete('section');
        return next;
      },
      { replace: true },
    );
  };

  const filters: StudentFilters = {
    page,
    search: debounced.trim() || undefined,
    academicYearId: param('year'),
    classId: param('class'),
    sectionId: param('section'),
    gender: param('gender'),
    status: param('status'),
    verification: param('verification') as StudentFilters['verification'],
    archived: params.get('archived') === 'true' || undefined,
    sort: (param('sort') as StudentFilters['sort']) ?? 'name',
  };
  const students = useStudents(filters);
  const canClasses = access.canOrg('classes.read');
  const classes = useClasses(filters.academicYearId, canClasses);
  const sections = useSections(classes.data?.academicYear?.id, canClasses);
  const stats = useStudentStats();

  const canCreate = access.canOrg('students.create');
  const canCards = access.canOrg('student_id_cards.generate');
  const canConfigure = access.canOrg('students.configure');
  const canSeeArchived = access.canOrg('students.delete');

  const columns: Column<StudentSummary>[] = [
    {
      key: 'name',
      header: 'Student',
      render: (s) => (
        <Group gap="sm" wrap="nowrap">
          <StudentAvatar student={s} size={36} />
          <div>
            <Text fw={600} size="sm">
              {s.fullName}
            </Text>
            <Text size="xs" c="dimmed" className="tabular-nums">
              {s.admissionNumber ?? 'Not yet admitted'}
            </Text>
          </div>
        </Group>
      ),
    },
    { key: 'gender', header: 'Gender', hiddenOnMobile: true, render: (s) => (s.gender ? GENDER_LABEL[s.gender] : '—') },
    { key: 'dob', header: 'Date of birth', hiddenOnMobile: true, render: (s) => formatDate(s.dateOfBirth) },
    {
      key: 'class',
      header: 'Class',
      render: (s) =>
        s.currentAssignment?.class ? (
          <Text size="sm">
            {s.currentAssignment.class.name} – {s.currentAssignment.section?.name}
            <Text span size="xs" c="dimmed" display="block">
              {s.currentAssignment.academicYear?.name}
            </Text>
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            Not placed
          </Text>
        ),
    },
    {
      key: 'contact',
      header: 'Primary contact',
      hiddenOnMobile: true,
      render: (s) =>
        s.primaryContact ? (
          <Group gap={6} wrap="nowrap">
            <Text size="sm" className="tabular-nums">
              {formatPhone(s.primaryContact.mobileNumber)}
            </Text>
            {s.primaryContact.verified && (
              <Tooltip label="Verified by OTP">
                <IconCircleCheck size={16} stroke={1.75} color="var(--mantine-color-success-6)" aria-label="Verified" />
              </Tooltip>
            )}
          </Group>
        ) : (
          <Text size="sm" c="dimmed">
            —
          </Text>
        ),
    },
    {
      key: 'verified',
      header: 'Contact verified',
      hiddenOnMobile: true,
      render: (s) => (s.hasVerifiedContact === undefined ? '—' : <EntityStatus status={s.hasVerifiedContact ? 'verified' : 'unverified'} size="sm" />),
    },
    { key: 'status', header: 'Status', render: (s) => <EntityStatus status={s.archived ? 'archived' : s.status} size="sm" /> },
  ];

  const st = stats.data;
  return (
    <>
      <PageHeader
        title="Students"
        description={st ? `${st.byStatus.active.toLocaleString()} active students${st.currentAcademicYear ? ` in ${st.currentAcademicYear.name}` : ''}.` : 'Student records, contacts, class placement and ID cards.'}
        actions={
          <>
            {(canCards || canConfigure) && (
              <Menu position="bottom-end" shadow="md">
                <Menu.Target>
                  <Button variant="default" rightSection={<IconChevronDown size={14} />}>
                    More
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  {canCards && (
                    <Menu.Item leftSection={<IconId size={16} stroke={1.75} />} component={Link} to="/students/id-cards">
                      Bulk ID cards
                    </Menu.Item>
                  )}
                  {canConfigure && (
                    <Menu.Item leftSection={<IconSettings size={16} stroke={1.75} />} component={Link} to="/students/settings">
                      Admission & ID card settings
                    </Menu.Item>
                  )}
                </Menu.Dropdown>
              </Menu>
            )}
            {canCreate && (
              <Button leftSection={<IconUserPlus size={16} />} component={Link} to="/students/new">
                Register student
              </Button>
            )}
          </>
        }
      />

      {st && canCreate && (
        <SimpleGrid cols={{ base: 2, md: 4 }} mb="lg">
          <StatCard label="Active students" value={st.byStatus.active} icon={IconUsers} />
          <StatCard label="Draft registrations" value={st.byStatus.draft} icon={IconPlus} />
          <StatCard label="Without a verified contact" value={st.activeWithoutVerifiedContact} icon={IconAlertTriangle} />
          <StatCard label="Without a photo" value={st.activeWithoutPhoto} icon={IconCamera} />
        </SimpleGrid>
      )}
      {st && canCreate && st.activeUnplacedInCurrentYear ? (
        <Alert color="warning" variant="light" mb="md" icon={<IconAlertTriangle size={18} />}>
          {st.activeUnplacedInCurrentYear} active student{st.activeUnplacedInCurrentYear === 1 ? ' is' : 's are'} not placed in a class for {st.currentAcademicYear?.name}.
        </Alert>
      ) : null}

      {students.isError ? (
        <QueryError error={students.error} onRetry={() => void students.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={students.data?.items ?? []}
          rowKey={(s) => s.id}
          loading={students.isFetching}
          onRowClick={(s) => navigate(s.registrationStatus === 'draft' && canCreate ? `/students/${s.id}/register` : `/students/${s.id}`)}
          empty={{
            title: filters.search || filters.classId || filters.status ? 'No students match' : 'No students yet',
            description: canCreate ? 'Register a student to get started. Drafts are saved as you go.' : 'Students placed in your classes appear here.',
          }}
          pagination={students.data && { page, totalPages: students.data.totalPages, total: students.data.total, onChange: setPage }}
          toolbar={
            <Stack gap="sm">
              <TextInput
                leftSection={<IconSearch size={16} />}
                placeholder="Search by name, admission number, parent mobile or email"
                value={search}
                onChange={(e) => {
                  setSearch(e.currentTarget.value);
                  setPage(1);
                }}
                aria-label="Search students"
              />
              <Group gap="sm">
                <YearSelect value={filters.academicYearId ?? classes.data?.academicYear?.id} onChange={(v) => set('year', v)} w={180} size="sm" />
                {canClasses && (
                  <Select
                    size="sm"
                    w={160}
                    placeholder="All classes"
                    clearable
                    data={(classes.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
                    value={filters.classId ?? null}
                    onChange={(v) => set('class', v)}
                    aria-label="Class"
                  />
                )}
                {canClasses && filters.classId && (
                  <Select
                    size="sm"
                    w={130}
                    placeholder="All sections"
                    clearable
                    data={(sections.data ?? []).filter((x) => x.classId === filters.classId).map((x) => ({ value: x.id, label: `Section ${x.name}` }))}
                    value={filters.sectionId ?? null}
                    onChange={(v) => set('section', v)}
                    aria-label="Section"
                  />
                )}
                <Select size="sm" w={150} placeholder="Any gender" clearable data={genderOptions()} value={filters.gender ?? null} onChange={(v) => set('gender', v)} aria-label="Gender" />
                <Select
                  size="sm"
                  w={150}
                  placeholder="Any status"
                  clearable
                  data={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
                  value={filters.status ?? null}
                  onChange={(v) => set('status', v)}
                  aria-label="Status"
                />
                <Select
                  size="sm"
                  w={190}
                  placeholder="Any verification"
                  clearable
                  data={[
                    { value: 'verified', label: 'Contact verified' },
                    { value: 'unverified', label: 'Needs verification' },
                  ]}
                  value={filters.verification ?? null}
                  onChange={(v) => set('verification', v)}
                  aria-label="Contact verification"
                />
                <Select
                  size="sm"
                  w={170}
                  data={[
                    { value: 'name', label: 'Sort by name' },
                    { value: 'admissionNumber', label: 'Sort by admission no.' },
                    { value: 'recent', label: 'Recently added' },
                  ]}
                  value={filters.sort ?? 'name'}
                  onChange={(v) => set('sort', v === 'name' ? null : v)}
                  allowDeselect={false}
                  aria-label="Sort"
                />
                {canSeeArchived && (
                  <Button size="sm" variant={filters.archived ? 'light' : 'subtle'} onClick={() => set('archived', filters.archived ? null : 'true')}>
                    {filters.archived ? 'Showing archived' : 'Show archived'}
                  </Button>
                )}
              </Group>
            </Stack>
          }
        />
      )}
    </>
  );
}
