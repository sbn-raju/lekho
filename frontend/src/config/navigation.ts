import {
  IconBook,
  IconBuildingCommunity,
  IconCalendarStats,
  IconChalkboard,
  IconCalendarCheck,
  IconChartBar,
  IconChecklist,
  IconClipboardList,
  IconHierarchy2,
  IconHistory,
  IconHome,
  IconKey,
  IconLayoutGrid,
  IconMailForward,
  IconReceipt,
  IconSchool,
  IconSettings,
  IconShieldCheck,
  IconShieldLock,
  IconSpeakerphone,
  IconUserShield,
  IconUsers,
  IconUsersGroup,
  type Icon,
} from '@tabler/icons-react';

export interface NavItem {
  label: string;
  path: string;
  icon: Icon;
  /** Hide unless the user holds this permission (UI hint only; the API enforces it). */
  permission?: string;
  /** Highlight only on this exact path, not its sub-pages (for section landing pages). */
  exact?: boolean;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

/** Domain modules that don't have screens yet; they render a placeholder page. */
export const MODULE_PLACEHOLDERS: NavItem[] = [
  { label: 'Students', path: '/students', icon: IconUsers },
  { label: 'Attendance', path: '/attendance', icon: IconCalendarCheck },
  { label: 'Fees', path: '/fees', icon: IconReceipt },
  { label: 'Exams', path: '/exams', icon: IconClipboardList },
  { label: 'LMS', path: '/lms', icon: IconSchool },
  { label: 'Courses', path: '/courses', icon: IconBook },
  { label: 'Assignments', path: '/assignments', icon: IconChecklist },
  { label: 'Announcements', path: '/announcements', icon: IconSpeakerphone },
  { label: 'Reports', path: '/reports', icon: IconChartBar },
];

const placeholder = (path: string) => MODULE_PLACEHOLDERS.find((i) => i.path === path)!;

/** School Administration Console (FRD §14.2) plus the school modules. */
export const SCHOOL_NAV: NavSection[] = [
  { items: [{ label: 'Dashboard', path: '/', icon: IconHome }] },
  {
    title: 'Academics',
    items: [
      { label: 'Academic setup', path: '/academics', icon: IconLayoutGrid, permission: 'classes.read', exact: true },
      { label: 'Classes & sections', path: '/academics/classes', icon: IconChalkboard, permission: 'classes.read' },
      { label: 'Academic years', path: '/academics/years', icon: IconCalendarStats, permission: 'academic_years.read' },
    ],
  },
  { title: 'School', items: ['/students', '/attendance', '/fees', '/exams'].map(placeholder) },
  { title: 'Learning', items: ['/lms', '/courses', '/assignments'].map(placeholder) },
  { title: 'Communication', items: ['/announcements', '/reports'].map(placeholder) },
  {
    title: 'Administration',
    items: [
      { label: 'Users', path: '/users', icon: IconUsersGroup, permission: 'users.read' },
      { label: 'Roles & permissions', path: '/roles', icon: IconUserShield, permission: 'roles.read' },
      { label: 'Hierarchy', path: '/hierarchy', icon: IconHierarchy2, permission: 'organization_units.read' },
      { label: 'Invitations', path: '/invitations', icon: IconMailForward, permission: 'invitations.read' },
      { label: 'Audit logs', path: '/audit-logs', icon: IconHistory, permission: 'audit_logs.read' },
    ],
  },
];

export const SCHOOL_FOOTER_NAV: NavItem[] = [{ label: 'School settings', path: '/settings', icon: IconSettings }];

/** Lekho Super Admin Console (FRD §14.1). */
export const PLATFORM_NAV: NavSection[] = [
  { items: [{ label: 'Dashboard', path: '/platform', icon: IconHome }] },
  {
    title: 'Platform',
    items: [
      { label: 'Organizations', path: '/platform/organizations', icon: IconBuildingCommunity, permission: 'organizations.read' },
      { label: 'Platform staff', path: '/platform/staff', icon: IconUsersGroup, permission: 'platform_users.read' },
      { label: 'Platform roles', path: '/platform/roles', icon: IconUserShield, permission: 'platform_roles.read' },
      { label: 'Permission catalog', path: '/platform/permissions', icon: IconKey, permission: 'platform_permissions.read' },
    ],
  },
  {
    title: 'Oversight',
    items: [
      { label: 'Audit logs', path: '/platform/audit-logs', icon: IconHistory, permission: 'platform_audit.read' },
      { label: 'Security', path: '/platform/security', icon: IconShieldLock, permission: 'platform_audit.read' },
    ],
  },
];

export const ACCOUNT_ITEM: NavItem = { label: 'Account security', path: '/account/security', icon: IconShieldCheck };
