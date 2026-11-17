import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { createApp } from './app.js';
import { logger } from './common/utils/logger.js';
import { tokenService } from './modules/auth/token.service.js';
import { invitationDelivery } from './modules/invitations/invitation.delivery.js';
import { permissionService } from './modules/permissions/permission.service.js';

async function bootstrap() {
  await tokenService.init();
  await connectDatabase();
  await permissionService.sync();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Server running on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });
  invitationDelivery.start();

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down...`);
    invitationDelivery.stop();
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
