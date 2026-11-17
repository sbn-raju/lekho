import { Schema, Types, model } from 'mongoose';

/**
 * Shape shared by email-verification and password-reset tokens (FRD §13.4, §13.5).
 * Only the SHA-256 of the token is stored; the raw value exists only in the emailed link.
 */
function oneTimeTokenSchema(collection: string) {
  const schema = new Schema(
    {
      userId: { type: Types.ObjectId, ref: 'User', required: true },
      tokenHash: { type: String, required: true },
      expiresAt: { type: Date, required: true },
      consumedAt: { type: Date },
    },
    { timestamps: { createdAt: true, updatedAt: false }, collection },
  );
  schema.index({ tokenHash: 1 }, { unique: true });
  schema.index({ userId: 1, consumedAt: 1 });
  schema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });
  return schema;
}

export const EmailVerificationTokenModel = model(
  'EmailVerificationToken',
  oneTimeTokenSchema('email_verification_tokens'),
);

export const PasswordResetTokenModel = model('PasswordResetToken', oneTimeTokenSchema('password_reset_tokens'));
