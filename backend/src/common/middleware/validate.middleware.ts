import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ApiError } from '../errors/ApiError.js';

type Schemas = {
  body?: z.ZodType;
  params?: z.ZodType;
  query?: z.ZodType;
};

/** Validates request parts against zod schemas; the parsed values replace req.body / req.query / req.params. */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    for (const key of ['body', 'params', 'query'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      // Express 5 leaves req.body undefined when no body was sent; treat that as an empty object.
      const result = schema.safeParse(key === 'body' ? (req.body ?? {}) : req[key]);
      if (!result.success) {
        return next(ApiError.badRequest(`Invalid request ${key}`, z.flattenError(result.error).fieldErrors));
      }
      if (key === 'body') req.body = result.data;
      // Express 5 exposes req.query/params via getters; shadow them with the parsed (coerced, defaulted) values.
      else Object.defineProperty(req, key, { value: result.data, writable: true, configurable: true, enumerable: true });
    }
    next();
  };
