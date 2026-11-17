import { Alert, Badge, Button, Checkbox, Group, Modal, NumberInput, Radio, ScrollArea, SegmentedControl, SimpleGrid, Stack, Table, Text, TextInput, Textarea } from '@mantine/core';
import { hasLength, isInRange, matches, useForm } from '@mantine/form';
import { IconInfoCircle } from '@tabler/icons-react';
import { useState } from 'react';
import { notifyError, notifySuccess } from '@/components/feedback/feedback';
import { academicsApi, type ClassInput } from '@/services/api/academics';
import { ApiError } from '@/services/api/client';
import { useSchoolMutation } from '@/services/api/school';
import type { SchoolClass, YearRef } from '@/types/api';
import { plural } from './academic-helpers';
import { CLASS_TEMPLATES } from './class-templates';

const MAX_CAPACITY = 500;

/** Sets field errors from a 409/400 whose details name the field (`{ code: ['Already used'] }`). */
function applyFieldErrors(err: unknown, setFieldError: (field: string, message: string) => void, fields: string[]): boolean {
  if (!(err instanceof ApiError)) return false;
  const details = (err.details ?? {}) as Record<string, unknown>;
  const field = fields.find((f) => Array.isArray(details[f]));
  if (field) {
    setFieldError(field, err.message);
    return true;
  }
  if ((details as { reason?: string }).reason === 'unit_code_taken' && fields.includes('code')) {
    setFieldError('code', err.message);
    return true;
  }
  return false;
}

