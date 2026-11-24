import { Alert, Button, Checkbox, Divider, Group, Select, SimpleGrid, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { hasLength, useForm } from '@mantine/form';
import { IconLock } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { notifyError } from '@/components/feedback/feedback';
import { ApiError } from '@/services/api/client';
import { useStudentSettings, type StudentInput } from '@/services/api/students';
import { BLOOD_GROUPS, type Address, type StudentDetail } from '@/types/students';
import { genderOptions } from './student-helpers';

const ADDRESS_FIELDS = [
  ['line1', 'Address line 1', true],
  ['line2', 'Address line 2', false],
  ['city', 'City / village', true],
  ['district', 'District', false],
  ['state', 'State', true],
  ['postalCode', 'PIN code', true],
  ['country', 'Country', true],
] as const;

type AddressValues = Record<(typeof ADDRESS_FIELDS)[number][0], string>;
const toAddressValues = (a: Address | null | undefined, country = 'India'): AddressValues => ({
  line1: a?.line1 ?? '',
  line2: a?.line2 ?? '',
  city: a?.city ?? '',
  district: a?.district ?? '',
  state: a?.state ?? '',
  postalCode: a?.postalCode ?? '',
  country: a?.country ?? country,
});
const trimAddress = (a: AddressValues): Address => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.trim()]));
const addressFilled = (a: AddressValues) => ADDRESS_FIELDS.every(([k, , required]) => !required || a[k].trim());

/**
 * Basic information (FRD §3.2–3.3). Used for the first registration step and for editing. In
 * `draft` mode only the first name is required; mandatory fields are enforced when registration
 * is completed. Sensitive fields appear only for users allowed to see them.
 */
