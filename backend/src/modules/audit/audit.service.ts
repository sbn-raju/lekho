import type { ClientSession } from 'mongoose';
import { AuditLogModel } from './audit-log.model.js';
import type { RequestMeta } from '../../common/utils/request.js';
import { logger } from '../../common/utils/logger.js';

export interface AuditEntry {
  actorId?: string;
  organizationId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  result: 'success' | 'failure';
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Non-sensitive context only (reason codes, counts). Never tokens, hashes or passwords. */
  metadata?: Record<string, unknown>;
  meta?: RequestMeta;
}

export const auditService = {
  /**
   * Records an audit event. Pass `session` to make the record part of a transaction.
   * Outside a transaction a failed write is logged rather than failing the user's request.
   */
  async record(entry: AuditEntry, session?: ClientSession): Promise<void> {
    const { meta, ...rest } = entry;
    const doc = { ...rest, ipAddress: meta?.ipAddress, userAgent: meta?.userAgent, requestId: meta?.requestId };
    if (session) {
      await AuditLogModel.create([doc], { session });
      return;
    }
    try {
      await AuditLogModel.create(doc);
    } catch (err) {
      logger.error(`Failed to write audit log for ${entry.action}`, err);
    }
  },
};
