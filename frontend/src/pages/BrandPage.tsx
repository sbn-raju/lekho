import type { ReactNode } from 'react';
import { Box, Button, Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import { brandCopy, tokens } from '@/brand';
import { Logo } from '@/components/brand/Logo';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { STATUSES, type StatusKey } from '@/theme/status';

const swatches: { name: string; hex: string }[] = [
  { name: 'Primary', hex: tokens.colors.primary },
  { name: 'Primary light', hex: tokens.colors.primaryLight },
  { name: 'Primary tint', hex: tokens.colors.primaryTint },
  { name: 'Primary dark', hex: tokens.colors.primaryDark },
  { name: 'Accent', hex: tokens.colors.accent },
  { name: 'Background', hex: tokens.colors.background },
  { name: 'Text', hex: tokens.colors.text },
  { name: 'Muted text', hex: tokens.colors.textMuted },
  { name: 'Border', hex: tokens.colors.border },
  { name: 'Success', hex: tokens.colors.success },
  { name: 'Error', hex: tokens.colors.error },
  { name: 'Info', hex: tokens.colors.info },
  { name: 'Draft', hex: tokens.colors.draft },
];

/** Living reference of the brand kit, rendered with the real components. */
export function BrandPage() {
  return (
    <>
      <PageHeader title="Brand kit" description={`${brandCopy.tagline} — source: docs/brand/brand-guidelines.md`} />

      <Stack gap="lg">
        <Card>
          <Title order={3} fz={18} mb="md">
            Logo variations
          </Title>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
            <Center label="Primary (light)">
              <Logo size={40} />
            </Center>
            <Center label="On dark" dark>
              <Logo variant="dark-background" size={40} />
            </Center>
            <Center label="Symbol only">
              <Logo symbolOnly size={48} />
            </Center>
            <Center label="Monochrome">
              <Logo variant="monochrome" size={40} />
            </Center>
          </SimpleGrid>
        </Card>

        <Card>
          <Title order={3} fz={18} mb="md">
            Colours
          </Title>
          <SimpleGrid cols={{ base: 2, sm: 4, lg: 7 }} spacing="md">
            {swatches.map((s) => (
              <Stack key={s.name} gap={6}>
                <Box h={48} bg={s.hex} style={{ borderRadius: 10, border: `1px solid ${tokens.colors.border}` }} />
                <Text size="sm" fw={600}>
                  {s.name}
                </Text>
                <Text size="xs" c="dimmed" ff="monospace">
                  {s.hex}
                </Text>
              </Stack>
            ))}
          </SimpleGrid>
        </Card>

        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
          <Card>
            <Title order={3} fz={18} mb="md">
              Typography
            </Title>
            <Stack gap="xs">
              <Title order={1}>Manrope heading</Title>
              <Title order={2}>Page title 24px</Title>
              <Text size="lg">Inter body 16px — forms, tables and dense UI.</Text>
              <Text>Inter body 14px — the default UI size.</Text>
              <Text size="xs" c="dimmed">
                Helper text 12px
              </Text>
            </Stack>
          </Card>

          <Card>
            <Title order={3} fz={18} mb="md">
              Buttons
            </Title>
            <Group>
              <Button>Primary button</Button>
              <Button variant="default">Secondary</Button>
              <Button variant="subtle" rightSection={<IconArrowRight size={16} />}>
                Tertiary
              </Button>
            </Group>
          </Card>
        </SimpleGrid>

        <Card>
          <Title order={3} fz={18} mb="md">
            Status badges
          </Title>
          <Group gap="sm">
            {(Object.keys(STATUSES) as StatusKey[]).map((key) => (
              <StatusBadge key={key} status={key} />
            ))}
          </Group>
        </Card>
      </Stack>
    </>
  );
}

function Center({ label, dark, children }: { label: string; dark?: boolean; children: ReactNode }) {
  return (
    <Stack gap={8} align="center">
      <Box
        w="100%"
        h={112}
        display="flex"
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 14,
          border: `1px solid ${tokens.colors.border}`,
          background: dark ? tokens.colors.text : tokens.colors.surface,
        }}
      >
        {children}
      </Box>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
    </Stack>
  );
}
