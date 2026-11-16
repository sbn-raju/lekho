import { Button, Group, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { EntityStatus } from '@/components/EntityStatus';
import { PageHeader } from '@/components/PageHeader';
import { QueryError } from '@/components/feedback/QueryState';
import { DataTable } from '@/components/tables/DataTable';
import { useAccess } from '@/services/api/access';
import { useOrganizations } from '@/services/api/platform';
import { formatDate } from '@/utils/format';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'draft', label: 'Draft' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
];

/** FRD §14.1 screen 2. */
export function OrganizationsPage() {
  const navigate = useNavigate();
  const access = useAccess();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const orgs = useOrganizations({ page, status: status || undefined, search: debounced || undefined });

  return (
    <>
      <PageHeader
        title="Organizations"
        description="Every school on Lekho and where it is in onboarding."
        actions={
          access.canPlatform('organizations.create') && (
            <Button component={Link} to="/platform/organizations/new" leftSection={<IconPlus size={16} />}>
              Create organization
            </Button>
          )
        }
      />
      {orgs.isError ? (
        <QueryError error={orgs.error} onRetry={() => void orgs.refetch()} />
      ) : (
        <DataTable
          toolbar={
            <Group justify="space-between" gap="sm">
              <TextInput
                placeholder="Search name, slug, code or email"
                leftSection={<IconSearch size={16} />}
                value={search}
                onChange={(e) => {
                  setSearch(e.currentTarget.value);
                  setPage(1);
                }}
                w={{ base: '100%', sm: 320 }}
                aria-label="Search organizations"
              />
              <SegmentedControl
                size="xs"
                data={FILTERS}
                value={status}
                onChange={(v) => {
                  setParams(v ? { status: v } : {});
                  setPage(1);
                }}
              />
            </Group>
          }
          rows={orgs.data?.items ?? []}
          loading={orgs.isFetching}
          rowKey={(o) => o.id}
          onRowClick={(o) => navigate(`/platform/organizations/${o.id}`)}
          empty={{ title: search || status ? 'No matching organizations' : 'No organizations yet', description: 'Create the first school to start onboarding.' }}
          pagination={orgs.data && { page, totalPages: orgs.data.totalPages, total: orgs.data.total, onChange: setPage }}
          columns={[
            {
              key: 'name',
              header: 'School',
              render: (o) => (
                <Stack gap={0}>
                  <Text fw={600}>{o.name}</Text>
                  <Text size="xs" c="dimmed">
                    {o.slug}
                  </Text>
                </Stack>
              ),
            },
            { key: 'code', header: 'Code', render: (o) => <Text ff="monospace" size="sm">{o.code}</Text> },
            { key: 'contact', header: 'Contact', hiddenOnMobile: true, render: (o) => o.contact.email },
            { key: 'status', header: 'Status', render: (o) => <EntityStatus status={o.status} size="sm" /> },
            { key: 'created', header: 'Created', hiddenOnMobile: true, render: (o) => formatDate(o.createdAt) },
          ]}
        />
      )}
    </>
  );
}
