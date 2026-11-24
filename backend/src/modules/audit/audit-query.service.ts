import { Types } from 'mongoose';
import { z } from 'zod';
import { ApiError } from '../../common/errors/ApiError.js';
import { objectId, paginated, paginationQuery } from '../../common/utils/pagination.js';
import { AuditLogModel } from './audit-log.model.js';

export const auditQuerySchema = paginationQuery.extend({
  actorId: objectId.optional(),
  action: z.string().trim().max(100).optional(),
  resource: z.string().trim().max(100).optional(),
  resourceId: z.string().trim().max(100).optional(),
  result: z.enum(['success', 'failure']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Platform only: narrow to one organization. */
  organizationId: objectId.optional(),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;

function toPublicAudit(l: Record<string, unknown> & { _id: unknown }) {
  return {
    id: String(l._id),
    actorId: l.actorId ? String(l.actorId) : null,
    organizationId: l.organizationId ? String(l.organizationId) : null,
    action: l.action,
    resource: l.resource,
    resourceId: l.resourceId ?? null,
    result: l.result,
    before: l.before ?? null,
    after: l.after ?? null,
    metadata: l.metadata ?? null,
    ipAddress: l.ipAddress ?? null,
    userAgent: l.userAgent ?? null,
    requestId: l.requestId ?? null,
    createdAt: l.createdAt,
  };
}

/**
 * Audit log queries (FRD §12.11). Organization queries are hard-filtered to that organization;
 * the platform view sees everything.
 */
export const auditQueryService = {
  filter(query: AuditQuery, organizationId?: string) {
    const f: Record<string, unknown> = {};
    if (organizationId) f.organizationId = new Types.ObjectId(organizationId);
    else if (query.organizationId) f.organizationId = new Types.ObjectId(query.organizationId);
    if (query.actorId) f.actorId = new Types.ObjectId(query.actorId);
    // Prefix match so "membership." finds every membership event.
    if (query.action) f.action = query.action.endsWith('.') ? { $regex: `^${query.action.replace(/[^a-z0-9_.]/gi, '')}` } : query.action;
    if (query.resource) f.resource = query.resource;
    if (query.resourceId) f.resourceId = query.resourceId;
    if (query.result) f.result = query.result;
    if (query.from || query.to) f.createdAt = { ...(query.from && { $gte: query.from }), ...(query.to && { $lte: query.to }) };
    return f;
  },

  async list(query: AuditQuery, organizationId?: string) {
    const f = this.filter(query, organizationId);
    const [items, total] = await Promise.all([
      AuditLogModel.find(f).sort({ createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
      AuditLogModel.countDocuments(f),
    ]);
    return paginated(items.map((l) => toPublicAudit(l as never)), total, query);
  },

  async get(id: string, organizationId?: string) {
    const l = Types.ObjectId.isValid(id)
      ? await AuditLogModel.findOne({ _id: id, ...(organizationId && { organizationId }) }).lean()
      : null;
    if (!l) throw ApiError.notFound('Audit log not found');
    return toPublicAudit(l as never);
  },

  /** Up to 10,000 matching records as CSV. */
  async exportCsv(query: AuditQuery, organizationId?: string): Promise<string> {
    const rows = await AuditLogModel.find(this.filter(query, organizationId)).sort({ createdAt: -1 }).limit(10_000).lean();
    const cols = ['createdAt', 'actorId', 'organizationId', 'action', 'resource', 'resourceId', 'result', 'ipAddress', 'details'] as const;
    // Quote every field; neutralize spreadsheet formula injection.
    const cell = (v: unknown) => {
      let s = v instanceof Date ? v.toISOString() : v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = rows.map((r) =>
      cols
        .map((c) =>
          cell(c === 'details' ? JSON.stringify({ before: r.before, after: r.after, metadata: r.metadata }) : (r as Record<string, unknown>)[c]),
        )
        .join(','),
    );
    return [cols.join(','), ...lines].join('\n');
  },
};
