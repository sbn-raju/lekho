import { Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconCheck } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { ApiError } from '@/services/api/client';

/** Friendly text for an API error. Escalation and scope denials get specific wording. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.details as { reason?: string } | undefined;
    if (details?.reason === 'privilege_escalation') return `${error.message} You can only grant access you have yourself.`;
    if (details?.reason === 'out_of_scope') return 'This is outside the part of the school you can manage.';
    return error.message;
  }
  if (error instanceof TypeError) return "Couldn't reach Lekho. Check your connection and try again.";
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

export function notifySuccess(message: ReactNode, title?: string) {
  notifications.show({ color: 'success', title, message, icon: <IconCheck size={18} /> });
}

export function notifyError(error: unknown, title = "That didn't work") {
  notifications.show({ color: 'error', title, message: errorMessage(error), icon: <IconAlertCircle size={18} />, autoClose: 7000 });
}

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown> | void;
  successMessage?: string;
}

/** Confirmation dialog for consequential actions; reports the outcome as a notification. */
export function confirmAction({ title, message, confirmLabel, destructive, onConfirm, successMessage }: ConfirmOptions) {
  modals.openConfirmModal({
    title,
    children: typeof message === 'string' ? <Text size="md">{message}</Text> : message,
    labels: { confirm: confirmLabel, cancel: 'Cancel' },
    confirmProps: { color: destructive ? 'error' : 'lekho' },
    onConfirm: async () => {
      try {
        await onConfirm();
        if (successMessage) notifySuccess(successMessage);
      } catch (err) {
        notifyError(err);
      }
    },
  });
}
