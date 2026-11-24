/**
 * The permission catalog (FRD §9). This file is the single source of truth: it is synced to the
 * `permissions` collection at startup, and only codes registered here can be assigned to roles.
 * Tenants cannot invent permission codes, so no role can claim a capability the backend doesn't
 * enforce (FRD §9.4).
 *
 * Register a permission here in the same change that adds the `requirePermission(...)` check
 * enforcing it. Domain modules (students, attendance, fees, LMS …) add theirs as they are built.
 */
export type PermissionLevel = 'platform' | 'organization';

export interface PermissionDefinition {
  code: string;
  name: string;
  module: string;
  level: PermissionLevel;
  description: string;
  /**
   * Resource type the permission acts on, when it can be narrowed by scope (department, class,
   * section, assigned, own, custom). Unset → the permission only supports organization scope.
   * Must match a resolver registered in scope.service.ts.
   */
  scopedResource?: string;
}

const org = (code: string, name: string, module: string, description: string, scopedResource?: string): PermissionDefinition => ({
  code,
  name,
  module,
  level: 'organization',
  description,
  ...(scopedResource && { scopedResource }),
});
const platform = (code: string, name: string, module: string, description: string): PermissionDefinition => ({
  code,
  name,
  module,
  level: 'platform',
  description,
});

export const PERMISSION_CATALOG: readonly PermissionDefinition[] = [
  // ----- Organization: users & memberships -----
  org('users.read', 'View users', 'users', 'List and view members of the school.', 'user'),
  org('users.create', 'Add users', 'users', 'Add people to the school (sends an invitation).'),
  org('users.update', 'Edit users', 'users', 'Edit member profiles and change their status in the school.', 'user'),
  org('users.delete', 'Remove users', 'users', 'Remove people from the school. Their Lekho account is kept.', 'user'),
  org('memberships.read', 'View memberships', 'users', 'View membership records.', 'membership'),
  org('memberships.update', 'Edit memberships', 'users', 'Change membership expiry and status.', 'membership'),
  org('memberships.delete', 'Revoke memberships', 'users', 'Revoke memberships.', 'membership'),
  org('invitations.read', 'View invitations', 'users', 'View pending, accepted and expired invitations.'),
  org('invitations.create', 'Send invitations', 'users', 'Send and resend invitations.'),
  org('invitations.delete', 'Revoke invitations', 'users', 'Revoke pending invitations.'),

  // ----- Organization: roles & permissions -----
  org('roles.read', 'View roles', 'roles', 'View roles and the permissions they grant.'),
  org('roles.create', 'Create roles', 'roles', 'Create and clone custom roles.'),
  org('roles.update', 'Edit roles', 'roles', 'Rename roles, change their permissions, activate or deactivate them.'),
  org('roles.delete', 'Delete roles', 'roles', 'Delete custom roles that nobody holds.'),
  org('roles.assign', 'Assign roles', 'roles', 'Give roles to members and take them away.'),
  org('permissions.read', 'View permission catalog', 'roles', 'View the permissions available to roles.'),

  // ----- Organization: hierarchy -----
  org('organization_units.read', 'View hierarchy', 'organization_units', 'View departments, classes, sections and their members.'),
  org('organization_units.create', 'Create units', 'organization_units', 'Create departments, classes and sections (scoped by parent unit).', 'organization_unit'),
  org('organization_units.update', 'Edit units', 'organization_units', 'Rename, move, activate or deactivate units.', 'organization_unit'),
  org('organization_units.delete', 'Delete units', 'organization_units', 'Delete empty units.', 'organization_unit'),
  org('organization_units.assign', 'Assign unit members', 'organization_units', 'Add and remove unit members and department heads.', 'organization_unit'),

  // ----- Organization: academic structure -----
  org('academic_years.read', 'View academic years', 'academics', 'View academic years, their terms and which year is current.'),
  org('academic_years.create', 'Create academic years', 'academics', 'Create academic years.'),
  org('academic_years.update', 'Edit academic years', 'academics', 'Edit dates and terms; activate, close, reopen and archive academic years.'),
  org('academic_years.delete', 'Delete academic years', 'academics', 'Delete academic years that are not current and not in use.'),
  org('classes.read', 'View classes & sections', 'academics', 'View classes, their sections and configured strength.'),
  org('classes.create', 'Create classes', 'academics', 'Create classes, one at a time or from a template.'),
  org('classes.update', 'Edit classes', 'academics', 'Rename and reorder classes, set default section strength, activate or deactivate them.'),
  org('classes.delete', 'Delete classes', 'academics', 'Delete classes that have no sections.'),
  org('sections.create', 'Create sections', 'academics', 'Add sections to classes, in bulk, or by copying another academic year.'),
  org('sections.update', 'Edit sections', 'academics', 'Change section strength, room, class teacher and status (scoped by class or section).', 'section'),
  org('sections.delete', 'Delete sections', 'academics', 'Delete sections with nobody placed in them.'),

  // ----- Organization: students (Student FRD §2, §16) -----
  // Read permissions are scoped by the student's current section, so a teacher role granted with
  // "assigned" or section/class scope sees only students placed in those sections.
  org('students.read', 'View students', 'students', 'View student records, photographs, admission numbers and class placement (scoped by class or section).', 'student'),
  org('students.read_sensitive', 'View sensitive student data', 'students', 'View religion, caste and medical notes. Every view is audited (scoped by class or section).', 'student'),
  org('students.create', 'Register students', 'students', 'Start student registrations (drafts) and complete them, which issues the admission number.'),
  org('students.update', 'Edit students', 'students', 'Edit student details, upload and replace photographs, and change student status.'),
  org('students.delete', 'Delete or archive students', 'students', 'Delete draft registrations and archive or restore registered students.'),
  org('guardians.read', 'View parents & guardians', 'students', "View students' parent and guardian contact details (scoped by class or section).", 'student'),
  org('guardians.manage', 'Manage parents & guardians', 'students', 'Add, edit and remove parents and guardians, and verify their mobile numbers by OTP.'),
  org('student_assignments.manage', 'Assign classes', 'students', 'Place students in a class and section for an academic year, transfer, correct and close placements.'),
  org('student_id_cards.generate', 'Generate ID cards', 'students', 'Generate and download student ID cards, one at a time or in bulk (scoped by class or section).', 'student'),
  org('students.configure', 'Configure student records', 'students', 'Set the admission number format, manage ID card templates and correct admission numbers.'),

  // ----- Organization: school settings & audit -----
  org('settings.update', 'Edit school settings', 'settings', 'Edit the school profile and settings.'),
  org('audit_logs.read', 'View audit logs', 'audit_logs', "View the school's audit trail."),

  // ----- Platform -----
  platform('organizations.read', 'View organizations', 'organizations', 'List and view schools and their members.'),
  platform('organizations.create', 'Create organizations', 'organizations', 'Create schools.'),
  platform('organizations.update', 'Edit organizations', 'organizations', 'Edit school details.'),
  platform('organizations.manage', 'Change organization status', 'organizations', 'Activate, suspend, deactivate or archive schools.'),
  platform('organizations.assign', 'Provision School Admins', 'organizations', "Provision a school's initial School Admin and resend the invitation."),
  platform('platform_users.read', 'View platform staff', 'platform_users', 'List and view platform staff.'),
  platform('platform_users.create', 'Add platform staff', 'platform_users', 'Add platform staff accounts.'),
  platform('platform_users.update', 'Edit platform staff', 'platform_users', "Change platform staff roles and status."),
  platform('platform_roles.read', 'View platform roles', 'platform_roles', 'View platform roles.'),
  platform('platform_roles.create', 'Create platform roles', 'platform_roles', 'Create platform roles.'),
  platform('platform_roles.update', 'Edit platform roles', 'platform_roles', 'Edit platform roles and their permissions.'),
  platform('platform_roles.delete', 'Delete platform roles', 'platform_roles', 'Delete unused platform roles.'),
  platform('platform_permissions.read', 'View platform permissions', 'platform_permissions', 'View the permission catalog.'),
  platform('platform_audit.read', 'View platform audit logs', 'platform_audit', 'View the platform-wide audit trail.'),
];

