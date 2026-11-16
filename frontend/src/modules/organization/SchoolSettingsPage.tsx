import { Button, Card, Grid, Group, NumberInput, Select, SimpleGrid, Skeleton, Stack, TextInput, Title } from '@mantine/core';
import { isEmail, useForm } from '@mantine/form';
import { useEffect } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { notifyError, notifySuccess } from '@/components/feedback/feedback';
import { QueryError } from '@/components/feedback/QueryState';
import { useAccess } from '@/services/api/access';
import { schoolApi, useSchool, useSchoolMutation } from '@/services/api/school';

const TIMEZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Asia/Kolkata', 'UTC'];
  }
})();

/** School profile and settings. Slug and code belong to the platform and aren't editable here. */
export function SchoolSettingsPage() {
  const access = useAccess();
  const school = useSchool();
  const canEdit = access.canOrg('settings.update');
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { name: '', email: '', phone: '', line1: '', city: '', state: '', country: '', postalCode: '', timezone: 'Asia/Kolkata', academicYear: '', hierarchyMaxDepth: 6 },
    validate: { email: isEmail('Enter a valid email address') },
  });

  const save = useSchoolMutation(async (v: typeof form.values) => {
    const id = school.data!.id;
    await schoolApi.updateOrganization(id, {
      name: v.name,
      contact: { email: v.email, phone: v.phone || undefined },
      address: { line1: v.line1 || undefined, city: v.city || undefined, state: v.state || undefined, country: v.country || undefined, postalCode: v.postalCode || undefined },
    });
    await schoolApi.updateSettings(id, { timezone: v.timezone, academicYear: v.academicYear || undefined, hierarchyMaxDepth: v.hierarchyMaxDepth });
  });

  useEffect(() => {
    const s = school.data;
    if (!s) return;
    form.initialize({
      name: s.name,
      email: s.contact.email,
      phone: s.contact.phone ?? '',
      line1: s.address.line1 ?? '',
      city: s.address.city ?? '',
      state: s.address.state ?? '',
      country: s.address.country ?? '',
      postalCode: s.address.postalCode ?? '',
      timezone: s.settings.timezone,
      academicYear: s.settings.academicYear ?? '',
      hierarchyMaxDepth: s.settings.hierarchyMaxDepth ?? 6,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialize once data arrives
  }, [school.data]);

  if (school.isError) return <QueryError error={school.error} onRetry={() => void school.refetch()} />;
  if (!school.data) return <Skeleton h={400} radius="lg" />;

  const submit = async (v: typeof form.values) => {
    try {
      await save.mutateAsync(v);
      form.setInitialValues(v);
      form.resetDirty(v);
      notifySuccess('School settings saved');
    } catch (err) {
      notifyError(err);
    }
  };

  return (
    <>
      <PageHeader title="School settings" description={`${school.data.code} · ${school.data.slug}`} />
      <form onSubmit={form.onSubmit(submit)} noValidate style={{ maxWidth: 960 }}>
        <Grid gap="md">
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Card>
              <Title order={3} fz={16} mb="md">
                Profile
              </Title>
              <Stack gap="md">
                <TextInput label="School name" disabled={!canEdit} key={form.key('name')} {...form.getInputProps('name')} />
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <TextInput label="Contact email" type="email" disabled={!canEdit} key={form.key('email')} {...form.getInputProps('email')} />
                  <TextInput label="Phone" type="tel" disabled={!canEdit} key={form.key('phone')} {...form.getInputProps('phone')} />
                  <TextInput label="Address" disabled={!canEdit} key={form.key('line1')} {...form.getInputProps('line1')} />
                  <TextInput label="City" disabled={!canEdit} key={form.key('city')} {...form.getInputProps('city')} />
                  <TextInput label="State" disabled={!canEdit} key={form.key('state')} {...form.getInputProps('state')} />
                  <TextInput label="Postal code" disabled={!canEdit} key={form.key('postalCode')} {...form.getInputProps('postalCode')} />
                  <TextInput label="Country" disabled={!canEdit} key={form.key('country')} {...form.getInputProps('country')} />
                </SimpleGrid>
              </Stack>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Card>
              <Title order={3} fz={16} mb="md">
                Settings
              </Title>
              <Stack gap="md">
                <Select label="Timezone" data={TIMEZONES} searchable allowDeselect={false} disabled={!canEdit} key={form.key('timezone')} {...form.getInputProps('timezone')} />
                <TextInput label="Academic year" placeholder="2026-27" disabled={!canEdit} key={form.key('academicYear')} {...form.getInputProps('academicYear')} />
                <NumberInput
                  label="Hierarchy depth limit"
                  description="Maximum levels of departments, classes and sections."
                  min={1}
                  max={10}
                  disabled={!canEdit}
                  key={form.key('hierarchyMaxDepth')}
                  {...form.getInputProps('hierarchyMaxDepth')}
                />
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>
        {canEdit && (
          <Group justify="flex-end" mt="md">
            <Button variant="default" disabled={!form.isDirty()} onClick={form.reset}>
              Discard changes
            </Button>
            <Button type="submit" disabled={!form.isDirty()} loading={form.submitting}>
              Save settings
            </Button>
          </Group>
        )}
      </form>
    </>
  );
}
