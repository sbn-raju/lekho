import { EmptyState } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { PageLoader } from '@/components/feedback/QueryState';
import { useAccess, useMyMemberships, useSelectOrganization } from '@/services/api/access';
import { useAuth } from '@/services/auth/auth-context';
import { getLastOrganizationId, setActiveOrganizationId, useActiveOrganizationId } from '@/services/auth/organization-context';
import { safeRedirect } from '@/utils/redirect';

/** Signed-in users only; others go to sign-in and come back afterwards. */
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <PageLoader />;
  if (state.status === 'anonymous') {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/sign-in?redirect=${redirect}`} replace />;
  }
  return <Outlet />;
}

/** Sign-in and recovery screens: signed-in users are sent on. */
export function RedirectIfAuthenticated() {
  const { state } = useAuth();
  const [params] = useSearchParams();
  if (state.status === 'loading') return <PageLoader />;
  if (state.status === 'authenticated') return <Navigate to={safeRedirect(params.get('redirect'))} replace />;
  return <Outlet />;
}

/**
 * School console: needs a selected school where the user's membership is usable. Picks one
 * automatically when there's an obvious choice (only one, or the last one used); otherwise asks.
 * Users with no school but platform access go to the platform console.
 */
export function RequireSchool() {
  const activeId = useActiveOrganizationId();
  const memberships = useMyMemberships();
  const access = useAccess();
  const select = useSelectOrganization();

  const usable = memberships.data?.filter((m) => m.usable) ?? [];
  const activeIsUsable = !!activeId && usable.some((m) => m.organizationId === activeId);
  const last = getLastOrganizationId();
  const autoPick = !activeIsUsable ? (usable.find((m) => m.organizationId === last) ?? (usable.length === 1 ? usable[0] : undefined)) : undefined;

  useEffect(() => {
    if (!memberships.data) return;
    if (activeId && !activeIsUsable) setActiveOrganizationId(null);
    if (autoPick && !select.isPending) select.mutate(autoPick.organizationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when the decision inputs change
  }, [memberships.data, activeId, activeIsUsable, autoPick?.organizationId]);

  if (!memberships.data || (!access.ready && usable.length === 0)) return <PageLoader />;
  if (activeIsUsable) return <Outlet />;
  if (autoPick || select.isPending) return <PageLoader />;
  if (usable.length === 0 && access.hasPlatformAccess) return <Navigate to="/platform" replace />;
  return <Navigate to="/select-organization" replace />;
}

/** Platform console: Super Admin or platform staff. */
export function RequirePlatform() {
  const access = useAccess();
  if (!access.ready) return <PageLoader />;
  if (!access.hasPlatformAccess) return <Navigate to="/" replace />;
  return <Outlet />;
}

/**
 * Hides a screen the user can't use. Purely presentational: the API enforces the same permission,
 * this just avoids showing a page that would only produce 403s.
 */
export function Gate({ org, platform, children }: { org?: string; platform?: string; children: ReactNode }) {
  const access = useAccess();
  if (!access.ready) return <PageLoader />;
  const allowed = (org ? access.canOrg(org) : true) && (platform ? access.canPlatform(platform) : true);
  if (!allowed) {
    return (
      <EmptyState
        icon={<IconLock size={28} stroke={1.75} />}
        title="You don't have access to this page"
        description="Ask an administrator if you need it."
        py={64}
      />
    );
  }
  return <>{children}</>;
}