export function StudentDetailsForm({
  student,
  mode,
  sensitiveAllowed,
  submitLabel,
  onSubmit,
  secondaryAction,
}: {
  student?: StudentDetail;
  mode: 'draft' | 'registered';
  sensitiveAllowed: boolean;
  submitLabel: string;
  onSubmit: (input: StudentInput) => Promise<unknown>;
  secondaryAction?: ReactNode;
}) {
  const settings = useStudentSettings();
  const strict = mode === 'registered';
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: {
      firstName: student?.firstName ?? '',
      middleName: student?.middleName ?? '',
      lastName: student?.lastName ?? '',
      dateOfBirth: student?.dateOfBirth ?? '',
      gender: student?.gender ?? '',
      bloodGroup: student?.bloodGroup ?? '',
      nationality: student?.nationality ?? 'Indian',
      motherTongue: student?.motherTongue ?? '',
      previousSchool: student?.previousSchool ?? '',
      previousClass: student?.previousClass ?? '',
      religion: student?.sensitive?.religion ?? '',
      casteCategory: student?.sensitive?.casteCategory ?? '',
      caste: student?.sensitive?.caste ?? '',
      medicalNotes: student?.sensitive?.medicalNotes ?? '',
      residential: toAddressValues(student?.addresses.residential),
      permanentSameAsResidential: student?.addresses.permanentSameAsResidential ?? true,
      permanent: toAddressValues(student?.addresses.permanentSameAsResidential ? null : student?.addresses.permanent),
    },
    validate: {
      firstName: hasLength({ min: 1, max: 80 }, 'Required'),
      lastName: (v) => (strict && !v.trim() ? 'Required' : null),
      gender: (v) => (strict && !v ? 'Required' : null),
      dateOfBirth: (v) => (strict && !v ? 'Required' : v && v > new Date().toISOString().slice(0, 10) ? 'Cannot be in the future' : null),
      residential: (v) => (strict && !addressFilled(v) ? 'Fill in the required address fields' : null),
    },
  });

  const submit = async (v: typeof form.values) => {
    const opt = (x: string) => x.trim() || null;
    const input: StudentInput = {
      firstName: v.firstName.trim(),
      middleName: opt(v.middleName),
      lastName: v.lastName.trim() || undefined,
      dateOfBirth: v.dateOfBirth || undefined,
      gender: v.gender || undefined,
      bloodGroup: v.bloodGroup || null,
      nationality: opt(v.nationality),
      motherTongue: opt(v.motherTongue),
      previousSchool: opt(v.previousSchool),
      previousClass: opt(v.previousClass),
      residentialAddress: trimAddress(v.residential),
      permanentSameAsResidential: v.permanentSameAsResidential,
      permanentAddress: v.permanentSameAsResidential ? null : trimAddress(v.permanent),
      ...(sensitiveAllowed && { religion: opt(v.religion), casteCategory: v.casteCategory || null, caste: opt(v.caste), medicalNotes: opt(v.medicalNotes) }),
    };
    try {
      await onSubmit(input);
    } catch (err) {
      const fields = err instanceof ApiError ? err.fieldErrors : {};
      if (Object.keys(fields).length) form.setErrors(fields);
      notifyError(err);
    }
  };

  const addressGrid = (prefix: 'residential' | 'permanent') => (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
      {ADDRESS_FIELDS.map(([k, label, required]) => (
        <TextInput key={form.key(`${prefix}.${k}`)} label={label} withAsterisk={required} {...form.getInputProps(`${prefix}.${k}`)} />
      ))}
    </SimpleGrid>
  );

  const sameAddress = form.useWatchValue('permanentSameAsResidential');
  const categories = settings.data?.casteCategories ?? [];
  return (
    <form onSubmit={form.onSubmit(submit)} noValidate>
      <Stack gap="lg">
        <Stack gap="md">
          <Title order={4}>Student</Title>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            <TextInput label="First name" withAsterisk data-autofocus key={form.key('firstName')} {...form.getInputProps('firstName')} />
            <TextInput label="Middle name" key={form.key('middleName')} {...form.getInputProps('middleName')} />
            <TextInput label="Last name" withAsterisk key={form.key('lastName')} {...form.getInputProps('lastName')} />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            <TextInput type="date" label="Date of birth" withAsterisk key={form.key('dateOfBirth')} {...form.getInputProps('dateOfBirth')} />
            <Select label="Gender" withAsterisk data={genderOptions(settings.data?.allowUndisclosedGender ?? true)} key={form.key('gender')} {...form.getInputProps('gender')} />
            <Select label="Blood group" clearable data={[...BLOOD_GROUPS]} key={form.key('bloodGroup')} {...form.getInputProps('bloodGroup')} />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput label="Nationality" key={form.key('nationality')} {...form.getInputProps('nationality')} />
            <TextInput label="Mother tongue" key={form.key('motherTongue')} {...form.getInputProps('motherTongue')} />
            <TextInput label="Previous school" key={form.key('previousSchool')} {...form.getInputProps('previousSchool')} />
            <TextInput label="Previous class" key={form.key('previousClass')} {...form.getInputProps('previousClass')} />
          </SimpleGrid>
        </Stack>

        <Divider />
        <Stack gap="md">
          <Title order={4}>Residential address</Title>
          {addressGrid('residential')}
          {form.errors.residential && (
            <Text size="sm" c="error">
              {form.errors.residential}
            </Text>
          )}
          <Checkbox
            label="Permanent address is the same as the residential address"
            key={form.key('permanentSameAsResidential')}
            {...form.getInputProps('permanentSameAsResidential', { type: 'checkbox' })}
          />
          {!sameAddress && (
            <>
              <Title order={5}>Permanent address</Title>
              {addressGrid('permanent')}
            </>
          )}
        </Stack>

        {sensitiveAllowed && (
          <>
            <Divider />
            <Stack gap="md">
              <Title order={4}>Sensitive information</Title>
              <Alert color="neutral" variant="light" icon={<IconLock size={18} />}>
                Record religion, caste and medical notes only when the school needs them. They are hidden from teachers and ID cards, and every view is audited.
              </Alert>
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                <TextInput label="Religion" key={form.key('religion')} {...form.getInputProps('religion')} />
                <Select label="Caste category" clearable data={categories} key={form.key('casteCategory')} {...form.getInputProps('casteCategory')} />
                <TextInput label="Caste / sub-caste" key={form.key('caste')} {...form.getInputProps('caste')} />
              </SimpleGrid>
              <Textarea label="Medical notes" description="Allergies, conditions or medication the school should know about." autosize minRows={2} key={form.key('medicalNotes')} {...form.getInputProps('medicalNotes')} />
            </Stack>
          </>
        )}

        <Group justify="flex-end">
          {secondaryAction}
          <Button type="submit" loading={form.submitting}>
            {submitLabel}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

