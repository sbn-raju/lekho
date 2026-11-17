import { Accordion, Badge, Drawer, Group, SegmentedControl, Skeleton, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { QueryError } from '@/components/feedback/QueryState';
import { api } from '@/services/api/client';
import type { Permission, PermissionLevel } from '@/types/api';

function RolesUsing({ permission }: { permission: Permission }) {
  const usage = useQuery({
    queryKey: ['platform', 'permissions', permission.id, 'roles'],
    queryFn: () =>
      api.get<Permission & { roles: { id: string; name: string; organizationId: string | null }[] }>(
        `/platform/permissions/${permission.id}?level=${permission.level}`,
        { withoutOrganization: true },
      ),
  });
  return (
    <Stack gap="md">
      <Stack gap={2}>
        <Text ff="monospace" fw={600}>
          {permission.code}
        </Text>
        <Text c="dimmed" size="sm">
          {permission.description}
        </Text>
      </Stack>
      <Group gap="xs">
        <Badge variant="outline" color="neutral">
          {permission.level}
        </Badge>
        {permission.scopable && <Badge color="info">Can be scoped</Badge>}
      </Group>
      <Text fw={600}>Roles using it</Text>
      {usage.data ? (
        usage.data.roles.length ? (
          usage.data.roles.map((r) => (
            <Group key={r.id} justify="space-between">
              <Text size="sm">{r.name}</Text>
              <Text size="xs" c="dimmed">
                {r.organizationId ? 'School role' : 'Platform role'}
              </Text>
            </Group>
          ))
        ) : (
          <Text size="sm" c="dimmed">
            No custom role uses this permission. School Admins hold every school permission implicitly.
          </Text>
        )
      ) : (
        <Skeleton h={60} />
      )}
    </Stack>
  );
}

/** FRD §14.1 screen 7. The catalog is defined in code; this is a read-only view of it. */
export function PermissionCatalogPage() {
  const [level, setLevel] = useState<PermissionLevel>('platform');
  // Both levels are read through the platform endpoints (`?level=`).
  const catalog = useQuery({
    queryKey: ['platform', 'permissions', 'catalog', level],
    queryFn: () => api.get<Permission[]>(`/platform/permissions?level=${level}`, { withoutOrganization: true }),
  });
  const modules = useQuery({
    queryKey: ['platform', 'permissions', 'modules', level],
    queryFn: () => api.get<{ code: string; name: string; permissionCount: number }[]>(`/platform/permissions/modules?level=${level}`, { withoutOrganization: true }),
  });
  const [selected, setSelected] = useState<Permission | null>(null);

  return (
    <>
      <PageHeader
        title="Permission catalog"
        description="Every permission the backend enforces. Roles can only be built from these; nobody can invent new ones."
        actions={
          <SegmentedControl
            value={level}
            onChange={(v) => setLevel(v as PermissionLevel)}
            data={[
              { value: 'platform', label: 'Platform' },
              { value: 'organization', label: 'School' },
            ]}
          />
        }
      />
      {catalog.isError ? (
        <QueryError error={catalog.error} />
      ) : !catalog.data || !modules.data ? (
        <Skeleton h={320} radius="lg" />
      ) : (
        <Accordion variant="separated" multiple defaultValue={modules.data.map((m) => m.code)}>
          {modules.data.map((m) => (
            <Accordion.Item key={m.code} value={m.code}>
              <Accordion.Control>
                <Group gap="sm">
                  <Text fw={600}>{m.name}</Text>
                  <Badge size="sm" color="neutral" variant="light">
                    {m.permissionCount}
                  </Badge>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Table>
                  <Table.Tbody>
                    {catalog.data
                      .filter((p) => p.module === m.code)
                      .map((p) => (
                        <Table.Tr key={p.id} onClick={() => setSelected(p)} style={{ cursor: 'pointer' }}>
                          <Table.Td w={260}>
                            <Text ff="monospace" size="sm">
                              {p.code}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm" fw={500}>
                              {p.name}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {p.description}
                            </Text>
                          </Table.Td>
                          <Table.Td w={140} ta="right">
                            {p.scopable && (
                              <Badge size="sm" color="info">
                                Can be scoped
                              </Badge>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                  </Table.Tbody>
                </Table>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}
      <Drawer opened={!!selected} onClose={() => setSelected(null)} position="right" title={selected?.name}>
        {selected && <RolesUsing permission={selected} />}
      </Drawer>
    </>
  );
}
