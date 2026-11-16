/**
 * npm run dev:memory
 *
 * Runs the API against a throwaway in-memory MongoDB replica set and seeds a Super Admin, so the
 * frontend can be developed without touching Atlas. Everything is lost when the process exits.
 * Emails (invitations, resets) are printed to this console.
 *
 *   DEV_SUPER_ADMIN_EMAIL     default owner@lekho.test
 *   DEV_SUPER_ADMIN_PASSWORD  default lekho-dev-password
 *   PORT                      default 5050
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const email = process.env.DEV_SUPER_ADMIN_EMAIL ?? 'owner@lekho.test';
const password = process.env.DEV_SUPER_ADMIN_PASSWORD ?? 'lekho-dev-password';

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
// Set before the app's env module loads; dotenv never overrides variables that are already set.
process.env.MONGODB_URI = replSet.getUri('lekho');
process.env.NODE_ENV = 'development';
process.env.SMTP_URL = '';

await import('../src/server.js');

// server.ts connects asynchronously; wait for the connection before seeding.
const mongoose = (await import('mongoose')).default;
while (mongoose.connection.readyState !== 1) await new Promise((r) => setTimeout(r, 100));
const { bootstrapSuperAdmin } = await import('../src/bootstrap/super-admin.bootstrap.js');
await bootstrapSuperAdmin({ email, password, firstName: 'Lekho', lastName: 'Owner' });
console.log(`\n  In-memory database ready. Super Admin: ${email} / ${password}\n`);

const stop = async () => {
  await replSet.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
