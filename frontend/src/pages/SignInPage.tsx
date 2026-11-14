import { Anchor, Button, Checkbox, Group, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { hasLength, isEmail, useForm } from '@mantine/form';
import { useNavigate } from 'react-router';
import { brandCopy } from '@/brand';
import { Logo } from '@/components/brand/Logo';

interface SignInValues {
  email: string;
  password: string;
  remember: boolean;
}

export function SignInPage() {
  const navigate = useNavigate();
  const form = useForm<SignInValues>({
    mode: 'uncontrolled',
    initialValues: { email: '', password: '', remember: true },
    validate: {
      email: isEmail('Enter a valid email address'),
      password: hasLength({ min: 8 }, 'Password must be at least 8 characters'),
    },
  });

  // TODO: replace with the real auth call once the backend exposes it.
  const handleSubmit = async () => {
    navigate('/');
  };

  return (
    <Stack gap="lg">
      {/* Full wordmark on sign-in; the panel logo is hidden on small screens. */}
      <Logo size={40} hiddenFrom="md" />
      <Stack gap={4}>
        <Title order={2}>Sign in to {brandCopy.name}</Title>
        <Text c="dimmed">{brandCopy.tagline}</Text>
      </Stack>

      <form onSubmit={form.onSubmit(handleSubmit)} noValidate>
        <Stack gap="md">
          <TextInput
            label="Email"
            placeholder="you@school.edu"
            type="email"
            autoComplete="email"
            withAsterisk
            key={form.key('email')}
            {...form.getInputProps('email')}
          />
          <PasswordInput
            label="Password"
            placeholder="Your password"
            autoComplete="current-password"
            withAsterisk
            key={form.key('password')}
            {...form.getInputProps('password')}
          />
          <Group justify="space-between">
            <Checkbox
              label="Keep me signed in"
              key={form.key('remember')}
              {...form.getInputProps('remember', { type: 'checkbox' })}
            />
            <Anchor size="sm" href="#">
              Forgot password?
            </Anchor>
          </Group>
          <Button type="submit" fullWidth size="md" loading={form.submitting}>
            Sign in
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}
