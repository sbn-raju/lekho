import { Alert, Anchor, Button, Card, Checkbox, Group, Select, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { IconDownload, IconEye } from '@tabler/icons-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { errorMessage, notifySuccess } from '@/components/feedback/feedback';
import { useClasses, useSections } from '@/services/api/academics';
import { useSchoolMutation } from '@/services/api/school';
import { studentsApi, useIdCardTemplates, type BulkIdCardsInput } from '@/services/api/students';
import type { BulkIdCardSummary } from '@/types/students';
import { YearSelect } from '@/modules/academics/YearSelect';

/**
 * Bulk ID cards (FRD §8.5): a whole year, a class or a section, printed 9 to an A4 sheet.
 * Only active students by default; students without a photo or placement are listed as skipped.
 */
export function BulkIdCardsPage() {
  const [yearId, setYearId] = useState<string | undefined>();
  const classes = useClasses(yearId);
  const year = classes.data?.academicYear ?? null;
  const sections = useSections(year?.id);
  const templates = useIdCardTemplates();
  const [classId, setClassId] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [summary, setSummary] = useState<BulkIdCardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const input: BulkIdCardsInput = { academicYearId: year?.id, classId: classId ?? undefined, sectionId: sectionId ?? undefined, includeInactive, templateId: templateId ?? undefined };
  const check = useSchoolMutation((body: BulkIdCardsInput) => studentsApi.bulkIdCardsSummary(body));
  const generate = useSchoolMutation((body: BulkIdCardsInput) => studentsApi.bulkIdCards(body));
  const reset = () => {
    setSummary(null);
    setError(null);
  };

  const preview = () => {
    reset();
    check.mutate(input, { onSuccess: setSummary, onError: (e) => setError(errorMessage(e)) });
  };
  const download = () =>
    generate.mutate(input, {
      onSuccess: (headers) => notifySuccess(`${headers.get('X-IdCards-Generated') ?? summary?.eligible ?? ''} ID cards downloaded`),
      onError: (e) => setError(errorMessage(e)),
    });

  return (
    <>
      <PageHeader title="Bulk ID cards" description="Generate ID cards for a class, a section or the whole year as one printable PDF." />
      <Card mb="md">
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
            <YearSelect
              label="Academic year"
              value={year?.id}
              onChange={(v) => {
                setYearId(v ?? undefined);
                setClassId(null);
                setSectionId(null);
                reset();
              }}
              w="100%"
            />
            <Select
              label="Class"
              placeholder="All classes"
              clearable
              data={(classes.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
              value={classId}
              onChange={(v) => {
                setClassId(v);
                setSectionId(null);
                reset();
              }}
            />
            <Select
              label="Section"
              placeholder="All sections"
              clearable
              disabled={!classId}
              data={(sections.data ?? []).filter((x) => x.classId === classId).map((x) => ({ value: x.id, label: `Section ${x.name}` }))}
              value={sectionId}
              onChange={(v) => {
                setSectionId(v);
                reset();
              }}
            />
            <Select
              label="Template"
              data={(templates.data ?? []).map((t) => ({ value: t.id, label: t.isDefault ? `${t.name} · default` : t.name }))}
              value={templateId ?? templates.data?.find((t) => t.isDefault)?.id ?? null}
              onChange={(v) => {
                setTemplateId(v);
                reset();
              }}
              allowDeselect={false}
            />
          </SimpleGrid>
          <Checkbox
            label="Include inactive students"
            description="Withdrawn, transferred and graduated students are never included."
            checked={includeInactive}
            onChange={(e) => {
              setIncludeInactive(e.currentTarget.checked);
              reset();
            }}
          />
          <Group>
            <Button variant="default" leftSection={<IconEye size={16} />} onClick={preview} loading={check.isPending} disabled={!year}>
              Check students
            </Button>
            <Button leftSection={<IconDownload size={16} />} onClick={download} loading={generate.isPending} disabled={!summary || summary.eligible === 0}>
              {summary ? `Download ${summary.eligible} card${summary.eligible === 1 ? '' : 's'}` : 'Download PDF'}
            </Button>
          </Group>
          {error && (
            <Alert color="error" variant="light">
              {error}
            </Alert>
          )}
        </Stack>
      </Card>

      {summary && (
        <Card>
          <Text fw={600} mb="xs">
            {summary.eligible} card{summary.eligible === 1 ? '' : 's'} ready for {summary.academicYear.name}
            {summary.skipped.length ? `; ${summary.skipped.length} student${summary.skipped.length === 1 ? '' : 's'} skipped` : ''}.
          </Text>
          {summary.skipped.length > 0 && (
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Student</Table.Th>
                  <Table.Th>Why skipped</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {summary.skipped.map((k) => (
                  <Table.Tr key={k.studentId}>
                    <Table.Td>
                      <Anchor component={Link} to={`/students/${k.studentId}?tab=${k.reason === 'no_photo' ? 'photo' : 'academic'}`}>
                        {k.name}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>{k.message}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
