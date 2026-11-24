import { ActionIcon, Alert, Badge, Button, Card, Checkbox, ColorInput, Group, Modal, NumberInput, SegmentedControl, SimpleGrid, Skeleton, Stack, Switch, TagsInput, Text, TextInput, Textarea, Title } from '@mantine/core';
import { hasLength, useForm } from '@mantine/form';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { tokens } from '@/brand';
import { PageHeader } from '@/components/PageHeader';
import { confirmAction, notifyError, notifySuccess } from '@/components/feedback/feedback';
import { QueryError } from '@/components/feedback/QueryState';
import { ApiError } from '@/services/api/client';
import { useSchool, useSchoolMutation } from '@/services/api/school';
import { studentsApi, useIdCardTemplates, useStudentSettings, type TemplateInput } from '@/services/api/students';
import { ID_CARD_FIELDS, type IdCardField, type IdCardTemplate, type StudentSettings } from '@/types/students';
import { IdCardView } from './IdCardView';
import { SAMPLE_CARD } from './student-helpers';

const TOKENS = [
  ['{SCHOOL_CODE}', "The school's code"],
  ['{YEAR}', 'Start year of the academic year, e.g. 2026'],
  ['{YY}', 'Last two digits, e.g. 26'],
  ['{ACADEMIC_YEAR}', 'Academic year code, e.g. 2026-27'],
  ['{SEQ}', 'Sequence number (required)'],
] as const;

const FIELD_LABEL: Record<IdCardField, string> = {
  admissionNumber: 'Admission number',
  class: 'Class',
  section: 'Section',
  academicYear: 'Academic year',
  dateOfBirth: 'Date of birth',
  bloodGroup: 'Blood group',
  schoolAddress: 'School address',
  schoolPhone: 'School phone',
  schoolEmail: 'School email',
  emergencyContact: 'Emergency contact (verified only)',
  validUntil: 'Valid until',
};

/** Admission number format (FRD §6.2), value lists, and ID card templates (FRD §8.3). */
export function StudentSettingsPage() {
  const settings = useStudentSettings();
  return (
    <>
      <PageHeader title="Admission & ID card settings" description="How admission numbers are issued, which values forms offer, and how ID cards look." />
      {settings.isError ? <QueryError error={settings.error} /> : !settings.data ? <Skeleton h={300} /> : <SettingsForm key={settings.data.updatedAt ?? 'new'} settings={settings.data} />}
      <TemplatesSection />
    </>
  );
}

function SettingsForm({ settings }: { settings: StudentSettings }) {
  const save = useSchoolMutation((body: Parameters<typeof studentsApi.updateSettings>[0]) => studentsApi.updateSettings(body));
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: {
      format: settings.admissionNumber.format,
      sequencePadding: settings.admissionNumber.sequencePadding,
      casteCategories: settings.casteCategories,
      allowUndisclosedGender: settings.allowUndisclosedGender,
    },
    validate: {
      format: (v) => ((v.match(/\{SEQ\}/g) ?? []).length !== 1 ? 'Include {SEQ} exactly once' : null),
      casteCategories: (v) => (v.length === 0 ? 'Add at least one category' : null),
    },
  });
  const submit = async (v: typeof form.values) => {
    try {
      await save.mutateAsync(v);
      notifySuccess('Settings saved');
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.format) form.setFieldError('format', err.message);
      else notifyError(err);
    }
  };
  return (
    <form onSubmit={form.onSubmit(submit)} noValidate>
      <SimpleGrid cols={{ base: 1, md: 2 }} mb="lg">
        <Card>
          <Stack gap="md">
            <Title order={4}>Admission numbers</Title>
            <Group align="flex-start" grow>
              <TextInput label="Format" withAsterisk key={form.key('format')} {...form.getInputProps('format')} />
              <NumberInput label="Sequence digits" min={1} max={10} maw={140} allowDecimal={false} key={form.key('sequencePadding')} {...form.getInputProps('sequencePadding')} />
            </Group>
            <Text size="sm">
              Next number: <b className="tabular-nums">{settings.admissionNumberPreview}</b>
            </Text>
            <Stack gap={2}>
              {TOKENS.map(([t, d]) => (
                <Text size="xs" c="dimmed" key={t}>
                  <code>{t}</code> {d}
                </Text>
              ))}
            </Stack>
            <Alert color="info" variant="light">
              Numbers are issued when a registration is completed and are never reused, even for archived students. Changing the format only affects new admissions.
            </Alert>
          </Stack>
        </Card>
        <Card>
          <Stack gap="md">
            <Title order={4}>Form options</Title>
            <TagsInput label="Caste categories" description="Offered when caste category is recorded. Press Enter to add." key={form.key('casteCategories')} {...form.getInputProps('casteCategories')} />
            <Switch label='Offer "Prefer not to disclose" for gender' key={form.key('allowUndisclosedGender')} {...form.getInputProps('allowUndisclosedGender', { type: 'checkbox' })} />
            <Group justify="flex-end" mt="auto">
              <Button type="submit" loading={form.submitting}>
                Save settings
              </Button>
            </Group>
          </Stack>
        </Card>
      </SimpleGrid>
    </form>
  );
}

