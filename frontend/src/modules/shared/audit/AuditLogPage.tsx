import { Badge, Button, Code, Drawer, Group, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconDownload, IconSearch } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { EntityStatus } from '@/components/EntityStatus';
import { PageHeader } from '@/components/PageHeader';
import { notifyError } from '@/components/feedback/feedback';
import { QueryError } from '@/components/feedback/QueryState';
import { DataTable } from '@/components/tables/DataTable';
import { auditApi, useAuditLogs, type AuditFilters } from '@/services/api/audit';
import type { AuditLog } from '@/types/api';
import { formatDateTime } from '@/utils/format';

const RESOURCES = ['user', 'membership', 'invitation', 'role', 'organization', 'organization_unit', 'session', 'platform_user', 'platform_admin'];

function Json({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <Stack gap={4}>
      <Text size="sm" fw={600}>
        {label}
      </Text>
      <Code block>{JSON.stringify(value, null, 2)}</Code>
    </Stack>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" style={{ wordBreak: 'break-all' }}>
        {children}
      </Text>
    </Stack>
  );
}

interface AuditLogPageProps {
  scope: 'organization' | 'platform';
  title?: string;
  description?: string;
  /** Fixed filters (e.g. the Security page shows only auth events). */
  preset?: Partial<AuditFilters>;
  /** Render without the page header (embedded in another page). */
  embedded?: boolean;
}

/** Filterable, exportable audit trail. School scope is always limited to the selected school by the API. */
export function AuditLogPage({ scope, title = 'Audit logs', description, preset, embedded }: AuditLogPageProps) {
  const a = auditApi(scope);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState(preset?.action ?? '');
  const [debouncedAction] = useDebouncedValue(action, 300);
  const [resource, setResource] = useState<string | null>(preset?.resource ?? null);
  const [result, setResult] = useState<string | null>(preset?.result || null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const [exporting, setExporting] = useState(false);

  const filters: AuditFilters = {
    page,
    action: debouncedAction || undefined,
    resource: resource ?? undefined,
    result: (result as AuditFilters['result']) ?? undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
  };
  const logs = useAuditLogs(a, filters);
  const reset = () => setPage(1);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await a.export(filters);
    } catch (err) {
      notifyError(err, 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const toolbar = (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="sm">
      <TextInput
        placeholder="Action, e.g. role. or auth.login"
        leftSection={<IconSearch size={16} />}
        value={action}
        onChange={(e) => {
          setAction(e.currentTarget.value);
          reset();
        }}
        aria-label="Filter by action"
        disabled={!!preset?.action}
      />
      <Select placeholder="Any resource" data={RESOURCES} value={resource} onChange={(v) => { setResource(v); reset(); }} clearable aria-label="Filter by resource" />
      <Select placeholder="Any result" data={[{ value: 'success', label: 'Success' }, { value: 'failure', label: 'Failure' }]} value={result} onChange={(v) => { setResult(v); reset(); }} clearable aria-label="Filter by result" />
      <TextInput type="date" value={from} onChange={(e) => { setFrom(e.currentTarget.value); reset(); }} aria-label="From date" />
      <TextInput type="date" value={to} onChange={(e) => { setTo(e.currentTarget.value); reset(); }} aria-label="To date" />
    </SimpleGrid>
  );

  return (
    <>
      {!embedded && (
        <PageHeader
          title={title}
          description={description ?? (scope === 'platform' ? 'Every sensitive action across the platform.' : 'Who changed what in your school, and when.')}
          actions={
            <Button variant="default" leftSection={<IconDownload size={16} />} loading={exporting} onClick={() => void exportCsv()}>
              Export CSV
            </Button>
          }
        />
      )}
      {logs.isError ? (
        <QueryError error={logs.error} onRetry={() => void logs.refetch()} />
      ) : (
        <DataTable
          toolbar={toolbar}
          rows={logs.data?.items ?? []}
          loading={logs.isFetching}
          rowKey={(l) => l.id}
          onRowClick={setSelected}
          empty={{ title: 'No matching events', description: 'Try widening the filters.' }}
          pagination={logs.data && { page, totalPages: logs.data.totalPages, total: logs.data.total, onChange: setPage }}
          columns={[
            { key: 'when', header: 'When', width: 180, render: (l) => <Text size="sm" className="tabular-nums">{formatDateTime(l.createdAt)}</Text> },
            { key: 'action', header: 'Action', render: (l) => <Text size="sm" ff="monospace">{l.action}</Text> },
            { key: 'resource', header: 'Resource', hiddenOnMobile: true, render: (l) => <Badge variant="outline" color="neutral" size="sm">{l.resource}</Badge> },
            { key: 'actor', header: 'Actor', hiddenOnMobile: true, render: (l) => <Text size="xs" ff="monospace" c="dimmed">{l.actorId ?? '—'}</Text> },
            { key: 'result', header: 'Result', render: (l) => <EntityStatus status={l.result} size="sm" /> },
          ]}
        />
      )}

      <Drawer opened={!!selected} onClose={() => setSelected(null)} position="right" size="lg" title="Audit event">
        {selected && (
          <Stack gap="md">
            <Group justify="space-between">
              <Text ff="monospace" fw={600}>
                {selected.action}
              </Text>
              <EntityStatus status={selected.result} />
            </Group>
            <SimpleGrid cols={2} spacing="sm">
              <Field label="When">{formatDateTime(selected.createdAt)}</Field>
              <Field label="Resource">
                {selected.resource}
                {selected.resourceId ? ` · ${selected.resourceId}` : ''}
              </Field>
              <Field label="Actor">{selected.actorId ?? 'None (e.g. unknown account)'}</Field>
              <Field label="Organization">{selected.organizationId ?? 'Platform'}</Field>
              <Field label="IP address">{selected.ipAddress ?? '—'}</Field>
              <Field label="Device">{selected.userAgent ?? '—'}</Field>
            </SimpleGrid>
            <Json label="Before" value={selected.before} />
            <Json label="After" value={selected.after} />
            <Json label="Details" value={selected.metadata} />
          </Stack>
        )}
      </Drawer>
    </>
  );
}
