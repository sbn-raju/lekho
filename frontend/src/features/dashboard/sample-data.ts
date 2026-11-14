/**
 * Placeholder data for the dashboard scaffold.
 * Replace with API calls (src/lib/api.ts) as backend modules come online.
 */
import { IconBook, IconCalendarCheck, IconReceipt, IconUsers } from '@tabler/icons-react';
import type { StatusKey } from '@/theme/status';

export const stats = [
  { label: 'Students', value: '1,248', hint: '+32 this term', icon: IconUsers, color: 'lekho' },
  { label: 'Attendance today', value: '95%', hint: '1,186 present', icon: IconCalendarCheck, color: 'success' },
  { label: 'Fees collected', value: '₹12,48,500', hint: '82% of term target', icon: IconReceipt, color: 'warning' },
  { label: 'Active courses', value: '64', hint: '12 with new submissions', icon: IconBook, color: 'draft' },
] as const;

export const recentFees: { student: string; grade: string; amount: number; due: string; status: StatusKey }[] = [
  { student: 'Aarav Sharma', grade: 'Grade 8 · A', amount: 12500, due: '10 Nov 2026', status: 'paid' },
  { student: 'Diya Patel', grade: 'Grade 6 · B', amount: 12500, due: '10 Nov 2026', status: 'pending' },
  { student: 'Kabir Rao', grade: 'Grade 10 · A', amount: 15000, due: '01 Nov 2026', status: 'overdue' },
  { student: 'Meera Iyer', grade: 'Grade 9 · C', amount: 14000, due: '10 Nov 2026', status: 'paid' },
  { student: 'Rohan Gupta', grade: 'Grade 7 · A', amount: 12500, due: '15 Nov 2026', status: 'dueSoon' },
];

export const upcoming: { title: string; course: string; due: string; status: StatusKey }[] = [
  { title: 'Photosynthesis lab report', course: 'Biology · Grade 9', due: 'Tomorrow', status: 'dueSoon' },
  { title: 'Algebra worksheet 4', course: 'Mathematics · Grade 8', due: '18 Nov', status: 'submitted' },
  { title: 'Essay: My community', course: 'English · Grade 6', due: '20 Nov', status: 'draft' },
  { title: 'Unit test — Motion', course: 'Physics · Grade 10', due: '22 Nov', status: 'inProgress' },
];
