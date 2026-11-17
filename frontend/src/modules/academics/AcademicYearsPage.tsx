import { ActionIcon, Badge, Button, Group, Menu, Modal, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { hasLength, matches, useForm } from '@mantine/form';
import { IconCalendarStats, IconDots, IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { EntityStatus } from '@/components/EntityStatus';
import { PageHeader } from '@/components/PageHeader';
import { confirmAction, errorMessage, notifyError, notifySuccess } from '@/components/feedback/feedback';
import { QueryError } from '@/components/feedback/QueryState';
import { DataTable } from '@/components/tables/DataTable';
import { useAccess } from '@/services/api/access';
import { academicsApi, useAcademicYears, type YearInput } from '@/services/api/academics';
import { ApiError } from '@/services/api/client';
import { useSchoolMutation } from '@/services/api/school';
import type { AcademicYear, AcademicYearStatus } from '@/types/api';
import { dateRange, isYearEditable, plural, yearStatusKey } from './academic-helpers';

interface TermValues {
  key: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
}

interface YearValues {
  name: string;
  code: string;
  startDate: string | null;
  endDate: string | null;
  terms: TermValues[];
}

const newKey = () => Math.random().toString(36).slice(2);

/** Suggests the next year from the latest one ("2026-27" → "2027-28", dates +1 year). */
function suggestNext(years: AcademicYear[]): YearValues {
  const latest = [...years].sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  if (!latest) {
    const y = new Date().getFullYear();
    return { name: `${y}-${String(y + 1).slice(2)}`, code: '', startDate: `${y}-06-01`, endDate: `${y + 1}-03-31`, terms: [] };
  }
  const bump = (d: string) => `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;
  const start = bump(latest.startDate);
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(bump(latest.endDate).slice(0, 4));
  return {
    name: endYear > startYear ? `${startYear}-${String(endYear).slice(2)}` : String(startYear),
    code: '',
    startDate: start,
    endDate: bump(latest.endDate),
    terms: latest.terms.map((t) => ({ key: newKey(), name: t.name, startDate: bump(t.startDate), endDate: bump(t.endDate) })),
  };
}

function YearFormModal({ year, years, onClose }: { year?: AcademicYear; years: AcademicYear[]; onClose: () => void }) {
  const save = useSchoolMutation((body: YearInput) => (year ? academicsApi.updateYear(year.id, body) : academicsApi.createYear(body)));
  const form = useForm<YearValues>({
    mode: 'uncontrolled',
    initialValues: year
      ? { name: year.name, code: year.code, startDate: year.startDate, endDate: year.endDate, terms: year.terms.map((t) => ({ key: t.id, name: t.name, startDate: t.startDate, endDate: t.endDate })) }
      : suggestNext(years),
    validate: {
      name: hasLength({ min: 1, max: 40 }, 'Required'),
      code: (v) => (v && !/^[A-Za-z0-9_-]{1,12}$/.test(v) ? 'Up to 12 letters, digits, hyphens or underscores' : null),
      startDate: (v) => (v ? null : 'Required'),
      endDate: (v, values) => (!v ? 'Required' : values.startDate && v <= values.startDate ? 'Must be after the start date' : null),
      terms: {
        name: matches(/\S/, 'Required'),
        startDate: (v) => (v ? null : 'Required'),
        endDate: (v, values, path) => {
          const start = values.terms[Number(path.split('.')[1])]?.startDate;
          return !v ? 'Required' : start && v < start ? 'Ends before it starts' : null;
        },
      },
    },
  });

  const submit = async (v: YearValues) => {
    try {
      await save.mutateAsync({
        name: v.name.trim(),
        ...(v.code && { code: v.code.toUpperCase() }),
        startDate: v.startDate!,
        endDate: v.endDate!,
        terms: v.terms.map((t) => ({ name: t.name.trim(), startDate: t.startDate!, endDate: t.endDate! })),
      });
      notifySuccess(year ? 'Academic year updated' : `${v.name} created`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const reason = (err.details as { reason?: string } | undefined)?.reason;
        if (reason === 'years_overlap') return form.setFieldError('startDate', err.message);
        if (err.code === 'CONFLICT' && /code/i.test(err.message)) return form.setFieldError('code', err.message);
        if (err.code === 'CONFLICT') return form.setFieldError('name', err.message);
        if (err.code === 'VALIDATION_ERROR' && /term|overlap|within/i.test(err.message)) return form.setFieldError('terms', err.message);
      }
      notifyError(err);
    }
  };

  const terms = form.getValues().terms;
  return (
    <Modal opened onClose={onClose} title={year ? `Edit ${year.name}` : 'New academic year'} size="lg">
      <form onSubmit={form.onSubmit(submit)} noValidate>
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput label="Name" placeholder="2026-27" withAsterisk data-autofocus key={form.key('name')} {...form.getInputProps('name')} />
            <TextInput
              label="Code"
              placeholder="From the name"
              description={year ? 'Used in section codes' : 'Optional. Used in section codes.'}
              key={form.key('code')}
              {...form.getInputProps('code')}
            />
            <DatePickerInput label="Starts" withAsterisk valueFormat="D MMM YYYY" key={form.key('startDate')} {...form.getInputProps('startDate')} />
            <DatePickerInput label="Ends" withAsterisk valueFormat="D MMM YYYY" key={form.key('endDate')} {...form.getInputProps('endDate')} />
          </SimpleGrid>

          <Stack gap="xs">
            <Group justify="space-between">
              <Text fw={600} size="sm">
                Terms
              </Text>
              <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => form.insertListItem('terms', { key: newKey(), name: `Term ${terms.length + 1}`, startDate: null, endDate: null })}>
                Add term
              </Button>
            </Group>
            {terms.length === 0 && (
              <Text size="sm" c="dimmed">
                Optional. Add terms or semesters if your school uses them; they must fall inside the year and not overlap.
              </Text>
            )}
            {terms.map((t, i) => (
              <Group key={t.key} gap="xs" align="flex-start" wrap="nowrap">
                <TextInput aria-label={`Term ${i + 1} name`} placeholder="Term name" flex={1} key={form.key(`terms.${i}.name`)} {...form.getInputProps(`terms.${i}.name`)} />
                <DatePickerInput aria-label={`Term ${i + 1} start`} placeholder="Starts" valueFormat="D MMM YYYY" w={140} key={form.key(`terms.${i}.startDate`)} {...form.getInputProps(`terms.${i}.startDate`)} />
                <DatePickerInput aria-label={`Term ${i + 1} end`} placeholder="Ends" valueFormat="D MMM YYYY" w={140} key={form.key(`terms.${i}.endDate`)} {...form.getInputProps(`terms.${i}.endDate`)} />
                <ActionIcon variant="subtle" color="error" mt={6} aria-label={`Remove term ${i + 1}`} onClick={() => form.removeListItem('terms', i)}>
                  <IconTrash size={16} stroke={1.75} />
                </ActionIcon>
              </Group>
            ))}
            {form.errors.terms && (
              <Text size="sm" c="error">
                {form.errors.terms}
              </Text>
            )}
          </Stack>

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.submitting}>
              {year ? 'Save' : 'Create'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function CopyStructureModal({ target, years, onClose }: { target: AcademicYear; years: AcademicYear[]; onClose: () => void }) {
  const sources = years.filter((y) => y.id !== target.id && y.sectionCount > 0);
  const [source, setSource] = useState<string | null>(sources[0]?.id ?? null);
  const copy = useSchoolMutation((id: string) => academicsApi.copyStructure(target.id, id));
  return (
    <Modal opened onClose={onClose} title={`Copy sections into ${target.name}`}>
      <Stack gap="md">
        {sources.length === 0 ? (
          <Text c="dimmed">No other academic year has sections to copy yet.</Text>
        ) : (
          <>
            <Select
              label="Copy from"
              data={sources.map((y) => ({ value: y.id, label: `${y.name} · ${plural(y.sectionCount, 'section')}, ${y.totalCapacity} seats` }))}
              value={source}
              onChange={setSource}
              allowDeselect={false}
            />
            <Text size="sm" c="dimmed">
              Each active class gets the same sections, strength and rooms. Sections {target.name} already has are kept, and class teachers aren't copied.
            </Text>
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!source}
            loading={copy.isPending}
            onClick={() =>
              source &&
              copy.mutate(source, {
                onSuccess: (r) => {
                  notifySuccess(r.created ? `Copied ${plural(r.created, 'section')}${r.skipped ? `; ${r.skipped} already existed` : ''}` : 'Nothing new to copy');
                  onClose();
                },
                onError: (e) => notifyError(e),
              })
            }
          >
            Copy sections
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

const STATUS_ACTIONS: { to: AcademicYearStatus; from: AcademicYearStatus[]; label: string }[] = [
  { to: 'active', from: ['planned'], label: 'Set as current year' },
  { to: 'active', from: ['completed'], label: 'Reopen as current year' },
  { to: 'completed', from: ['active'], label: 'Close year' },
  { to: 'archived', from: ['planned', 'completed'], label: 'Archive' },
  { to: 'completed', from: ['archived'], label: 'Unarchive' },
];

/** Academic years: dates, terms, which year is current, and the year lifecycle. */
export function AcademicYearsPage() {
  const access = useAccess();
  const years = useAcademicYears();
  const [modal, setModal] = useState<{ kind: 'form'; year?: AcademicYear } | { kind: 'copy'; year: AcademicYear } | null>(null);
  const setStatus = useSchoolMutation((v: { id: string; status: AcademicYearStatus; closeCurrent?: boolean }) => academicsApi.setYearStatus(v.id, v.status, v.closeCurrent));
  const remove = useSchoolMutation((id: string) => academicsApi.deleteYear(id));
  const canUpdate = access.canOrg('academic_years.update');
  const list = years.data ?? [];
  const current = list.find((y) => y.isCurrent);

  const changeStatus = (y: AcademicYear, to: AcademicYearStatus) => {
    if (to === 'active') {
      const replacing = current && current.id !== y.id ? current : null;
      return confirmAction({
        title: `Make ${y.name} the current year?`,
        message: replacing
          ? `${replacing.name} will be closed. Its sections become read-only and scoped access to them stops.`
          : 'Dashboards and new records will use this year by default.',
        confirmLabel: replacing ? `Close ${replacing.name} and switch` : 'Set as current',
        onConfirm: () => setStatus.mutateAsync({ id: y.id, status: 'active', closeCurrent: !!replacing }),
        successMessage: `${y.name} is now the current year`,
      });
    }
    if (to === 'completed' && y.status === 'active') {
      return confirmAction({
        title: `Close ${y.name}?`,
        message: 'Its classes and sections become read-only history, and class or section scoped access to them stops. You can reopen it later.',
        confirmLabel: 'Close year',
        destructive: true,
        onConfirm: () => setStatus.mutateAsync({ id: y.id, status: 'completed' }),
        successMessage: `${y.name} closed`,
      });
    }
    setStatus.mutate({ id: y.id, status: to }, { onSuccess: () => notifySuccess('Academic year updated'), onError: (e) => notifyError(e) });
  };

  const del = (y: AcademicYear) =>
    confirmAction({
      title: `Delete ${y.name}?`,
      message: y.sectionCount
        ? `Its ${plural(y.sectionCount, 'section')} are deleted too. This is refused while anyone is placed in one of them.`
        : 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await remove.mutateAsync(y.id);
        } catch (err) {
          throw new Error(errorMessage(err), { cause: err });
        }
      },
      successMessage: 'Academic year deleted',
    });

  if (years.isError) return <QueryError error={years.error} onRetry={() => void years.refetch()} />;

  return (
    <>
      <PageHeader
        title="Academic years"
        description={current ? `${current.name} is the current year (${dateRange(current.startDate, current.endDate)}).` : 'No current year yet. Create one and set it as current.'}
        actions={
          access.canOrg('academic_years.create') && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setModal({ kind: 'form' })}>
              New academic year
            </Button>
          )
        }
      />
      <DataTable
        rows={list}
        loading={years.isFetching}
        rowKey={(y) => y.id}
        empty={{
          title: 'No academic years yet',
          description: 'An academic year holds your sections, their strength and class teachers. Most schools start with the coming year.',
          action: access.canOrg('academic_years.create') && (
            <Button leftSection={<IconCalendarStats size={16} />} onClick={() => setModal({ kind: 'form' })}>
              Create the first year
            </Button>
          ),
        }}
        columns={[
          {
            key: 'name',
            header: 'Year',
            render: (y) => (
              <Stack gap={0}>
                <Text fw={600}>{y.name}</Text>
                <Text size="xs" c="dimmed" ff="monospace">
                  {y.code}
                </Text>
              </Stack>
            ),
          },
          { key: 'dates', header: 'Dates', render: (y) => dateRange(y.startDate, y.endDate) },
          {
            key: 'terms',
            header: 'Terms',
            hiddenOnMobile: true,
            render: (y) =>
              y.terms.length ? (
                <Group gap={4}>
                  {y.terms.map((t) => (
                    <Badge key={t.id} variant="light" color="neutral" size="sm">
                      {t.name}
                    </Badge>
                  ))}
                </Group>
              ) : (
                <Text size="sm" c="dimmed">
                  —
                </Text>
              ),
          },
          { key: 'sections', header: 'Sections', numeric: true, render: (y) => y.sectionCount },
          { key: 'seats', header: 'Seats', numeric: true, hiddenOnMobile: true, render: (y) => y.totalCapacity.toLocaleString() },
          { key: 'status', header: 'Status', render: (y) => <EntityStatus status={yearStatusKey(y.status)} size="sm" /> },
          {
            key: 'actions',
            header: '',
            width: 48,
            render: (y) => {
              const statusItems = canUpdate ? STATUS_ACTIONS.filter((a) => a.from.includes(y.status)) : [];
              const canEdit = canUpdate && isYearEditable(y);
              const canCopy = access.canOrg('sections.create') && isYearEditable(y);
              const canDelete = access.canOrg('academic_years.delete') && y.status !== 'active';
              if (!statusItems.length && !canEdit && !canCopy && !canDelete) return null;
              return (
                <Menu position="bottom-end" shadow="md">
                  <Menu.Target>
                    <ActionIcon variant="subtle" color="neutral" aria-label={`Actions for ${y.name}`}>
                      <IconDots size={16} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {canEdit && <Menu.Item onClick={() => setModal({ kind: 'form', year: y })}>Edit dates and terms</Menu.Item>}
                    {canCopy && <Menu.Item onClick={() => setModal({ kind: 'copy', year: y })}>Copy sections from another year</Menu.Item>}
                    {statusItems.map((a) => (
                      <Menu.Item key={a.label} onClick={() => changeStatus(y, a.to)}>
                        {a.label}
                      </Menu.Item>
                    ))}
                    {canDelete && (
                      <>
                        <Menu.Divider />
                        <Menu.Item color="error" onClick={() => del(y)}>
                          Delete
                        </Menu.Item>
                      </>
                    )}
                  </Menu.Dropdown>
                </Menu>
              );
            },
          },
        ]}
      />
      {modal?.kind === 'form' && <YearFormModal year={modal.year} years={list} onClose={() => setModal(null)} />}
      {modal?.kind === 'copy' && <CopyStructureModal target={modal.year} years={list} onClose={() => setModal(null)} />}
    </>
  );
}
