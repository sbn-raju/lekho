import { Anchor, Badge, Button, Card, Grid, Group, Progress, SimpleGrid, Skeleton, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { BarChart } from '@mantine/charts';
import { IconArmchair, IconCalendarStats, IconChalkboard, IconCircleCheck, IconCircleDashed, IconLayoutGrid, IconUserStar } from '@tabler/icons-react';
import { Link, useNavigate } from 'react-router';
import { EntityStatus } from '@/components/EntityStatus';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { QueryError } from '@/components/feedback/QueryState';
import { DataTable } from '@/components/tables/DataTable';
import { useAccess } from '@/services/api/access';
import { useAcademicsOverview } from '@/services/api/academics';
import type { AcademicsOverview } from '@/types/api';
import { dateRange, plural, useYearParam, withYear, yearStatusKey } from './academic-helpers';
import { YearSelect } from './YearSelect';

const CHECKLIST_LINKS: Record<AcademicsOverview['checklist'][number]['key'], { to: string; label: string }> = {
  academic_year: { to: '/academics/years', label: 'Academic years' },
  current_year: { to: '/academics/years', label: 'Academic years' },
  classes: { to: '/academics/classes', label: 'Add classes' },
  sections: { to: '/academics/classes', label: 'Set up sections' },
  class_teachers: { to: '/academics/classes', label: 'Classes & sections' },
};

/** The academic setup dashboard: what's configured for a year and what's still to do. */
export function AcademicsOverviewPage() {
  const access = useAccess();
  const navigate = useNavigate();
  const [yearParam, setYear] = useYearParam();
  const overview = useAcademicsOverview(yearParam);

  if (overview.isError) return <QueryError error={overview.error} onRetry={() => void overview.refetch()} />;
  const o = overview.data;
  const year = o?.academicYear ?? null;
  const done = o?.checklist.filter((i) => i.done).length ?? 0;
  const total = o?.checklist.length ?? 5;
  const chartData = (o?.byClass ?? []).map((c) => ({ class: c.name, Seats: c.totalCapacity }));

  return (
    <>
      <PageHeader
        title="Academic setup"
        description={year ? `${year.name} · ${dateRange(year.startDate, year.endDate)}${year.termCount ? ` · ${plural(year.termCount, 'term')}` : ''}` : 'Configure academic years, classes, sections and their strength.'}
        actions={
          <>
            {year && <EntityStatus status={yearStatusKey(year.status)} />}
            <YearSelect value={year?.id} onChange={setYear} />
          </>
        }
      />

      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md" mb="lg">
        <StatCard label="Active classes" value={o?.totals.activeClasses} hint={o && o.totals.classes !== o.totals.activeClasses ? `${o.totals.classes} in total` : undefined} icon={IconChalkboard} />
        <StatCard label="Sections" value={o?.totals.sections} hint={year?.name} icon={IconLayoutGrid} color="info" />
        <StatCard label="Total strength" value={o?.totals.totalCapacity} hint={o?.totals.sections ? `About ${o.totals.averageSectionCapacity} seats per section` : 'Seats across sections'} icon={IconArmchair} color="success" />
        <StatCard
          label="Sections without class teacher"
          value={o?.totals.sectionsWithoutClassTeacher}
          icon={IconUserStar}
          color={o?.totals.sectionsWithoutClassTeacher ? 'warning' : 'success'}
        />
      </SimpleGrid>

      <Grid gap="md" mb="lg">
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Card h="100%">
            <Group justify="space-between" mb="xs">
              <Title order={3} fz={18}>
                Setup checklist
              </Title>
              <Text size="sm" c="dimmed" className="tabular-nums">
                {done} of {total}
              </Text>
            </Group>
            <Progress value={(done / total) * 100} color={done === total ? 'success' : 'lekho'} size="sm" mb="md" aria-label="Setup progress" />
            {!o ? (
              <Skeleton h={180} />
            ) : (
              <Stack gap="sm">
                {o.checklist.map((item) => (
                  <Group key={item.key} justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap">
                      <ThemeIcon variant="light" radius="xl" size={28} color={item.done ? 'success' : 'neutral'}>
                        {item.done ? <IconCircleCheck size={18} stroke={1.75} /> : <IconCircleDashed size={18} stroke={1.75} />}
                      </ThemeIcon>
                      <Text size="sm" c={item.done ? 'dimmed' : undefined}>
                        {item.label}
                      </Text>
                    </Group>
                    {!item.done && (
                      <Anchor component={Link} to={withYear(CHECKLIST_LINKS[item.key].to, year?.id)} size="sm">
                        {CHECKLIST_LINKS[item.key].label}
                      </Anchor>
                    )}
                  </Group>
                ))}
              </Stack>
            )}
            {o && o.totals.classesWithoutSections > 0 && (
              <Badge mt="md" variant="light" color="warning">
                {plural(o.totals.classesWithoutSections, 'class has', 'classes have')} no sections in {year?.name ?? 'this year'}
              </Badge>
            )}
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Card h="100%">
            <Group justify="space-between" mb="md">
              <Title order={3} fz={18}>
                Strength by class
              </Title>
              <Text size="sm" c="dimmed">
                Seats in active sections
              </Text>
            </Group>
            {!o ? (
              <Skeleton h={240} />
            ) : chartData.some((d) => d.Seats > 0) ? (
              <BarChart
                h={Math.max(220, Math.min(chartData.length * 28, 420))}
                data={chartData}
                dataKey="class"
                orientation="vertical"
                series={[{ name: 'Seats', color: 'lekho.6' }]}
                gridAxis="x"
                tickLine="none"
                yAxisProps={{ width: 90 }}
                barProps={{ radius: [0, 4, 4, 0] }}
                maxBarWidth={18}
                valueFormatter={(v) => `${v.toLocaleString()} seats`}
                tooltipAnimationDuration={150}
              />
            ) : (
              <Stack align="center" justify="center" h={220} gap="sm">
                <Text c="dimmed" ta="center">
                  {year ? `No sections in ${year.name} yet.` : 'Create an academic year to start adding sections.'}
                </Text>
                {access.canOrg(year ? 'sections.create' : 'academic_years.create') && (
                  <Button component={Link} to={withYear(year ? '/academics/classes' : '/academics/years', year?.id)} variant="light" leftSection={year ? <IconLayoutGrid size={16} /> : <IconCalendarStats size={16} />}>
                    {year ? 'Set up sections' : 'Create an academic year'}
                  </Button>
                )}
              </Stack>
            )}
          </Card>
        </Grid.Col>
      </Grid>

      {o && o.byClass.length > 0 && (
        <DataTable
          rows={o.byClass}
          rowKey={(c) => c.classId}
          onRowClick={(c) => navigate(withYear(`/academics/classes/${c.classId}`, year?.id))}
          columns={[
            { key: 'name', header: 'Class', render: (c) => <Text fw={600}>{c.name}</Text> },
            { key: 'sections', header: 'Sections', numeric: true, render: (c) => c.sectionCount },
            { key: 'seats', header: 'Strength', numeric: true, render: (c) => c.totalCapacity.toLocaleString() },
            {
              key: 'teachers',
              header: 'Class teachers',
              render: (c) =>
                c.sectionCount === 0 ? (
                  <Badge variant="light" color="warning">
                    No sections
                  </Badge>
                ) : c.sectionsWithoutClassTeacher ? (
                  <Text size="sm" c="warning">
                    {c.sectionsWithoutClassTeacher} of {c.sectionCount} missing
                  </Text>
                ) : (
                  <Text size="sm" c="success">
                    All assigned
                  </Text>
                ),
            },
          ]}
        />
      )}
    </>
  );
}
