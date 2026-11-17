import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs } from './client';
import { keys } from './keys';
import type { AuditLog, Paginated } from '@/types/api';

export interface AuditFilters {
  page: number;
  limit?: number;
  action?: string;
  resource?: string;
  result?: 'success' | 'failure' | '';
  from?: string;
  to?: string;
  actorId?: string;
  organizationId?: string;
}

/** Audit APIs for a school (`/audit-logs`) or the whole platform (`/platform/audit-logs`). */
export function auditApi(scope: 'organization' | 'platform') {
  const base = scope === 'platform' ? '/platform/audit-logs' : '/audit-logs';
  const opts = scope === 'platform' ? ({ withoutOrganization: true } as const) : {};
  const query = (f: AuditFilters) => qs({ limit: 25, ...f });
  return {
    scope,
    key: (f: AuditFilters) => (scope === 'platform' ? [...keys.platform, 'audit', f] : keys.org('audit', f)),
    list: (f: AuditFilters) => api.get<Paginated<AuditLog>>(`${base}${query(f)}`, opts),
    // Export takes the same filters, minus paging.
    export: (f: AuditFilters) =>
      api.download(`${base}/export${qs({ ...f, page: undefined, limit: undefined })}`, `lekho-${scope}-audit-${new Date().toISOString().slice(0, 10)}.csv`, opts),
  };
}

export function useAuditLogs(a: ReturnType<typeof auditApi>, filters: AuditFilters, enabled = true) {
  return useQuery({ queryKey: a.key(filters), queryFn: () => a.list(filters), placeholderData: keepPreviousData, enabled });
}
