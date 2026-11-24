import { Alert, Button, Card, Group, List, Select, Skeleton, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconDownload } from '@tabler/icons-react';
import { useState } from 'react';
import { notifyError, notifySuccess } from '@/components/feedback/feedback';
import { QueryError } from '@/components/feedback/QueryState';
import { useSchoolMutation } from '@/services/api/school';
import { studentsApi, useIdCardPreview, useIdCardTemplates } from '@/services/api/students';
import type { StudentProfile } from '@/types/students';
import { formatDateTime } from '@/utils/format';
import { IdCardView } from './IdCardView';

/** ID card preview and download for one student (FRD §8.4). */
export function IdCardPanel({ studentId, history }: { studentId: string; history: StudentProfile['idCards'] }) {
  const templates = useIdCardTemplates();
  const [templateId, setTemplateId] = useState<string | undefined>();
  const preview = useIdCardPreview(studentId, templateId);
  const generate = useSchoolMutation(() => studentsApi.generateIdCard(studentId, templateId));
  const p = preview.data;

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Select
          label="Template"
          w={240}
          data={(templates.data ?? []).map((t) => ({ value: t.id, label: t.isDefault ? `${t.name} · default` : t.name }))}
          value={templateId ?? p?.template.id ?? null}
          onChange={(v) => setTemplateId(v ?? undefined)}
          allowDeselect={false}
        />
        <Button
          leftSection={<IconDownload size={16} />}
          disabled={!p?.eligible}
          loading={generate.isPending}
          onClick={() => generate.mutate(undefined, { onSuccess: () => notifySuccess('ID card downloaded'), onError: (e) => notifyError(e) })}
        >
          Download PDF
        </Button>
      </Group>
      {preview.isError ? (
        <QueryError error={preview.error} onRetry={() => void preview.refetch()} />
      ) : !p ? (
        <Skeleton h={400} w={250} radius="md" />
      ) : (
        <>
          {!p.eligible && (
            <Alert color="warning" variant="light" icon={<IconAlertTriangle size={18} />} title="An ID card can't be generated yet">
              <List size="sm">
                {p.problems.map((x) => (
                  <List.Item key={x.reason}>{x.message}</List.Item>
                ))}
              </List>
            </Alert>
          )}
          {p.card && (
            <Card>
              <IdCardView template={p.template} school={p.school} card={p.card} />
            </Card>
          )}
        </>
      )}
      {history.length > 0 && (
        <Text size="sm" c="dimmed">
          Generated {history.length === 10 ? '10+' : history.length} time{history.length === 1 ? '' : 's'}; last {formatDateTime(history[0]!.generatedAt)} (version {history[0]!.version}).
        </Text>
      )}
    </Stack>
  );
}
