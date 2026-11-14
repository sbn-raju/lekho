import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/** FRD §4.6. `locked` is reserved for admin-imposed locks; failed-login lockout lives on the credential. */
export const USER_STATUSES = [
  'invited',
  'pending_verification',
  'active',
  'inactive',
  'suspended',
  'locked',
  'deleted',
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Global Lekho identity (FRD §6, §13.1). Not tied to any organization; credentials live elsewhere. */
const userSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 100 },
    lastName: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, maxlength: 254 },
    normalizedEmail: { type: String, required: true },
    phone: { type: String, trim: true },
    profileImage: { type: String },
    status: { type: String, enum: USER_STATUSES, required: true, default: 'pending_verification' },
    emailVerified: { type: Boolean, required: true, default: false },
    lastLoginAt: { type: Date },
    /** Bumped to invalidate every access token issued to this user (logout-all, password reset). */
    tokenVersion: { type: Number, required: true, default: 1 },
    deletedAt: { type: Date },
  },
  { timestamps: true, collection: 'users' },
);

userSchema.index({ normalizedEmail: 1 }, { unique: true });
userSchema.index({ status: 1 });

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User>;

export const UserModel = model('User', userSchema);

/** Public profile shape returned by APIs. */
export function toPublicUser(user: User & { _id: unknown }) {
  return {
    id: String(user._id),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone ?? null,
    profileImage: user.profileImage ?? null,
    status: user.status,
    emailVerified: user.emailVerified,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
  };
}
