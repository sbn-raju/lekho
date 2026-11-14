import { Badge, type BadgeProps } from '@mantine/core';
import { STATUSES, type StatusKey } from '@/theme/status';

export interface StatusBadgeProps extends Omit<BadgeProps, 'color' | 'leftSection'> {
  status: StatusKey;
  /** Override the default label, e.g. domain-specific wording. */
  label?: string;
}

/** Status pill that always pairs colour with an icon and a readable label. */
export function StatusBadge({ status, label, ...others }: StatusBadgeProps) {
  const def = STATUSES[status];
  const Icon = def.icon;
  const iconSize = status === 'active' ? 8 : 14;

  return (
    <Badge
      color={def.tone}
      leftSection={<Icon size={iconSize} stroke={2} aria-hidden />}
      size="md"
      {...others}
    >
      {label ?? def.label}
    </Badge>
  );
}
