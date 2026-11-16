import { Alert, Button, Card, Checkbox, Group, MultiSelect, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useState } from 'react';
import type { ScopeInput } from '@/services/api/roles';
import type { OrganizationUnit, Permission, RoleGrant, ScopeType, UnitType } from '@/types/api';

type EditableScope = Exclude<ScopeType, 'platform' | 'custom'>;

const OPTIONS: { type: EditableScope; label: string; help: string; unitType?: UnitType }[] = [
  { type: 'organization', label: 'Entire school', help: 'Every record in the school.' },
  { type: 'department', label: 'Departments', help: 'Pick departments, or leave empty for the holder’s own department.', unitType: 'department' },
  { type: 'class', label: 'Classes', help: 'Pick classes (their sections included), or leave empty for the holder’s own class.', unitType: 'class' },
  { type: 'section', label: 'Sections', help: 'Pick sections, or leave empty for the holder’s own section.', unitType: 'section' },
  { type: 'assigned', label: 'Assigned only', help: 'Records in any unit the holder belongs to.' },
  { type: 'own', label: 'Own records only', help: 'Only the holder’s own record.' },
];

interface Draft {
  types: EditableScope[];
  ids: Partial<Record<EditableScope, string[]>>;
  /** Custom scopes can't be edited here; they're kept as-is. */
  custom: ScopeInput[];
}

function toDraft(grant: RoleGrant): Draft {
  const types: EditableScope[] = [];
  const ids: Draft['ids'] = {};
  const custom: ScopeInput[] = [];
  for (const s of grant.scopes) {
    if (s.type === 'custom') custom.push({ type: 'custom', resourceIds: s.resourceIds });
    else if (s.type !== 'platform') {
      types.push(s.type);
      if (s.resourceIds.length) ids[s.type] = s.resourceIds;
    }
  }
  return { types: types.length || custom.length ? types : ['organization'], ids, custom };
}

function fromDraft(d: Draft): ScopeInput[] {
  if (d.types.includes('organization')) return [{ type: 'organization' }];
  return [...d.types.map((type) => ({ type, ...(d.ids[type]?.length && { resourceIds: d.ids[type] }) })), ...d.custom];
}

interface ScopeBuilderProps {
  grants: RoleGrant[];
  catalog: Permission[];
  units: OrganizationUnit[];
  readOnly?: boolean;
  saving?: boolean;
  onSave: (entries: { permission: string; scopes: ScopeInput[] }[]) => void;
}

/**
 * Scope builder (FRD §14.2 screen 6). Permissions say *what* a role can do; scopes say *where*.
 * Scopes add up: "Classes: Grade 10" + "Own records" covers both.
 */
export function ScopeBuilder({ grants, catalog, units, readOnly, saving, onSave }: ScopeBuilderProps) {
  const scopable = new Set(catalog.filter((p) => p.scopable).map((p) => p.code));
  const editable = grants.filter((g) => scopable.has(g.code));
  const fixed = grants.filter((g) => !scopable.has(g.code));
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(editable.map((g) => [g.code, toDraft(g)])));
  const [dirty, setDirty] = useState(false);

  const update = (code: string, next: Draft) => {
    setDrafts((d) => ({ ...d, [code]: next }));
    setDirty(true);
  };
  const invalid = editable.filter((g) => {
    const d = drafts[g.code];
    return !d || (d.types.length === 0 && d.custom.length === 0);
  });

  if (editable.length === 0) {
    return (
      <Alert color="info" icon={<IconInfoCircle size={18} />}>
        None of this role's permissions can be limited to part of the school. Add permissions such as “View users” to set scopes.
      </Alert>
    );
  }

  return (
    <Stack gap="md">
      {editable.map((g) => {
        const d = drafts[g.code]!;
        const whole = d.types.includes('organization');
        return (
          <Card key={g.code}>
            <Stack gap="sm">
              <Group justify="space-between">
                <Stack gap={0}>
                  <Title order={4} fz={16}>
                    {g.name}
                  </Title>
                  <Text size="xs" c="dimmed" ff="monospace">
                    {g.code}
                  </Text>
                </Stack>
              </Group>
              <Checkbox.Group
                value={d.types}
                onChange={(v) => update(g.code, { ...d, types: v as EditableScope[] })}
                error={d.types.length === 0 && d.custom.length === 0 ? 'Choose at least one scope' : undefined}
              >
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm" mt={4}>
                  {OPTIONS.map((o) => (
                    <Checkbox
                      key={o.type}
                      value={o.type}
                      label={o.label}
                      description={o.help}
                      disabled={readOnly || (whole && o.type !== 'organization')}
                    />
                  ))}
                </SimpleGrid>
              </Checkbox.Group>
              {!whole &&
                OPTIONS.filter((o) => o.unitType && d.types.includes(o.type)).map((o) => (
                  <MultiSelect
                    key={o.type}
                    label={`${o.label}`}
                    placeholder={d.ids[o.type]?.length ? undefined : 'The holder’s own'}
                    data={units.filter((u) => u.type === o.unitType).map((u) => ({ value: u.id, label: u.name }))}
                    value={d.ids[o.type] ?? []}
                    onChange={(v) => update(g.code, { ...d, ids: { ...d.ids, [o.type]: v } })}
                    searchable
                    clearable
                    disabled={readOnly}
                    nothingFoundMessage={`No ${o.unitType}s yet — add them under Hierarchy`}
                  />
                ))}
              {d.custom.length > 0 && (
                <Text size="sm" c="dimmed">
                  Also limited to {d.custom.reduce((n, c) => n + (c.resourceIds?.length ?? 0), 0)} specific record(s) (set via the API).
                </Text>
              )}
            </Stack>
          </Card>
        );
      })}

      {fixed.length > 0 && (
        <Text size="sm" c="dimmed">
          Always school-wide: {fixed.map((g) => g.name).join(', ')}.
        </Text>
      )}

      {!readOnly && (
        <Group justify="flex-end">
          <Button
            variant="default"
            disabled={!dirty}
            onClick={() => {
              setDrafts(Object.fromEntries(editable.map((g) => [g.code, toDraft(g)])));
              setDirty(false);
            }}
          >
            Discard changes
          </Button>
          <Button
            disabled={!dirty || invalid.length > 0}
            loading={saving}
            onClick={() => onSave(editable.map((g) => ({ permission: g.code, scopes: fromDraft(drafts[g.code]!) })))}
          >
            Save scopes
          </Button>
        </Group>
      )}
    </Stack>
  );
}
