import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ApiError, type ErrorCode } from '../errors/ApiError.js';
import { logger } from '../utils/logger.js';
import { isProduction } from '../../config/env.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.path}`));
};

/** Emits the FRD §18 envelope: { success: false, error: { code, message, details } }. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let statusCode = 500;
  let code: ErrorCode = 'INTERNAL_SERVER_ERROR';
  let message = 'Internal server error';
  let details: unknown;

  if (err instanceof ApiError) {
    ({ statusCode, code, message, details } = err);
  } else if (err instanceof mongoose.Error.ValidationError) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = `Invalid ${err.path}`;
  } else if (err?.code === 11000) {
    statusCode = 409;
    code = 'CONFLICT';
    message = 'Duplicate value';
    // Only field names: the values may be personal data.
    details = { fields: Object.keys(err.keyValue ?? {}) };
  } else if (err?.type === 'entity.parse.failed') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Malformed JSON body';
  }

  if (statusCode >= 500) logger.error(err?.message ?? 'Unknown error', err);

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details: details ?? {},
      ...(!isProduction && statusCode >= 500 && { stack: err?.stack }),
    },
  });
};
