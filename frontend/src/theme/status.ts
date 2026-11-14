import {
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconFileCheck,
  IconFlask,
  IconLoader2,
  IconPencil,
  IconArchive,
  IconCircleFilled,
  IconCircleDashed,
  type Icon,
} from '@tabler/icons-react';

/**
 * Product status language — keep semantics consistent across every module.
 * See "Product status language" in docs/brand/brand-guidelines.md.
 *
 * Colour is never the only signal: every status carries a label and an icon.
 */
export type StatusTone = 'success' | 'warning' | 'error' | 'draft' | 'neutral' | 'info' | 'lekho';

export interface StatusDefinition {
  label: string;
  tone: StatusTone;
  icon: Icon;
}

export const STATUSES = {
  // Success green
  active: { label: 'Active', tone: 'success', icon: IconCircleFilled },
  present: { label: 'Present', tone: 'success', icon: IconCircleCheck },
  paid: { label: 'Paid', tone: 'success', icon: IconCircleCheck },
  completed: { label: 'Completed', tone: 'success', icon: IconCircleCheck },

  // Warning amber
  pending: { label: 'Pending', tone: 'warning', icon: IconClock },
  late: { label: 'Late', tone: 'warning', icon: IconClock },
  dueSoon: { label: 'Due soon', tone: 'warning', icon: IconClock },

  // Error red — note: a fee that is `overdue` is not the same as a `failed` payment.
  overdue: { label: 'Overdue', tone: 'error', icon: IconCircleX },
  failed: { label: 'Failed', tone: 'error', icon: IconCircleX },
  suspended: { label: 'Suspended', tone: 'error', icon: IconCircleX },
  cancelled: { label: 'Cancelled', tone: 'error', icon: IconCircleX },
  absent: { label: 'Absent', tone: 'error', icon: IconCircleX },

  // Violet
  draft: { label: 'Draft', tone: 'draft', icon: IconPencil },

  // Neutral
  inactive: { label: 'Inactive', tone: 'neutral', icon: IconCircleDashed },
  archived: { label: 'Archived', tone: 'neutral', icon: IconArchive },

  // Informational
  submitted: { label: 'Submitted', tone: 'lekho', icon: IconFileCheck },
  inProgress: { label: 'In progress', tone: 'info', icon: IconLoader2 },
  trial: { label: 'Trial', tone: 'lekho', icon: IconFlask },
} as const satisfies Record<string, StatusDefinition>;

export type StatusKey = keyof typeof STATUSES;
