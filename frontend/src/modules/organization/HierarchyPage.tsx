import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Grid,
  Group,
  Menu,
  Modal,
  Select,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
  Tree,
  UnstyledButton,
  getTreeExpandedState,
  useTree,
  type TreeNodeData,
} from '@mantine/core';
import { hasLength, matches, useForm } from '@mantine/form';
import { IconChevronDown, IconChevronRight, IconCrown, IconDots, IconHierarchy2, IconPlus, IconUserPlus } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EntityStatus } from '@/components/EntityStatus';
import { PageHeader } from '@/components/PageHeader';
import { confirmAction, notifyError, notifySuccess } from '@/components/feedback/feedback';
import { QueryError } from '@/components/feedback/QueryState';
import { MemberSelect } from '@/components/forms/MemberSelect';
import { DataTable } from '@/components/tables/DataTable';
import { useAccess } from '@/services/api/access';
import { ApiError } from '@/services/api/client';
import { schoolApi, useSchoolMutation, useUnit, useUnitMembers, useUnitTree, useUnits } from '@/services/api/school';
import type { OrganizationUnit, UnitDetail, UnitTreeNode, UnitType } from '@/types/api';
import { fullName, humanize } from '@/utils/format';
import { unitOptions } from './useSchoolLookups';

const TYPES: { value: UnitType; label: string }[] = [
  { value: 'department', label: 'Department' },
  { value: 'academic', label: 'Academic group' },
  { value: 'administration', label: 'Administration' },
  { value: 'class', label: 'Class' },
  { value: 'section', label: 'Section (inside a class)' },
  { value: 'custom', label: 'Other' },
];

const TYPE_COLOR: Record<UnitType, string> = {
  department: 'lekho',
  academic: 'info',
  administration: 'neutral',
  class: 'success',
  section: 'success',
  custom: 'draft',
};

function toTreeData(nodes: UnitTreeNode[]): TreeNodeData[] {
  return nodes.map((n) => ({ value: n.id, label: n.name, nodeProps: { node: n }, children: toTreeData(n.children) }));
}

