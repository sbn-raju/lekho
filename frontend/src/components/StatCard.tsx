import { Card, Group, Skeleton, Stack, Text, ThemeIcon, type MantineColor } from '@mantine/core';
import type { Icon } from '@tabler/icons-react';
import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: number | string | undefined;
  hint?: ReactNode;
  icon: Icon;
  color?: MantineColor;
}

/** Dashboard tile: label, large tabular number, optional hint and icon. */
export function StatCard({ label, value, hint, icon: IconComponent, color = 'lekho' }: StatCardProps) {
  return (
    <Card>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={4}>
          <Text size="sm" c="dimmed" fw={500}>
            {label}
          </Text>
          {value === undefined ? (
            <Skeleton h={32} w={64} />
          ) : (
            // Words ("2 hours ago") read better smaller than counts.
            <Text fz={typeof value === 'string' ? 20 : 26} fw={700} ff="heading" className="tabular-nums" lh={1.25}>
              {value}
            </Text>
          )}
          {hint && (
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          )}
        </Stack>
        <ThemeIcon variant="light" color={color} size={40} radius="md">
          <IconComponent size={22} stroke={1.75} />
        </ThemeIcon>
      </Group>
    </Card>
  );
}
