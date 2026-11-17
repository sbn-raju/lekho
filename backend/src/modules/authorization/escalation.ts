import { ApiError } from '../../common/errors/ApiError.js';
import { grantedCodes, hasPermission, type Grants } from './authorization.service.js';
import { scopeService } from './scope.service.js';
import type { ScopeRule } from './scope.types.js';

/**
 * Privilege-escalation rules (FRD §15.2, §17). An actor may only grant, revoke, edit or act upon
 * a set of permissions they hold themselves. This one rule covers:
 *  - adding a permission to a role (you must have it);
 *  - assigning or removing a role (you must have everything the role grants);
 *  - suspending, removing or editing a person (you must have everything they have);
 *  - editing or deleting a role (you must have everything it currently grants).
 * Combined with "no changes to your own roles", nobody can raise their own privileges.
 * Scope matters too: a department-scoped actor can't hand out organization-wide access.
 */
export function missingPermissions(actor: Grants, target: Grants | string[]): string[] {
  if (actor.all) return [];
  if (Array.isArray(target)) return [...new Set(target)].filter((c) => !hasPermission(actor, c));
  if (target.all) return ['*'];
  return grantedCodes(target).filter((c) => !actor.codes.has(c));
}

/**
 * Throws unless `actor` holds every permission in `target` *with at least the same reach*.
 * `target` as a code list means "these codes, organization-wide" (the default scope of a new grant);
 * pass `targetRules` to describe narrower grants instead.
 */
export async function assertCovers(
  actor: Grants,
  target: Grants | string[],
  what: string,
  targetRules?: Map<string, ScopeRule[]>,
): Promise<void> {
  const missing = missingPermissions(actor, target);
  if (missing.length) {
    throw new ApiError('FORBIDDEN', `You cannot ${what}: it involves permissions you don't have.`, {
      reason: 'privilege_escalation',
      missingPermissions: missing,
    });
  }
  if (actor.all || actor.level !== 'organization') return;
  const codes = Array.isArray(target) ? [...new Set(target)] : grantedCodes(target);
  const tooBroad: string[] = [];
  for (const code of codes) {
    const rules =
      targetRules?.get(code) ??
      (Array.isArray(target) ? undefined : target.rules.get(code)) ?? [{ type: 'organization' as const, resourceIds: [] }];
    if (!(await scopeService.covers(actor, code, rules))) tooBroad.push(code);
  }
  if (tooBroad.length) {
    throw new ApiError('FORBIDDEN', `You cannot ${what}: it reaches further than your own access.`, {
      reason: 'privilege_escalation',
      scopeTooBroad: tooBroad,
    });
  }
}

export function assertHas(actor: Grants, code: string): void {
  if (!hasPermission(actor, code)) {
    throw new ApiError('FORBIDDEN', 'You do not have permission to perform this action.', { requiredPermission: code });
  }
}