function UnitFormModal({
  title,
  parent,
  unit,
  onClose,
  onSaved,
}: {
  title: string;
  parent?: OrganizationUnit | null;
  unit?: UnitDetail;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const save = useSchoolMutation((v: { name: string; code: string; type: UnitType; description: string }) =>
    unit
      ? schoolApi.updateUnit(unit.id, { name: v.name, code: v.code, description: v.description || null })
      : schoolApi.createUnit({ ...v, description: v.description || undefined, parentId: parent?.id ?? null }),
  );
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: {
      name: unit?.name ?? '',
      code: unit?.code ?? '',
      type: (unit?.type ?? (parent?.type === 'class' ? 'section' : 'department')) as UnitType,
      description: unit?.description ?? '',
    },
    validate: {
      name: hasLength({ min: 1, max: 150 }, 'Required'),
      code: matches(/^[A-Za-z0-9_-]{1,40}$/, 'Letters, digits, hyphens or underscores'),
    },
  });
  const submit = async (v: typeof form.values) => {
    try {
      const saved = await save.mutateAsync({ ...v, code: v.code.toUpperCase() });
      notifySuccess(unit ? 'Unit updated' : `${v.name} created`);
      onSaved?.(saved.id);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') form.setFieldError('code', 'This code is already used in your school');
      else notifyError(err);
    }
  };
  return (
    <Modal opened onClose={onClose} title={title}>
      <form onSubmit={form.onSubmit(submit)} noValidate>
        <Stack gap="md">
          {parent && (
            <Text size="sm" c="dimmed">
              Inside {parent.name}
            </Text>
          )}
          <TextInput label="Name" placeholder="Mathematics" withAsterisk data-autofocus key={form.key('name')} {...form.getInputProps('name')} />
          <TextInput label="Code" placeholder="MATH" description="Unique in your school." withAsterisk key={form.key('code')} {...form.getInputProps('code')} />
          {!unit && <Select label="Type" data={TYPES} allowDeselect={false} key={form.key('type')} {...form.getInputProps('type')} />}
          <Textarea label="Description" autosize minRows={2} key={form.key('description')} {...form.getInputProps('description')} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.submitting}>
              {unit ? 'Save' : 'Create'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function MoveModal({ unit, units, onClose }: { unit: UnitDetail; units: OrganizationUnit[]; onClose: () => void }) {
  const [parentId, setParentId] = useState<string | null>(unit.parentId ?? 'root');
  const move = useSchoolMutation((p: string | null) => schoolApi.updateUnit(unit.id, { parentId: p }));
  // Not itself or anything inside it; sections can't hold units.
  const options = unitOptions(units, (u) => u.id !== unit.id && !u.ancestorIds.includes(unit.id) && u.type !== 'section');
  return (
    <Modal opened onClose={onClose} title={`Move ${unit.name}`}>
      <Stack gap="md">
        <Select label="New parent" data={[{ value: 'root', label: 'Top level' }, ...options]} value={parentId} onChange={setParentId} searchable allowDeselect={false} />
        <Text size="sm" c="dimmed">
          Everything inside {unit.name} moves with it.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={move.isPending}
            onClick={() =>
              move.mutate(parentId === 'root' ? null : parentId, {
                onSuccess: () => {
                  notifySuccess('Unit moved');
                  onClose();
                },
                onError: (e) => notifyError(e),
              })
            }
          >
            Move
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function UnitPanel({ id, units, onDeleted, onCreated }: { id: string; units: OrganizationUnit[]; onDeleted: () => void; onCreated: (id: string) => void }) {
  const access = useAccess();
  const unit = useUnit(id);
  const [page, setPage] = useState(1);
  const members = useUnitMembers(id, page);
  const [modal, setModal] = useState<'edit' | 'child' | 'move' | null>(null);
  const [newMember, setNewMember] = useState<string | null>(null);
  const [asHead, setAsHead] = useState(false);
  const setStatus = useSchoolMutation((status: 'active' | 'inactive') => schoolApi.updateUnit(id, { status }));
  const remove = useSchoolMutation(() => schoolApi.deleteUnit(id));
  const addMember = useSchoolMutation((v: { userId: string; head: boolean }) => schoolApi.addUnitMember(id, v.userId, v.head));
  const removeMember = useSchoolMutation((userId: string) => schoolApi.removeUnitMember(id, userId));

  if (unit.isError) return <QueryError error={unit.error} />;
  if (!unit.data) return <Skeleton h={360} radius="lg" />;
  const u = unit.data;
  const canUpdate = access.canOrg('organization_units.update');
  const canAssign = access.canOrg('organization_units.assign');

  const del = () =>
    confirmAction({
      title: `Delete ${u.name}?`,
      message: 'Only empty units can be deleted: no sub-units, no members, and not used by any role scope.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await remove.mutateAsync(undefined);
          onDeleted();
        } catch (err) {
          const d = err instanceof ApiError ? (err.details as { childUnits?: number; members?: number; rolesReferencing?: number }) : undefined;
          if (d && (d.childUnits || d.members || d.rolesReferencing)) {
            throw new Error(
              `Still in use: ${[d.childUnits && `${d.childUnits} sub-unit(s)`, d.members && `${d.members} member(s)`, d.rolesReferencing && `${d.rolesReferencing} role scope(s)`].filter(Boolean).join(', ')}.`,
              { cause: err },
            );
          }
          throw err;
        }
      },
      successMessage: 'Unit deleted',
    });

  return (
    <Stack gap="md">
      <Card>
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Group gap="sm">
              <Title order={2} fz={22}>
                {u.name}
              </Title>
              <Badge color={TYPE_COLOR[u.type]} variant="light">
                {humanize(u.type)}
              </Badge>
              {u.status !== 'active' && <EntityStatus status={u.status} size="sm" />}
            </Group>
            <Text size="sm" c="dimmed" ff="monospace">
              {u.code}
            </Text>
            {u.description && <Text size="sm">{u.description}</Text>}
            <Text size="sm" c="dimmed">
              {u.memberCount} member{u.memberCount === 1 ? '' : 's'} · {u.childCount} sub-unit{u.childCount === 1 ? '' : 's'}
              {u.heads.length > 0 && ` · Led by ${u.heads.map((h) => h.name).join(', ')}`}
            </Text>
          </Stack>
          <Group gap="xs">
            {access.canOrg('organization_units.create') && u.type !== 'section' && (
              <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => setModal('child')}>
                Add inside
              </Button>
            )}
            {(canUpdate || access.canOrg('organization_units.delete')) && (
              <Menu position="bottom-end" shadow="md">
                <Menu.Target>
                  <Button size="xs" variant="default" aria-label="Unit actions">
                    <IconDots size={16} />
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  {canUpdate && <Menu.Item onClick={() => setModal('edit')}>Edit</Menu.Item>}
                  {canUpdate && <Menu.Item onClick={() => setModal('move')}>Move</Menu.Item>}
                  {canUpdate && (
                    <Menu.Item
                      onClick={() =>
                        confirmAction({
                          title: u.status === 'active' ? `Deactivate ${u.name}?` : `Activate ${u.name}?`,
                          message:
                            u.status === 'active'
                              ? 'Access scoped to this unit (and everything inside it) stops working until it is reactivated.'
                              : 'Scoped access to this unit works again.',
                          confirmLabel: u.status === 'active' ? 'Deactivate' : 'Activate',
                          destructive: u.status === 'active',
                          onConfirm: () => setStatus.mutateAsync(u.status === 'active' ? 'inactive' : 'active'),
                          successMessage: 'Unit updated',
                        })
                      }
                    >
                      {u.status === 'active' ? 'Deactivate' : 'Activate'}
                    </Menu.Item>
                  )}
                  {access.canOrg('organization_units.delete') && (
                    <>
                      <Menu.Divider />
                      <Menu.Item color="error" onClick={del}>
                        Delete
                      </Menu.Item>
                    </>
                  )}
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        </Group>
      </Card>

      {canAssign && u.status === 'active' && (
        <Card>
          <Text fw={600} mb="sm">
            Add a member
          </Text>
          <Group align="flex-end" gap="sm">
            <MemberSelect value={newMember} onChange={setNewMember} flex={1} aria-label="Member to add" />
            <Checkbox label="Unit head" checked={asHead} onChange={(e) => setAsHead(e.currentTarget.checked)} mb={8} />
            <Button
              leftSection={<IconUserPlus size={16} />}
              disabled={!newMember}
              loading={addMember.isPending}
              onClick={() =>
                newMember &&
                addMember.mutate(
                  { userId: newMember, head: asHead },
                  {
                    onSuccess: () => {
                      setNewMember(null);
                      setAsHead(false);
                      notifySuccess('Member added');
                    },
                    onError: (e) => notifyError(e),
                  },
                )
              }
            >
              Add
            </Button>
          </Group>
          <Text size="xs" c="dimmed" mt="xs">
            Heads are shown for reference; what anyone can do here comes from their role and its scopes.
          </Text>
        </Card>
      )}

      <DataTable
        rows={members.data?.items ?? []}
        loading={members.isFetching}
        rowKey={(m) => m.id}
        empty={{ title: 'No members in this unit', description: canAssign ? 'Add people above.' : undefined }}
        pagination={members.data && { page, totalPages: members.data.totalPages, total: members.data.total, onChange: setPage }}
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (m) => (
              <Group gap={6} wrap="nowrap">
                <Text fw={500}>{fullName(m)}</Text>
                {m.isHead && (
                  <Badge size="sm" color="warning" leftSection={<IconCrown size={12} />}>
                    Head
                  </Badge>
                )}
              </Group>
            ),
          },
          { key: 'email', header: 'Email', hiddenOnMobile: true, render: (m) => m.email },
          {
            key: 'actions',
            header: '',
            render: (m) =>
              canAssign && (
                <Group gap={4} justify="flex-end" wrap="nowrap">
                  <Button size="xs" variant="subtle" onClick={() => addMember.mutate({ userId: m.id, head: !m.isHead }, { onError: (e) => notifyError(e) })}>
                    {m.isHead ? 'Unset head' : 'Make head'}
                  </Button>
                  <Button size="xs" variant="subtle" color="error" onClick={() => removeMember.mutate(m.id, { onSuccess: () => notifySuccess('Removed from unit'), onError: (e) => notifyError(e) })}>
                    Remove
                  </Button>
                </Group>
              ),
          },
        ]}
      />

      {modal === 'edit' && <UnitFormModal title="Edit unit" unit={u} onClose={() => setModal(null)} />}
      {modal === 'child' && <UnitFormModal title="Add unit" parent={u} onClose={() => setModal(null)} onSaved={onCreated} />}
      {modal === 'move' && <MoveModal unit={u} units={units} onClose={() => setModal(null)} />}
    </Stack>
  );
}