const byCode = new Map(PERMISSION_CATALOG.map((p) => [p.code, p]));

export function getPermissionDefinition(code: string): PermissionDefinition | undefined {
  return byCode.get(code);
}

export const ORGANIZATION_PERMISSION_CODES = PERMISSION_CATALOG.filter((p) => p.level === 'organization').map((p) => p.code);
export const PLATFORM_PERMISSION_CODES = PERMISSION_CATALOG.filter((p) => p.level === 'platform').map((p) => p.code);

/** Module display order for the permission matrix. */
export const PERMISSION_MODULES: Record<PermissionLevel, { code: string; name: string }[]> = {
  organization: [
    { code: 'users', name: 'Users & invitations' },
    { code: 'roles', name: 'Roles & permissions' },
    { code: 'organization_units', name: 'Departments & hierarchy' },
    { code: 'academics', name: 'Academic structure' },
    { code: 'students', name: 'Students' },
    { code: 'settings', name: 'School settings' },
    { code: 'audit_logs', name: 'Audit logs' },
  ],
  platform: [
    { code: 'organizations', name: 'Organizations' },
    { code: 'platform_users', name: 'Platform staff' },
    { code: 'platform_roles', name: 'Platform roles' },
    { code: 'platform_permissions', name: 'Permission catalog' },
    { code: 'platform_audit', name: 'Platform audit' },
  ],
};
