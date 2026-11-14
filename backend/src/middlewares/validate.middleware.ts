import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ApiError } from '../utils/ApiError.js';

type Schemas = {
  body?: z.ZodType;
  params?: z.ZodType;
  query?: z.ZodType;
};

/** Validates request parts against zod schemas. Parsed body replaces req.body. */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    for (const key of ['body', 'params', 'query'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (!result.success) {
        return next(ApiError.badRequest(`Invalid request ${key}`, z.flattenError(result.error).fieldErrors));
      }
      if (key === 'body') req.body = result.data;
    }
    next();
  };
