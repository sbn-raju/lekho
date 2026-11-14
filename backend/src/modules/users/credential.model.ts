import { Schema, Types, model, type InferSchemaType } from 'mongoose';

/** Password credential, stored apart from the profile (FRD §13.2). Never serialize this to clients. */
const credentialSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    passwordHash: { type: String, required: true },
    passwordChangedAt: { type: Date, required: true },
    failedLoginAttempts: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date },
  },
  { timestamps: true, collection: 'credentials' },
);

credentialSchema.index({ userId: 1 }, { unique: true });

export type Credential = InferSchemaType<typeof credentialSchema>;
export const CredentialModel = model('Credential', credentialSchema);