export function ClassFormModal({ cls, onClose, onSaved }: { cls?: SchoolClass; onClose: () => void; onSaved?: (id: string) => void }) {
  const save = useSchoolMutation((body: ClassInput) => (cls ? academicsApi.updateClass(cls.id, body) : academicsApi.createClass(body)));
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { name: cls?.name ?? '', code: cls?.code ?? '', description: cls?.description ?? '', defaultSectionCapacity: cls?.defaultSectionCapacity ?? 40 },
    validate: {
      name: hasLength({ min: 1, max: 60 }, 'Required'),
      code: matches(/^[A-Za-z0-9_-]{1,16}$/, 'Up to 16 letters, digits, hyphens or underscores'),
      defaultSectionCapacity: isInRange({ min: 1, max: MAX_CAPACITY }, `Between 1 and ${MAX_CAPACITY}`),
    },
  });
  const submit = async (v: typeof form.values) => {
    try {
      const saved = await save.mutateAsync({ name: v.name.trim(), code: v.code.toUpperCase(), description: v.description.trim() || (cls ? null : undefined), defaultSectionCapacity: v.defaultSectionCapacity });
      notifySuccess(cls ? 'Class updated' : `${v.name} added`);
      onSaved?.(saved.id);
      onClose();
    } catch (err) {
      if (!applyFieldErrors(err, form.setFieldError, ['name', 'code'])) notifyError(err);
    }
  };
  return (
    <Modal opened onClose={onClose} title={cls ? `Edit ${cls.name}` : 'Add class'}>
      <form onSubmit={form.onSubmit(submit)} noValidate>
        <Stack gap="md">
          <SimpleGrid cols={2} spacing="md">
            <TextInput label="Name" placeholder="Grade 10" withAsterisk data-autofocus key={form.key('name')} {...form.getInputProps('name')} />
            <TextInput label="Code" placeholder="G10" withAsterisk key={form.key('code')} {...form.getInputProps('code')} />
          </SimpleGrid>
          <NumberInput
            label="Default section strength"
            description="Seats per section, used when sections are added without a strength."
            min={1}
            max={MAX_CAPACITY}
            allowDecimal={false}
            key={form.key('defaultSectionCapacity')}
            {...form.getInputProps('defaultSectionCapacity')}
          />
          <Textarea label="Description" autosize minRows={2} key={form.key('description')} {...form.getInputProps('description')} />
          {cls && (
            <Text size="xs" c="dimmed">
              Renaming also renames this class and its sections in the hierarchy.
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.submitting}>
              {cls ? 'Save' : 'Add class'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Quick start: create a standard set of classes in one go, skipping codes the school already has. */
export function ClassTemplateModal({ existing, onClose }: { existing: SchoolClass[]; onClose: () => void }) {
  const [templateKey, setTemplateKey] = useState(CLASS_TEMPLATES[0]!.key);
  const [capacity, setCapacity] = useState<number | string>(40);
  const template = CLASS_TEMPLATES.find((t) => t.key === templateKey)!;
  const taken = new Set(existing.flatMap((c) => [c.code, c.name.toLowerCase()]));
  const fresh = template.classes.filter((c) => !taken.has(c.code) && !taken.has(c.name.toLowerCase()));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const chosen = fresh.filter((c) => !excluded.has(c.code));
  const create = useSchoolMutation((classes: ClassInput[]) => academicsApi.createClasses(classes));
  const validCapacity = typeof capacity === 'number' && capacity >= 1 && capacity <= MAX_CAPACITY;

  return (
    <Modal opened onClose={onClose} title="Add classes from a template" size="lg">
      <Stack gap="md">
        <Radio.Group label="School structure" value={templateKey} onChange={(v) => { setTemplateKey(v); setExcluded(new Set()); }}>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mt="xs">
            {CLASS_TEMPLATES.map((t) => (
              <Radio.Card key={t.key} value={t.key} p="sm" radius="md">
                <Group wrap="nowrap" align="flex-start" gap="sm">
                  <Radio.Indicator />
                  <Stack gap={0}>
                    <Text fw={600} size="sm">
                      {t.label}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t.description}
                    </Text>
                  </Stack>
                </Group>
              </Radio.Card>
            ))}
          </SimpleGrid>
        </Radio.Group>
        <NumberInput label="Default section strength" min={1} max={MAX_CAPACITY} allowDecimal={false} value={capacity} onChange={setCapacity} w={220} error={!validCapacity && `Between 1 and ${MAX_CAPACITY}`} />
        <Stack gap={6}>
          <Text fw={600} size="sm">
            Classes to add
          </Text>
          {fresh.length === 0 ? (
            <Text size="sm" c="dimmed">
              Your school already has every class in this template.
            </Text>
          ) : (
            <Group gap="xs">
              {fresh.map((c) => (
                <Checkbox
                  key={c.code}
                  label={c.name}
                  checked={!excluded.has(c.code)}
                  onChange={(e) => {
                    const next = new Set(excluded);
                    if (e.currentTarget.checked) next.delete(c.code);
                    else next.add(c.code);
                    setExcluded(next);
                  }}
                />
              ))}
            </Group>
          )}
          {fresh.length < template.classes.length && (
            <Text size="xs" c="dimmed">
              {plural(template.classes.length - fresh.length, 'class', 'classes')} already exist and will be skipped.
            </Text>
          )}
        </Stack>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={chosen.length === 0 || !validCapacity}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                chosen.map((c) => ({ ...c, defaultSectionCapacity: capacity as number })),
                {
                  onSuccess: (r) => {
                    notifySuccess(`Added ${plural(r.length, 'class', 'classes')}`);
                    onClose();
                  },
                  onError: (e) => notifyError(e),
                },
              )
            }
          >
            Add {plural(chosen.length, 'class', 'classes')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/**
 * Bulk setup for one year: how many sections each class has and their strength. Sets a target
 * total per class; the backend only ever adds the missing sections.
 */
export function SectionSetupModal({ year, classes, onClose }: { year: YearRef; classes: SchoolClass[]; onClose: () => void }) {
  const active = classes.filter((c) => c.status === 'active');
  const [rows, setRows] = useState(() => new Map(active.map((c) => [c.id, { count: Math.max(c.sectionCount, 1), capacity: c.defaultSectionCapacity }])));
  const [naming, setNaming] = useState<'alphabetic' | 'numeric'>('alphabetic');
  const bulk = useSchoolMutation(() =>
    academicsApi.bulkSections({
      academicYearId: year.id,
      naming,
      items: active.flatMap((c) => {
        const r = rows.get(c.id)!;
        return r.count > c.sectionCount ? [{ classId: c.id, sectionCount: r.count, capacity: r.capacity }] : [];
      }),
    }),
  );
  const set = (id: string, patch: Partial<{ count: number; capacity: number }>) => setRows(new Map(rows).set(id, { ...rows.get(id)!, ...patch }));
  const additions = active.reduce((n, c) => n + Math.max(0, rows.get(c.id)!.count - c.sectionCount), 0);
  const newSeats = active.reduce((n, c) => n + Math.max(0, rows.get(c.id)!.count - c.sectionCount) * rows.get(c.id)!.capacity, 0);
  const invalid = active.some((c) => {
    const r = rows.get(c.id)!;
    return !(r.capacity >= 1 && r.capacity <= MAX_CAPACITY && r.count >= 1 && r.count <= 26);
  });

  return (
    <Modal opened onClose={onClose} title={`Set up sections · ${year.name}`} size="xl">
      <Stack gap="md">
        <Alert icon={<IconInfoCircle size={18} />} color="info" variant="light">
          Set how many sections each class should have and the strength of the new ones. Existing sections are kept as they are; reduce a class from its page.
        </Alert>
        <Group justify="space-between">
          <Group gap="sm">
            <Text size="sm" fw={500}>
              Name new sections
            </Text>
            <SegmentedControl
              size="xs"
              value={naming}
              onChange={(v) => setNaming(v as typeof naming)}
              data={[
                { value: 'alphabetic', label: 'A, B, C' },
                { value: 'numeric', label: '1, 2, 3' },
              ]}
            />
          </Group>
          <Text size="sm" c="dimmed" className="tabular-nums">
            Adds {plural(additions, 'section')} · {newSeats.toLocaleString()} seats
          </Text>
        </Group>
        <ScrollArea.Autosize mah="55vh">
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Class</Table.Th>
                <Table.Th ta="right">Now</Table.Th>
                <Table.Th w={150}>Sections</Table.Th>
                <Table.Th w={170}>Strength (new)</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {active.map((c) => {
                const r = rows.get(c.id)!;
                const adding = r.count - c.sectionCount;
                return (
                  <Table.Tr key={c.id}>
                    <Table.Td>
                      <Group gap="xs">
                        <Text fw={500}>{c.name}</Text>
                        {adding > 0 && (
                          <Badge size="sm" variant="light" color="success">
                            +{adding}
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right" className="tabular-nums">
                      {c.sectionCount}
                    </Table.Td>
                    <Table.Td>
                      <NumberInput aria-label={`${c.name} sections`} size="xs" min={Math.max(1, c.sectionCount)} max={26} allowDecimal={false} value={r.count} onChange={(v) => set(c.id, { count: Number(v) || 0 })} />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput
                        aria-label={`${c.name} strength per new section`}
                        size="xs"
                        min={1}
                        max={MAX_CAPACITY}
                        allowDecimal={false}
                        suffix=" seats"
                        disabled={adding <= 0}
                        value={r.capacity}
                        onChange={(v) => set(c.id, { capacity: Number(v) || 0 })}
                      />
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={additions === 0 || invalid}
            loading={bulk.isPending}
            onClick={() =>
              bulk.mutate(undefined, {
                onSuccess: (r) => {
                  notifySuccess(`Added ${plural(r.created.length, 'section')}`);
                  onClose();
                },
                onError: (e) => notifyError(e),
              })
            }
          >
            Add {plural(additions, 'section')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
