import { StatusBadge } from '@/components/StatusBadge';
import type { StatusKey } from '@/theme/status';

/**
 * Maps IAM lifecycle statuses (users, memberships, organizations, invitations, roles, audit
 * results, email delivery) onto the product status language in theme/status.ts, keeping each
 * domain's own wording as the label.
 */
const MAP: Record<string, [StatusKey, string?]> = {
  active: ['active'],
  invited: ['pending', 'Invited'],
  pending: ['pending'],
  pending_verification: ['pending', 'Unverified'],
  onboarding: ['inProgress', 'Onboarding'],
  draft: ['draft'],
  suspended: ['suspended'],
  locked: ['suspended', 'Locked'],
  inactive: ['inactive'],
  archived: ['archived'],
  deleted: ['archived', 'Deleted'],
  revoked: ['cancelled', 'Revoked'],
  expired: ['inactive', 'Expired'],
  accepted: ['completed', 'Accepted'],
  success: ['completed', 'Success'],
  failure: ['failed', 'Failed'],
  queued: ['pending', 'Queued'],
  sending: ['inProgress', 'Sending'],
  retrying: ['late', 'Retrying'],
  sent: ['completed', 'Sent'],
  failed: ['failed'],
};

export function EntityStatus({ status, size = 'md' }: { status: string; size?: 'sm' | 'md' | 'lg' }) {
  const [key, label] = MAP[status] ?? ['inactive', status.replace(/_/g, ' ')];
  return <StatusBadge status={key} label={label} size={size} />;
}
