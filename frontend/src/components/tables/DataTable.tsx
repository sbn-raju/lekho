import { Box, Card, EmptyState, Group, LoadingOverlay, Pagination, ScrollArea, Table, Text } from '@mantine/core';
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Right-align numeric columns (brand guideline: aligned numeric values). */
  numeric?: boolean;
  width?: number | string;
  /** Hide on narrow screens. */
  hiddenOnMobile?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: { title: string; description?: ReactNode; action?: ReactNode };
  pagination?: { page: number; totalPages: number; total: number; onChange: (page: number) => void };
  /** Filters or actions shown above the table, inside the card. */
  toolbar?: ReactNode;
}

/** Card-wrapped table with optional toolbar, row click, empty state and pagination. */
export function DataTable<T>({ columns, rows, rowKey, onRowClick, loading, empty, pagination, toolbar }: DataTableProps<T>) {
  return (
    <Card p={0}>
      {toolbar && (
        <Box p="md" style={{ borderBottom: '1px solid var(--lekho-border)' }}>
          {toolbar}
        </Box>
      )}
      <Box pos="relative">
        <LoadingOverlay visible={!!loading && rows.length > 0} overlayProps={{ blur: 1 }} loaderProps={{ size: 'sm' }} />
        {rows.length === 0 && !loading ? (
          <EmptyState title={empty?.title ?? 'Nothing here yet'} description={empty?.description} py="xl">
            {empty?.action && <EmptyState.Actions>{empty.action}</EmptyState.Actions>}
          </EmptyState>
        ) : (
          <ScrollArea>
            <Table miw={600}>
              <Table.Thead>
                <Table.Tr>
                  {columns.map((c) => (
                    <Table.Th key={c.key} w={c.width} ta={c.numeric ? 'right' : undefined} visibleFrom={c.hiddenOnMobile ? 'sm' : undefined}>
                      {c.header}
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => (
                  <Table.Tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    style={onRowClick ? { cursor: 'pointer' } : undefined}
                  >
                    {columns.map((c) => (
                      <Table.Td key={c.key} ta={c.numeric ? 'right' : undefined} className={c.numeric ? 'tabular-nums' : undefined} visibleFrom={c.hiddenOnMobile ? 'sm' : undefined}>
                        {c.render(row)}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Box>
      {pagination && pagination.totalPages > 1 && (
        <Group justify="space-between" p="md" style={{ borderTop: '1px solid var(--lekho-border)' }}>
          <Text size="sm" c="dimmed" className="tabular-nums">
            {pagination.total} total
          </Text>
          <Pagination value={pagination.page} total={pagination.totalPages} onChange={pagination.onChange} size="sm" />
        </Group>
      )}
    </Card>
  );
}
