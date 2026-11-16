import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshSession, session } from '@/services/api/client';
import { clearOrganizationContext } from '@/services/auth/organization-context';
import type { AuthTokens, Me } from '@/types/api';

import { AuthContext, type AuthState } from './auth-context';

let bootstrap: Promise<Me | null> | null = null;

/** Restores the session from the refresh cookie once per page load. */
function restoreSession(): Promise<Me | null> {
  bootstrap ??= (async () => {
    if (!(await refreshSession())) return null;
    try {
      return await api.get<Me>('/auth/me', { withoutOrganization: true });
    } catch {
      return null;
    }
  })();
  return bootstrap;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });

  const forgetSession = useCallback(() => {
    session.clear();
    clearOrganizationContext();
    queryClient.clear();
    setState({ status: 'anonymous', user: null });
  }, [queryClient]);

  useEffect(() => {
    let cancelled = false;
    void restoreSession().then((user) => {
      if (!cancelled) setState(user ? { status: 'authenticated', user } : { status: 'anonymous', user: null });
    });
    const off = session.onExpired(forgetSession);
    return () => {
      cancelled = true;
      off();
    };
  }, [forgetSession]);

  const login = useCallback(async (email: string, password: string) => {
    const tokens = await api.post<AuthTokens>('/auth/login', { email, password }, { withoutOrganization: true });
    session.set(tokens.accessToken, tokens.expiresIn, tokens.csrfToken);
    const user = await api.get<Me>('/auth/me', { withoutOrganization: true });
    setState({ status: 'authenticated', user });
    return user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', undefined, { withoutOrganization: true });
    } catch {
      /* already signed out server-side */
    }
    forgetSession();
  }, [forgetSession]);

  const reloadUser = useCallback(async () => {
    const user = await api.get<Me>('/auth/me', { withoutOrganization: true });
    setState({ status: 'authenticated', user });
  }, []);

  const value = useMemo(() => ({ state, login, logout, reloadUser, forgetSession }), [state, login, logout, reloadUser, forgetSession]);
  return <AuthContext value={value}>{children}</AuthContext>;
}
