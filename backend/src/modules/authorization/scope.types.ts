import type { SCOPE_TYPES } from '../roles/role.model.js';

export type ScopeType = (typeof SCOPE_TYPES)[number];

/** One scope entry on a role grant. Unit scopes without `resourceIds` are relative to the actor. */
export interface ScopeRule {
  type: ScopeType;
  resourceIds: string[];
}

/** What a resolver reports about one resource, for scope matching (FRD §10.4 step 8). */
export interface ResourceAttributes {
  id: string;
  organizationId: string;
  /** Units the resource directly belongs to (a member's units, a unit itself, a student's section…). */
  unitIds: string[];
  /** Users who own the resource ("own" scope). */
  ownerIds: string[];
  /** Users explicitly assigned to the resource ("assigned" scope), beyond unit membership. */
  assignedUserIds?: string[];
}

/** A resolved, concrete answer to "which resources may this actor touch with permission X?". */
export interface AccessScope {
  organizationWide: boolean;
  /** Units (expanded to include descendants) whose resources are in scope. */
  unitIds: Set<string>;
  /** "own": resources owned by the actor. */
  own: boolean;
  /** "assigned": resources that list the actor in assignedUserIds. */
  assignedToActor: boolean;
  /** "custom": explicitly listed resource IDs. */
  resourceIds: Set<string>;
  /** Scope types that contributed, for diagnostics. */
  types: ScopeType[];
}
