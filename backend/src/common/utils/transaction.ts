import mongoose, { type ClientSession } from 'mongoose';

/**
 * Runs `fn` in a MongoDB transaction (retried on transient errors by the driver).
 * Requires a replica set; Atlas qualifies. Side effects that aren't database writes
 * (emails) must happen after this resolves, never inside `fn`.
 */
export async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
