import { Button, Card, Grid, Group, SimpleGrid, Stack, Table, Text, ThemeIcon, Title } from '@mantine/core';
import { IconPlus, IconSpeakerphone } from '@tabler/icons-react';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { recentFees, stats, upcoming } from '@/features/dashboard/sample-data';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Academic year 2026–27 · Overview of school operations and learning."
        actions={
          <>
            <Button variant="default" leftSection={<IconSpeakerphone size={16} />}>
              New announcement
            </Button>
            <Button leftSection={<IconPlus size={16} />}>Add student</Button>
          </>
        }
      />

      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md" mb="lg">
        {stats.map(({ label, value, hint, icon: Icon, color }) => (
          <Card key={label}>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={4}>
                <Text size="sm" c="dimmed" fw={500}>
                  {label}
                </Text>
                <Text fz={26} fw={700} ff="heading" className="tabular-nums">
                  {value}
                </Text>
                <Text size="xs" c="dimmed">
                  {hint}
                </Text>
              </Stack>
              <ThemeIcon variant="light" color={color} size={40} radius="md">
                <Icon size={22} stroke={1.75} />
              </ThemeIcon>
            </Group>
          </Card>
        ))}
      </SimpleGrid>

      <Grid gap="md">
        <Grid.Col span={{ base: 12, lg: 8 }}>
        <Card h="100%">
          <Group justify="space-between" mb="md">
            <Title order={3} fz={18}>
              Recent fee activity
            </Title>
            <Button variant="subtle" size="compact-sm">
              View all
            </Button>
          </Group>
          <Table.ScrollContainer minWidth={560}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Student</Table.Th>
                  <Table.Th>Due date</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {recentFees.map((row) => (
                  <Table.Tr key={row.student}>
                    <Table.Td>
                      <Text fw={500} size="sm">
                        {row.student}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {row.grade}
                      </Text>
                    </Table.Td>
                    <Table.Td>{row.due}</Table.Td>
                    <Table.Td ta="right" className="tabular-nums">
                      {inr.format(row.amount)}
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge status={row.status} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 4 }}>
        <Card h="100%">
          <Title order={3} fz={18} mb="md">
            Upcoming assignments
          </Title>
          <Stack gap="sm">
            {upcoming.map((item) => (
              <Group key={item.title} justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Text size="sm" fw={500} truncate>
                    {item.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {item.course} · Due {item.due}
                  </Text>
                </Stack>
                <StatusBadge status={item.status} />
              </Group>
            ))}
          </Stack>
        </Card>
        </Grid.Col>
      </Grid>
    </>
  );
}
