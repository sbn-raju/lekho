import { createContext, use } from 'react';
import type { Me } from '@/types/api';

export type AuthState = { status: 'loading'; user: null } | { status: 'authenticated'; user: Me } | { status: 'anonymous'; user: null };

export interface AuthContextValue {
  state: AuthState;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  /** Re-reads /auth/me (after profile changes). */
  reloadUser: () => Promise<void>;
  /** Called after an action that ended every session (password reset, logout-all). */
  forgetSession: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** The signed-in user. Only call inside routes guarded by <RequireAuth>. */
export function useCurrentUser(): Me {
  const { state } = useAuth();
  if (state.status !== 'authenticated') throw new Error('useCurrentUser outside an authenticated route');
  return state.user;
}
