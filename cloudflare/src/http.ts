import type { Context } from 'hono';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function jsonError(c: Context, error: unknown): Response {
  if (error instanceof ApiError) {
    return c.json({ detail: error.message }, error.status as never);
  }
  const message = error instanceof Error ? error.message : 'Internal server error';
  return c.json({ detail: message }, 500);
}

export async function readJson<T>(c: Context): Promise<T> {
  try {
    return await c.req.json<T>();
  } catch {
    throw new ApiError(400, 'Invalid JSON body');
  }
}

export function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, `${field} is required`);
  }
  return value.trim();
}

export function parseNullableInt(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new ApiError(400, 'Invalid integer parameter');
  return parsed;
}

export function intParam(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new ApiError(400, `Invalid ${name}`);
  return parsed;
}
