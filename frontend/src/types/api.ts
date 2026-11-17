/**
 * Response shapes of the Lekho IAM API (backend/src/modules/**). Kept by hand; when a backend
 * `toPublic*` function changes, update the matching type here.
 */

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type UserStatus = 'invited' | 'pending_verification' | 'active' | 'inactive' | 'suspended' | 'locked' | 'deleted';
export type MembershipStatus = 'invited' | 'active' | 'suspended' | 'inactive' | 'revoked';
export type OrganizationStatus = 'draft' | 'onboarding' | 'active' | 'suspended' | 'inactive' | 'archived';
export type OnboardingState = 'draft' | 'organization_created' | 'admin_provisioning' | 'invitation_pending' | 'admin_activated' | 'active';
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';
export type ScopeType = 'organization' | 'department' | 'class' | 'section' | 'assigned' | 'own' | 'custom' | 'platform';
export type UnitType = 'department' | 'academic' | 'administration' | 'class' | 'section' | 'custom';
export type PermissionLevel = 'organization' | 'platform';

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  profileImage: string | null;
  status: UserStatus;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Me extends User {
  isSuperAdmin: boolean;
}

export interface AuthTokens {
  tokenType: 'Bearer';
  accessToken: string;
  expiresIn: number;
  csrfToken?: string;
  user?: User;
}

