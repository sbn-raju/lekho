import { Badge, Checkbox, Paper, ScrollArea, Table, Text, Tooltip } from '@mantine/core';
import type { Permission, PermissionModule } from '@/types/api';
import { humanize } from '@/utils/format';

/** Column order for actions; anything else is appended alphabetically. */
const ACTION_ORDER = ['read', 'list', 'create', 'update', 'delete', 'assign', 'manage', 'approve', 'publish', 'export', 'import', 'archive', 'reject'];

interface MatrixProps {
  catalog: Permission[];
  modules: PermissionModule[];
  selected: Set<string>;
  onToggle?: (code: string, checked: boolean) => void;
  /** Read-only display (protected role, or no permission to edit). */
  readOnly?: boolean;
  /** Every box is ticked and locked (School Admin / Super Admin). */
  allGranted?: boolean;
  /** Codes granted for only part of the school (department, class, own…); marked "Limited". */
  narrowed?: Set<string>;
}

/**
 * Role permission builder (FRD §14.2 screen 5): one row per resource, one column per action.
 * Only actions that exist in the catalog get a checkbox, so nothing unenforceable can be granted.
 */
export function PermissionMatrix({ catalog, modules, selected, onToggle, readOnly, allGranted, narrowed }: MatrixProps) {
  const actions = [...new Set(catalog.map((p) => p.action))].sort((a, b) => {
    const ia = ACTION_ORDER.indexOf(a);
    const ib = ACTION_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  const moduleOrder = modules.map((m) => m.code);
  const byModule = new Map<string, Map<string, Map<string, Permission>>>();
  for (const p of catalog) {
    const resources = byModule.get(p.module) ?? new Map();
    const row = resources.get(p.resource) ?? new Map();
    row.set(p.action, p);
    resources.set(p.resource, row);
    byModule.set(p.module, resources);
  }
  const moduleName = (code: string) => modules.find((m) => m.code === code)?.name ?? humanize(code);
  const orderedModules = [...byModule.keys()].sort((a, b) => (moduleOrder.indexOf(a) + 1 || 99) - (moduleOrder.indexOf(b) + 1 || 99));

  return (
    <Paper withBorder>
      <ScrollArea>
        <Table miw={720} highlightOnHover={false}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Resource</Table.Th>
              {actions.map((a) => (
                <Table.Th key={a} ta="center">
                  {humanize(a)}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {orderedModules.map((mod) => (
              <ModuleRows
                key={mod}
                name={moduleName(mod)}
                resources={byModule.get(mod)!}
                actions={actions}
                selected={selected}
                onToggle={onToggle}
                disabled={readOnly || allGranted}
                allGranted={allGranted}
                narrowed={narrowed}
              />
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );
}

function ModuleRows({
  name,
  resources,
  actions,
  selected,
  onToggle,
  disabled,
  allGranted,
  narrowed,
}: {
  name: string;
  resources: Map<string, Map<string, Permission>>;
  actions: string[];
  selected: Set<string>;
  onToggle?: (code: string, checked: boolean) => void;
  disabled?: boolean;
  allGranted?: boolean;
  narrowed?: Set<string>;
}) {
  return (
    <>
      <Table.Tr bg="var(--lekho-background)">
        <Table.Td colSpan={actions.length + 1}>
          <Text size="sm" fw={600}>
            {name}
          </Text>
        </Table.Td>
      </Table.Tr>
      {[...resources].map(([resource, row]) => (
        <Table.Tr key={resource}>
          <Table.Td>
            <Text size="md">{humanize(resource)}</Text>
          </Table.Td>
          {actions.map((action) => {
            const p = row.get(action);
            if (!p) {
              return (
                <Table.Td key={action} ta="center" c="dimmed">
                  —
                </Table.Td>
              );
            }
            return (
              <Table.Td key={action} ta="center">
                <Tooltip label={p.description ?? p.name} withArrow multiline maw={260}>
                  <Checkbox
                    aria-label={p.name}
                    display="inline-block"
                    checked={allGranted || selected.has(p.code)}
                    disabled={disabled}
                    onChange={(e) => onToggle?.(p.code, e.currentTarget.checked)}
                  />
                </Tooltip>
                {!allGranted && selected.has(p.code) && narrowed?.has(p.code) && (
                  <Badge size="xs" variant="outline" color="neutral" ml={4} display="inline-block">
                    Limited
                  </Badge>
                )}
              </Table.Td>
            );
          })}
        </Table.Tr>
      ))}
    </>
  );
}
