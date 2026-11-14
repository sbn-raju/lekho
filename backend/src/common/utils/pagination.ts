import { z } from 'zod';

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationQuery>;

export function paginated<T>(items: T[], total: number, { page, limit }: Pagination) {
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}

/** Escapes user input for use inside a RegExp (search boxes). */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
export const idParams = z.object({ id: objectId });
