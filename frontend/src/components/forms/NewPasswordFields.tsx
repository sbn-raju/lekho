import { PasswordInput, Stack } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';

/** "New password" + "Confirm password" pair for any form with `password` and `confirmPassword`. */
export function NewPasswordFields<T extends { password: string; confirmPassword: string }>({
  form,
  label = 'New password',
}: {
  form: UseFormReturnType<T>;
  label?: string;
}) {
  return (
    <Stack gap="md">
      <PasswordInput
        label={label}
        description="At least 12 characters. A short phrase is easier to remember than random symbols."
        autoComplete="new-password"
        withAsterisk
        key={form.key('password')}
        {...form.getInputProps('password')}
      />
      <PasswordInput label="Confirm password" autoComplete="new-password" withAsterisk key={form.key('confirmPassword')} {...form.getInputProps('confirmPassword')} />
    </Stack>
  );
}
