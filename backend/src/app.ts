import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env, isProduction, isTest, trustProxySetting } from './config/env.js';
import routes from './routes.js';
import { errorHandler, notFoundHandler } from './common/middleware/error.middleware.js';
import { tokenService } from './modules/auth/token.service.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', trustProxySetting());
  app.disable('x-powered-by');

  // Correlation ID for logs and audit records; echo a well-formed caller ID, else make one.
  app.use((req, res, next) => {
    const incoming = req.get('x-request-id');
    req.requestId = incoming && /^[A-Za-z0-9._:-]{8,128}$/.test(incoming) ? incoming : randomUUID();
    res.set('X-Request-Id', req.requestId);
    next();
  });
  app.use(helmet());
  // Cookie auth needs an explicit origin list; '*' disables credentialed CORS.
  app.use(cors({ origin: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(','), credentials: env.CORS_ORIGIN !== '*' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  if (!isTest) app.use(morgan(isProduction ? 'combined' : 'dev'));

  // Auth responses must never be cached by browsers or proxies.
  app.use('/api/v1/auth', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/.well-known/jwks.json', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(await tokenService.jwks());
  });

  app.use('/api/v1', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