/** FRD §14.2 screen 7: tree view, create, edit, move, members and heads. */
export function HierarchyPage() {
  const access = useAccess();
  const tree = useUnitTree();
  const units = useUnits();
  const [chosen, setSelected] = useState<string | null>(null);
  const [creatingRoot, setCreatingRoot] = useState(false);
  // Until the user picks a unit, show the first one.
  const selected = chosen ?? tree.data?.[0]?.id ?? null;
  const controller = useTree();
  // Stable reference: Tree re-initializes whenever `data` changes identity.
  const data = useMemo(() => toTreeData(tree.data ?? []), [tree.data]);

  // Open everything on first load, then keep the selected unit's ancestors open (e.g. a new section).
  const expandedOnce = useRef(false);
  useEffect(() => {
    if (!tree.data || expandedOnce.current) return;
    // Computed from the data directly: the controller hasn't received it yet in this commit.
    controller.setExpandedState(getTreeExpandedState(data, '*'));
    expandedOnce.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when data first arrives
  }, [data]);
  const selectedAncestors = units.data?.find((u) => u.id === selected)?.ancestorIds.join(',');
  useEffect(() => {
    for (const id of selectedAncestors?.split(',').filter(Boolean) ?? []) controller.expand(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- controller identity is stable enough; key on ancestors
  }, [selectedAncestors, data]);


  return (
    <>
      <PageHeader
        title="Hierarchy"
        description="Departments, classes and sections. Roles can be scoped to any part of this tree."
        actions={
          access.canOrg('organization_units.create') && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setCreatingRoot(true)}>
              Add top-level unit
            </Button>
          )
        }
      />
      {tree.isError ? (
        <QueryError error={tree.error} onRetry={() => void tree.refetch()} />
      ) : !tree.data ? (
        <Skeleton h={360} radius="lg" />
      ) : tree.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconHierarchy2 size={28} stroke={1.75} />}
            title="No departments or classes yet"
            description="Build your school's structure: departments for staff, classes and sections for students."
            py="xl"
          >
            {access.canOrg('organization_units.create') && (
              <EmptyState.Actions>
                <Button onClick={() => setCreatingRoot(true)}>Add the first unit</Button>
              </EmptyState.Actions>
            )}
          </EmptyState>
        </Card>
      ) : (
        <Grid gap="md">
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Card p="sm">
              <Tree
                data={data}
                tree={controller}
                levelOffset="md"
                expandOnClick={false}
                renderNode={({ node, expanded, hasChildren, elementProps }) => {
                  const n = node.nodeProps!.node as UnitTreeNode;
                  return (
                    <Group gap={4} wrap="nowrap" {...elementProps} py={4} style={{ ...elementProps.style, borderRadius: 8, background: selected === n.id ? 'var(--lekho-primary-tint)' : undefined }}>
                      <UnstyledButton
                        aria-label={expanded ? `Collapse ${n.name}` : `Expand ${n.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          controller.toggleExpanded(n.id);
                        }}
                        style={{ visibility: hasChildren ? 'visible' : 'hidden', display: 'flex' }}
                      >
                        {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                      </UnstyledButton>
                      <UnstyledButton onClick={() => setSelected(n.id)} style={{ flex: 1, minWidth: 0 }}>
                        <Group gap={6} wrap="nowrap" justify="space-between">
                          <Text size="sm" fw={selected === n.id ? 600 : 400} c={n.status === 'active' ? undefined : 'dimmed'} truncate>
                            {n.name}
                          </Text>
                          <Badge size="xs" variant="light" color={TYPE_COLOR[n.type]}>
                            {n.memberCount}
                          </Badge>
                        </Group>
                      </UnstyledButton>
                    </Group>
                  );
                }}
              />
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 8 }}>
            {selected && <UnitPanel key={selected} id={selected} units={units.data ?? []} onDeleted={() => setSelected(null)} onCreated={setSelected} />}
          </Grid.Col>
        </Grid>
      )}
      {creatingRoot && <UnitFormModal title="Add top-level unit" parent={null} onClose={() => setCreatingRoot(false)} onSaved={setSelected} />}
    </>
  );
}
