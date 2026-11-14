import { Button, Center, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { Logo } from '@/components/brand/Logo';

export function NotFoundPage() {
  return (
    <Center mih="100vh" p="md">
      <Stack align="center" gap="md" ta="center" maw={420}>
        <Logo symbolOnly size={56} />
        <Title order={1} fz={28}>
          Page not found
        </Title>
        <Text c="dimmed">The page you're looking for doesn't exist or has been moved.</Text>
        <Button component={Link} to="/">
          Back to dashboard
        </Button>
      </Stack>
    </Center>
  );
}
