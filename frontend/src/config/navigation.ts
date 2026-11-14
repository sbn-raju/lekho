import {
  IconBook,
  IconCalendarCheck,
  IconChartBar,
  IconChecklist,
  IconClipboardList,
  IconHome,
  IconReceipt,
  IconSchool,
  IconSettings,
  IconSpeakerphone,
  IconUsers,
  type Icon,
} from '@tabler/icons-react';

export interface NavItem {
  label: string;
  path: string;
  icon: Icon;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

/** Core modules from the brand board's "Core icons" set. */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ label: 'Dashboard', path: '/', icon: IconHome }],
  },
  {
    title: 'School',
    items: [
      { label: 'Students', path: '/students', icon: IconUsers },
      { label: 'Attendance', path: '/attendance', icon: IconCalendarCheck },
      { label: 'Fees', path: '/fees', icon: IconReceipt },
      { label: 'Exams', path: '/exams', icon: IconClipboardList },
    ],
  },
  {
    title: 'Learning',
    items: [
      { label: 'LMS', path: '/lms', icon: IconSchool },
      { label: 'Courses', path: '/courses', icon: IconBook },
      { label: 'Assignments', path: '/assignments', icon: IconChecklist },
    ],
  },
  {
    title: 'Communication',
    items: [
      { label: 'Announcements', path: '/announcements', icon: IconSpeakerphone },
      { label: 'Reports', path: '/reports', icon: IconChartBar },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { label: 'Settings', path: '/settings', icon: IconSettings };

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_SECTIONS.flatMap((s) => s.items), SETTINGS_ITEM];