function TemplatesSection() {
  const templates = useIdCardTemplates();
  const school = useSchool();
  const [editing, setEditing] = useState<IdCardTemplate | 'new' | null>(null);
  const remove = useSchoolMutation((id: string) => studentsApi.deleteTemplate(id));
  const setDefault = useSchoolMutation((id: string) => studentsApi.updateTemplate(id, { isDefault: true }));
  const schoolPreview = {
    name: school.data?.name ?? 'Your school',
    code: school.data?.code ?? '',
    address: [school.data?.address?.line1, school.data?.address?.city, school.data?.address?.state].filter(Boolean).join(', '),
    phone: school.data?.contact?.phone ?? null,
    email: school.data?.contact?.email ?? null,
  };
  return (
    <Card>
      <Group justify="space-between" mb="md">
        <Title order={4}>ID card templates</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
          New template
        </Button>
      </Group>
      {templates.isError && <QueryError error={templates.error} />}
      <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }}>
        {(templates.data ?? []).map((t) => (
          <Card key={t.id} withBorder>
            <Stack gap="sm">
              <Group justify="space-between">
                <Group gap="xs">
                  <Text fw={600}>{t.name}</Text>
                  {t.isDefault && (
                    <Badge size="sm" variant="light">
                      Default
                    </Badge>
                  )}
                  {t.builtIn && (
                    <Badge size="sm" variant="light" color="neutral">
                      Built in
                    </Badge>
                  )}
                </Group>
                {!t.builtIn && (
                  <Group gap={4}>
                    <ActionIcon variant="subtle" color="neutral" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
                      <IconPencil size={16} stroke={1.75} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="error"
                      aria-label={`Delete ${t.name}`}
                      onClick={() => confirmAction({ title: `Delete ${t.name}?`, message: 'Cards already generated are not affected.', confirmLabel: 'Delete', destructive: true, onConfirm: () => remove.mutateAsync(t.id), successMessage: 'Template deleted' })}
                    >
                      <IconTrash size={16} stroke={1.75} />
                    </ActionIcon>
                  </Group>
                )}
              </Group>
              <IdCardView template={{ ...t, showBackSide: false }} school={schoolPreview} card={SAMPLE_CARD} scale={1} />
              {!t.isDefault && !t.builtIn && (
                <Button size="xs" variant="subtle" w="fit-content" onClick={() => setDefault.mutate(t.id, { onSuccess: () => notifySuccess(`${t.name} is now the default`), onError: (e) => notifyError(e) })}>
                  Make default
                </Button>
              )}
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
      {editing && <TemplateModal template={editing === 'new' ? undefined : editing} school={schoolPreview} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function TemplateModal({ template, school, onClose }: { template?: IdCardTemplate; school: Parameters<typeof IdCardView>[0]['school']; onClose: () => void }) {
  const save = useSchoolMutation((body: TemplateInput & { name: string }) => (template ? studentsApi.updateTemplate(template.id, body) : studentsApi.createTemplate(body)));
  const c = tokens.colors;
  // Controlled (not the usual uncontrolled) so the card preview re-renders on every change.
  const form = useForm({
    mode: 'controlled',
    initialValues: {
      name: template?.name ?? '',
      layout: template?.layout ?? ('portrait' as IdCardTemplate['layout']),
      primaryColor: template?.primaryColor ?? c.primary,
      accentColor: template?.accentColor ?? c.accent,
      textColor: template?.textColor ?? c.text,
      backgroundColor: template?.backgroundColor ?? c.surface,
      photoPosition: template?.photoPosition ?? ('center' as IdCardTemplate['photoPosition']),
      fields: template?.fields ?? (['admissionNumber', 'class', 'section', 'academicYear', 'dateOfBirth', 'bloodGroup', 'schoolAddress', 'schoolPhone'] as IdCardField[]),
      showBackSide: template?.showBackSide ?? false,
      backText: template?.backText ?? '',
      signatureLabel: template?.signatureLabel ?? 'Principal',
      validUntil: template?.validUntil ?? '',
      isDefault: template?.isDefault ?? false,
    },
    validate: {
      name: hasLength({ min: 1, max: 80 }, 'Required'),
      primaryColor: (v) => (/^#[0-9a-fA-F]{6}$/.test(v) ? null : 'Use a 6-digit hex colour'),
      accentColor: (v) => (/^#[0-9a-fA-F]{6}$/.test(v) ? null : 'Use a 6-digit hex colour'),
      textColor: (v) => (/^#[0-9a-fA-F]{6}$/.test(v) ? null : 'Use a 6-digit hex colour'),
      backgroundColor: (v) => (/^#[0-9a-fA-F]{6}$/.test(v) ? null : 'Use a 6-digit hex colour'),
    },
  });
  const v = form.getValues();
  const submit = async (values: typeof form.values) => {
    try {
      await save.mutateAsync({ ...values, backText: values.backText.trim() || null, signatureLabel: values.signatureLabel.trim() || null, validUntil: values.validUntil || null });
      notifySuccess(template ? 'Template saved' : 'Template created');
      onClose();
    } catch (err) {
      notifyError(err);
    }
  };
  const preview: IdCardTemplate = { ...v, id: 'preview', builtIn: false, backText: v.backText || null, signatureLabel: v.signatureLabel || null, validUntil: v.validUntil || null };
  return (
    <Modal opened onClose={onClose} title={template ? `Edit ${template.name}` : 'New ID card template'} size="80rem">
      <form onSubmit={form.onSubmit(submit)} noValidate>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
          <Stack gap="md">
            <TextInput label="Name" withAsterisk data-autofocus {...form.getInputProps('name')} />
            <Group grow>
              <Stack gap={4}>
                <Text size="sm" fw={500}>
                  Layout
                </Text>
                <SegmentedControl data={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} {...form.getInputProps('layout')} />
              </Stack>
              <Stack gap={4}>
                <Text size="sm" fw={500}>
                  Photo position
                </Text>
                <SegmentedControl data={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]} {...form.getInputProps('photoPosition')} />
              </Stack>
            </Group>
            <SimpleGrid cols={2} spacing="md">
              <ColorInput label="School colour" format="hex" {...form.getInputProps('primaryColor')} />
              <ColorInput label="Accent colour" format="hex" {...form.getInputProps('accentColor')} />
              <ColorInput label="Text colour" format="hex" {...form.getInputProps('textColor')} />
              <ColorInput label="Background" format="hex" {...form.getInputProps('backgroundColor')} />
            </SimpleGrid>
            <Checkbox.Group label="Fields on the card" description="Caste, religion and other sensitive details are never printed." {...form.getInputProps('fields')}>
              <SimpleGrid cols={2} spacing={6} mt="xs">
                {ID_CARD_FIELDS.map((f) => (
                  <Checkbox key={f} value={f} label={FIELD_LABEL[f]} />
                ))}
              </SimpleGrid>
            </Checkbox.Group>
            <SimpleGrid cols={2} spacing="md">
              <TextInput label="Signature label" placeholder="Principal" {...form.getInputProps('signatureLabel')} />
              <TextInput type="date" label="Valid until" description="Blank: end of the academic year." {...form.getInputProps('validUntil')} />
            </SimpleGrid>
            <Switch label="Print a back side" {...form.getInputProps('showBackSide', { type: 'checkbox' })} />
            {v.showBackSide && <Textarea label="Back side text" placeholder="This card is the property of the school…" autosize minRows={2} {...form.getInputProps('backText')} />}
            <Switch label="Use as the default template" {...form.getInputProps('isDefault', { type: 'checkbox' })} />
          </Stack>
          <Stack gap="md">
            <Text size="sm" fw={500}>
              Preview
            </Text>
            <IdCardView template={preview} school={school} card={SAMPLE_CARD} scale={1.4} />
          </Stack>
        </SimpleGrid>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.submitting}>
            {template ? 'Save template' : 'Create template'}
          </Button>
        </Group>
      </form>
    </Modal>
  );
}
