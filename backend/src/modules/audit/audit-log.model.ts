import { Schema, Types, model } from 'mongoose';

/**
 * Append-only audit record (FRD §13.13). Must never contain passwords, tokens, hashes or secrets.
 * `actorId` is optional because some events (e.g. a failed login for an unknown email) have no actor.
 */
const auditLogSchema = new Schema(
  {
    actorId: { type: Types.ObjectId, ref: 'User' },
    organizationId: { type: Types.ObjectId, ref: 'Organization' },
    action: { type: String, required: true },
    resource: { type: String, required: true },
    resourceId: { type: String },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    metadata: { type: Schema.Types.Mixed },
    ipAddress: { type: String },
    userAgent: { type: String },
    requestId: { type: String },
    result: { type: String, enum: ['success', 'failure'], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'audit_logs', versionKey: false },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ organizationId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

// Immutability at the application layer. (Also restrict update/delete at the DB-user level in production.)
const blocked = () => {
  throw new Error('Audit logs are immutable');
};
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const) {
  auditLogSchema.pre(op, blocked);
}

export const AuditLogModel = model('AuditLog', auditLogSchema);
