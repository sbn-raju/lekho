import { Card, EmptyState, Group, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChalkboard, IconUsers } from '@tabler/icons-react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { QueryBoundary } from '@/components/feedback/QueryState';
import { useMySections } from '@/services/api/students';

/** Teacher "My classes" (FRD §13.2): the sections whose students the viewer can see. */
export function MyClassesPage() {
  const sections = useMySections();
  return (
    <>
      <PageHeader title="My classes" description={sections.data?.academicYear ? `Sections you can view in ${sections.data.academicYear.name}.` : 'Sections you can view.'} />
      <QueryBoundary query={sections}>
        {(data) =>
          data.sections.length === 0 ? (
            <Card>
              <EmptyState icon={<IconChalkboard size={28} stroke={1.75} />} title="No classes yet" description="When you're made class teacher of a section, or given access to one, it appears here." py="xl" />
            </Card>
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
              {data.sections.map((s) => (
                <UnstyledButton key={s.id} component={Link} to={`/students?section=${s.id}&class=${s.class?.id ?? ''}&year=${data.academicYear?.id ?? ''}`}>
                  <Card withBorder>
                    <Stack gap={4}>
                      <Text fw={700} size="lg">
                        {s.class?.name} – Section {s.name}
                      </Text>
                      <Text size="sm" c="dimmed">
                        {s.classTeacher ? `Class teacher: ${s.classTeacher.name}` : 'No class teacher'}
                        {s.room ? ` · Room ${s.room}` : ''}
                      </Text>
                      <Group gap={6} mt="xs">
                        <IconUsers size={16} stroke={1.75} />
                        <Text size="sm" className="tabular-nums">
                          {s.studentCount} of {s.capacity} students
                        </Text>
                      </Group>
                    </Stack>
                  </Card>
                </UnstyledButton>
              ))}
            </SimpleGrid>
          )
        }
      </QueryBoundary>
    </>
  );
}
