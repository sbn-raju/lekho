import { Card, Group, Select, SimpleGrid, Stack, TextInput, Title } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import { useRef } from 'react';
import { slugify, TIMEZONES, type OrganizationValues } from './organization-form';

/** Field layout shared by Create organization (FRD §14.1 screen 3) and Edit. */
export function OrganizationFields({ form, lockIdentity }: { form: UseFormReturnType<OrganizationValues>; lockIdentity?: boolean }) {
  const nameProps = form.getInputProps('name');
  const slugProps = form.getInputProps('slug');
  // setFieldValue marks a field as touched, so track the user's own edits separately.
  const slugEditedByUser = useRef(lockIdentity ?? false);
  return (
    <Stack gap="md">
      <Card>
        <Title order={3} fz={16} mb="md">
          School
        </Title>
        <Stack gap="md">
          <TextInput
            label="School name"
            placeholder="ABC International School"
            withAsterisk
            key={form.key('name')}
            {...nameProps}
            onChange={(e) => {
              nameProps.onChange(e);
              // Suggest a slug until the user edits it themselves.
              if (!slugEditedByUser.current) form.setFieldValue('slug', slugify(e.currentTarget.value));
            }}
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput
              label="Slug"
              description="Used in links. Lowercase, hyphenated."
              withAsterisk
              disabled={lockIdentity}
              key={form.key('slug')}
              {...slugProps}
              onChange={(e) => {
                slugEditedByUser.current = true;
                slugProps.onChange(e);
              }}
            />
            <TextInput label="School code" description="Short unique code, e.g. ABC01." withAsterisk disabled={lockIdentity} key={form.key('code')} {...form.getInputProps('code')} />
          </SimpleGrid>
        </Stack>
      </Card>
      <Card>
        <Title order={3} fz={16} mb="md">
          Contact
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <TextInput label="Contact email" type="email" withAsterisk key={form.key('email')} {...form.getInputProps('email')} />
          <TextInput label="Phone" type="tel" key={form.key('phone')} {...form.getInputProps('phone')} />
          <TextInput label="Address" key={form.key('line1')} {...form.getInputProps('line1')} />
          <TextInput label="City" key={form.key('city')} {...form.getInputProps('city')} />
          <TextInput label="State" key={form.key('state')} {...form.getInputProps('state')} />
          <Group grow>
            <TextInput label="Country" key={form.key('country')} {...form.getInputProps('country')} />
            <TextInput label="Postal code" key={form.key('postalCode')} {...form.getInputProps('postalCode')} />
          </Group>
        </SimpleGrid>
      </Card>
      <Card>
        <Title order={3} fz={16} mb="md">
          Settings
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Select label="Timezone" data={TIMEZONES} searchable allowDeselect={false} key={form.key('timezone')} {...form.getInputProps('timezone')} />
          <TextInput label="Academic year" placeholder="2026-27" key={form.key('academicYear')} {...form.getInputProps('academicYear')} />
        </SimpleGrid>
      </Card>
    </Stack>
  );
}
