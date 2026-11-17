import { useAccess } from '@/services/api/access';
import { rolesApi, useRoles } from '@/services/api/roles';
import { useUnits } from '@/services/api/school';
import type { OrganizationUnit } from '@/types/api';

/** Units in tree order (parents before their children), indented by depth, for Select inputs. */
export function unitOptions(units: OrganizationUnit[], filter: (u: OrganizationUnit) => boolean = () => true) {
  const children = new Map<string | null, OrganizationUnit[]>();
  for (const u of units) children.set(u.parentId, [...(children.get(u.parentId) ?? []), u]);
  const out: { value: string; label: string }[] = [];
  const walk = (parent: string | null) => {
    for (const u of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      if (filter(u)) out.push({ value: u.id, label: `${'— '.repeat(u.depth - 1)}${u.name}` });
      walk(u.id);
    }
  };
  walk(null);
  return out;
}

/** Role and unit names for showing IDs in tables. Fetched only if the user may read them. */
export function useSchoolLookups() {
  const access = useAccess();
  const roles = useRoles(rolesApi('organization'), access.canOrg('roles.read'));
  const units = useUnits(access.canOrg('organization_units.read'));
  const roleName = new Map((roles.data ?? []).map((r) => [r.id, r.name]));
  const unitName = new Map((units.data ?? []).map((u) => [u.id, u.name]));
  return {
    roles: roles.data ?? [],
    units: units.data ?? [],
    roleNames: (ids: string[]) => (roles.data ? ids.map((id) => roleName.get(id) ?? 'Unknown role') : ids.length ? [`${ids.length} role(s)`] : []),
    unitNames: (ids: string[]) => ids.map((id) => unitName.get(id)).filter(Boolean) as string[],
  };
}
