import type { Row } from './types';

/**
 * Extract a human-readable message from any thrown/returned value without
 * widening to `any`:
 *  - Error instances → message
 *  - strings → themselves
 *  - plain objects carrying a string `message` (PostgREST/Postgres errors
 *    are plain objects, not Error instances) → that message
 *  - anything else → '' (caller supplies the fallback)
 */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null && typeof (err as Row).message === 'string') {
    return (err as Row).message as string;
  }
  return '';
}