export interface Session {
  id: string;
  current: boolean;
  clientType: 'web' | 'mobile';
  deviceName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export interface SecuritySummary {
  emailVerified: boolean;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  activeSessions: number;
  mfa: { available: boolean; enabled: boolean };
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  code: string;
  type: 'school';
  contact: { email: string; phone?: string };
  address: { line1?: string; line2?: string; city?: string; state?: string; country?: string; postalCode?: string };
  logo: string | null;
  status: OrganizationStatus;
  settings: OrganizationSettings;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationSettings {
  timezone: string;
  academicYear?: string;
  hierarchyMaxDepth?: number;
}

export interface PlatformOrganization extends Organization {
  onboarding: {
    state: OnboardingState;
    adminInvitationId: string | null;
    adminActivatedAt: string | null;
    completedAt: string | null;
  };
  primaryAdminUserId: string | null;
}

export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  roleIds: string[];
  organizationUnitIds: string[];
  status: MembershipStatus;
  invitedBy: string | null;
  joinedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MyMembership extends Membership {
  usable: boolean;
  organization: { id: string; name: string; slug: string; logo: string | null; status: OrganizationStatus };
  roles: RoleRef[];
}

export interface PlatformOrgMember extends Membership {
  user: { id: string; firstName: string; lastName: string; email: string; status: UserStatus } | null;
  roles: { id: string; name: string }[];
}

export interface OrgUser extends User {
  membership: Membership;
}

export interface RoleRef {
  id: string;
  name: string;
  code: string;
}

export interface ScopeRule {
  type: ScopeType;
  resourceIds: string[];
}

export interface RoleGrant {
  id: string;
  code: string;
  name: string;
  scopes: ScopeRule[];
}

export interface Role {
  id: string;
  name: string;
  code: string;
  description: string | null;
  type: PermissionLevel;
  organizationId: string | null;
  level: number;
  isSystem: boolean;
  isProtected: boolean;
  status: 'active' | 'inactive';
  allPermissions: boolean;
  permissions: RoleGrant[];
  userCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Permission {
  id: string;
  code: string;
  name: string;
  resource: string;
  action: string;
  module: string;
  level: PermissionLevel;
  description: string | null;
  status: 'active' | 'inactive';
  scopable: boolean;
  scopedResource: string | null;
}

export interface PermissionModule {
  code: string;
  name: string;
  permissionCount: number;
}

export interface Invitation {
  id: string;
  organizationId: string;
  userId: string;
  membershipId: string;
  email: string;
  purpose: 'member' | 'initial_admin';
  invitedBy: string;
  proposedRoleIds: string[];
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt: string | null;
  delivery: { status: 'queued' | 'sending' | 'sent' | 'retrying' | 'failed'; attempts: number; sentAt: string | null };
  createdAt: string;
}

export interface InvitationPreview {
  email: string;
  organization: { name: string; logo: string | null };
  expiresAt: string;
  accountExists: boolean;
}

export interface OrganizationUnit {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  type: UnitType;
  description: string | null;
  parentId: string | null;
  ancestorIds: string[];
  depth: number;
  headUserIds: string[];
  status: 'active' | 'inactive';
  /** Set when another module owns the unit ('academics' for classes and sections). */
  managedBy: 'academics' | null;
  createdAt: string;
  updatedAt: string;
}

export interface UnitDetail extends OrganizationUnit {
  memberCount: number;
  childCount: number;
  heads: { id: string; name: string; email: string }[];
}

export interface UnitTreeNode extends OrganizationUnit {
  memberCount: number;
  children: UnitTreeNode[];
}

export interface UnitMember extends User {
  membership: Membership;
  isHead: boolean;
}

export interface AuditLog {
  id: string;
  actorId: string | null;
  organizationId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  result: 'success' | 'failure';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AccessContext {
  userId: string;
  isSuperAdmin: boolean;
  platform: { roles: RoleRef[]; allPermissions: boolean; permissions: string[] };
  organization: {
    id: string;
    usable: boolean;
    reason?: string;
    roles: RoleRef[];
    allPermissions: boolean;
    permissions: string[];
  } | null;
}

export interface EffectivePermissions {
  effective: boolean;
  membershipStatus: MembershipStatus;
  allPermissions: boolean;
  roles: RoleRef[];
  permissions: { code: string; name: string; scope: string }[];
}

export interface PlatformStaff extends User {
  platformMembership: { id: string; status: 'active' | 'suspended' | 'inactive'; roles: RoleRef[]; createdAt: string };
}

export interface PlatformDashboard {
  organizations: Record<OrganizationStatus | 'total', number>;
  pendingOnboarding: number;
  totalUsers: number;
  platformStaff: number;
}

// ---------- Academic structure (backend/src/modules/academics) ----------

export type AcademicYearStatus = 'planned' | 'active' | 'completed' | 'archived';

export interface AcademicTerm {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface AcademicYear {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  /** YYYY-MM-DD */
  startDate: string;
  endDate: string;
  status: AcademicYearStatus;
  isCurrent: boolean;
  terms: AcademicTerm[];
  activatedAt: string | null;
  completedAt: string | null;
  sectionCount: number;
  classCount: number;
  totalCapacity: number;
  createdAt: string;
  updatedAt: string;
}

export interface YearRef {
  id: string;
  name: string;
  status: AcademicYearStatus;
}

export interface SchoolClass {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  description: string | null;
  displayOrder: number;
  defaultSectionCapacity: number;
  status: 'active' | 'inactive';
  unitId: string;
  /** For the year the list was asked for (or the current year). Active sections only. */
  sectionCount: number;
  totalCapacity: number;
  sectionsWithoutClassTeacher: number;
  createdAt: string;
  updatedAt: string;
}

export interface Section {
  id: string;
  organizationId: string;
  academicYearId: string;
  classId: string;
  name: string;
  code: string;
  capacity: number;
  room: string | null;
  classTeacherUserId: string | null;
  displayOrder: number;
  status: 'active' | 'inactive';
  unitId: string;
  class: { id: string; name: string; code: string; status: 'active' | 'inactive' } | null;
  classTeacher: { id: string; name: string; email: string } | null;
  /** People placed in the section's hierarchy unit (class teacher included). */
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClassList {
  academicYear: YearRef | null;
  items: SchoolClass[];
}

export interface ClassDetail extends SchoolClass {
  academicYear: YearRef | null;
  sections: Section[];
  totalSectionsAllYears: number;
}

export interface AcademicsOverview {
  academicYear: (YearRef & { startDate: string; endDate: string; termCount: number }) | null;
  years: Record<AcademicYearStatus | 'total', number>;
  totals: {
    classes: number;
    activeClasses: number;
    sections: number;
    totalCapacity: number;
    averageSectionCapacity: number;
    sectionsWithoutClassTeacher: number;
    classesWithoutSections: number;
  };
  byClass: { classId: string; name: string; code: string; sectionCount: number; totalCapacity: number; sectionsWithoutClassTeacher: number }[];
  checklist: { key: 'academic_year' | 'current_year' | 'classes' | 'sections' | 'class_teachers'; label: string; done: boolean }[];
}
