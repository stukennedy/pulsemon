import type { Attributes, Scalar } from './types';

/** Attribute keys that would carry conversation content if a caller passed them. */
const CONTENT_KEYS = new Set([
  'transcript',
  'text',
  'message',
  'content',
  'prompt',
  'completion',
  'input',
  'output',
  'args',
  'arguments',
  'body',
  'error_message',
  'errorMessage',
  'stack',
]);

/**
 * Drop anything that isn't a scalar, and anything whose key names conversation
 * content. `Attributes` types the happy path; this closes the untyped edge,
 * because `Record<string, Scalar>` still accepts `{ transcript: '…' }` and a
 * caller spreading a log's fields into attributes would leak silently.
 *
 * Exported for tests: this function IS the content-free guarantee at runtime.
 */
export function scrubAttributes(attributes: Attributes | undefined): Record<string, Scalar> | undefined {
  if (!attributes) return undefined;
  const out: Record<string, Scalar> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    if (CONTENT_KEYS.has(key)) continue;
    // Objects and arrays are how structured content arrives; scalars only.
    if (value !== null && typeof value === 'object') continue;
    out[key] = value;
    kept += 1;
  }
  return kept > 0 ? out : undefined;
}
