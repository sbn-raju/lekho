import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { keys } from './keys';
import type { InvitationPreview, SecuritySummary, Session } from '@/types/api';

const opts = { withoutOrganization: true } as const;

// ----- Public auth flows -----
export const authApi = {
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }, opts),
  resetPassword: (token: string, password: string) => api.post('/auth/reset-password', { token, password }, opts),
  verifyEmail: (token: string) => api.post('/auth/verify-email', { token }, opts),
  resendVerification: (email: string) => api.post('/auth/resend-verification', { email }, opts),
  previewInvitation: (token: string) => api.post<InvitationPreview>('/invitations/preview', { token }, opts),
  acceptInvitation: (body: { token: string; password?: string; firstName?: string; lastName?: string }) =>
    api.post<{ organizationId: string; membershipId: string; accountCreated: boolean; nextStep: string }>('/invitations/accept', body, opts),
};

// ----- Account security (FRD §14.3 screen 6) -----
export function useSecuritySummary() {
  return useQuery({ queryKey: keys.security, queryFn: () => api.get<SecuritySummary>('/auth/security', opts) });
}

export function useSessions() {
  return useQuery({ queryKey: keys.sessions, queryFn: () => api.get<Session[]>('/auth/sessions', opts) });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`, opts),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['account'] }),
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => api.post('/auth/change-password', body, opts),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['account'] }),
  });
}

export const logoutAll = () => api.post('/auth/logout-all', undefined, opts);
