import { Avatar, type AvatarProps } from '@mantine/core';
import type { StudentSummary } from '@/types/students';

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Student photo (signed thumbnail URL) or initials. */
export function StudentAvatar({ student, large, ...props }: { student: Pick<StudentSummary, 'fullName' | 'photo'>; large?: boolean } & Omit<AvatarProps, 'src'>) {
  const src = (large ? student.photo?.url : student.photo?.thumbnailUrl) ?? undefined;
  return (
    <Avatar src={src} alt={student.fullName} color="lekho" radius="md" {...props}>
      {initialsOf(student.fullName)}
    </Avatar>
  );
}
