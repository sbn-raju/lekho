import { Card, List, SimpleGrid, Stack, Tabs, Text, Title } from '@mantine/core';
import { PageHeader } from '@/components/PageHeader';
import { AuditLogPage } from '@/modules/shared/audit/AuditLogPage';

/**
 * FRD §14.1 screen 9. Authentication activity and failed sign-ins come from the audit trail.
 * Password and lockout policies are configured on the server (backend .env); shown here for reference.
 */
export function SecurityPage() {
  return (
    <>
      <PageHeader title="Security" description="Sign-in activity, failed attempts and the policies protecting every account." />
      <Tabs defaultValue="failed" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="failed">Failed sign-ins</Tabs.Tab>
          <Tabs.Tab value="auth">Authentication activity</Tabs.Tab>
          <Tabs.Tab value="policy">Policies</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="failed">
          <AuditLogPage scope="platform" embedded preset={{ action: 'auth.login', result: 'failure' }} />
        </Tabs.Panel>
        <Tabs.Panel value="auth">
          <AuditLogPage scope="platform" embedded preset={{ action: 'auth.' }} />
        </Tabs.Panel>
        <Tabs.Panel value="policy">
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Card>
              <Title order={3} fz={16} mb="sm">
                Passwords
              </Title>
              <List size="sm" spacing={6}>
                <List.Item>At least 12 characters; stored with Argon2id.</List.Item>
                <List.Item>Changing a password signs out every other device.</List.Item>
                <List.Item>Reset links are single-use and expire after 30 minutes (default).</List.Item>
              </List>
            </Card>
            <Card>
              <Title order={3} fz={16} mb="sm">
                Sessions and lockout
              </Title>
              <List size="sm" spacing={6}>
                <List.Item>Accounts lock for 15 minutes after 5 failed sign-ins (default).</List.Item>
                <List.Item>Access tokens last 10 minutes; sessions last 14 days (default).</List.Item>
                <List.Item>Refresh tokens rotate on every use; reuse revokes the session.</List.Item>
              </List>
            </Card>
          </SimpleGrid>
          <Stack mt="md">
            <Text size="sm" c="dimmed">
              Defaults shown; the exact values come from the server configuration (MAX_FAILED_LOGIN_ATTEMPTS, ACCOUNT_LOCK_MINUTES, PASSWORD_RESET_TTL_MINUTES, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS).
              To review a staff member's sessions, open them under Platform staff.
            </Text>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
