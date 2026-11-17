import { afterAll, beforeAll, beforeEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// Must be set before src/config/env.ts is imported by any test.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://placeholder';
process.env.APP_URL = 'http://app.test';
delete process.env.JWT_PRIVATE_KEY;
delete process.env.SMTP_URL;

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const mongoose = (await import('mongoose')).default;
  await mongoose.connect(replSet.getUri());
  // Build indexes (unique constraints) before tests rely on them.
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});

beforeEach(async () => {
  const mongoose = (await import('mongoose')).default;
  const { testOutbox } = await import('../src/modules/notifications/mailer.js');
  testOutbox.length = 0;
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );
  const { permissionService } = await import('../src/modules/permissions/permission.service.js');
  await permissionService.sync();
});

afterAll(async () => {
  const mongoose = (await import('mongoose')).default;
  await mongoose.disconnect();
  await replSet?.stop();
});
