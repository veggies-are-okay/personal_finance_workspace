import { Logger } from '@nestjs/common';

/**
 * Structured logging that NEVER emits secrets (DA-14) — parity twin of
 * `backend-python/app/connections/redaction.py`.
 *
 * Plaid `access_token` / `public_token` / `link_token` and any key that looks
 * token/secret-ish are scrubbed before anything is logged. The connections code
 * logs ONLY through `safeLog`, so no token ever reaches a log sink or an error.
 */

export const REDACTED = '***REDACTED***';

const SECRET_MARKERS = [
  'access_token',
  'public_token',
  'link_token',
  'accesstoken',
  'publictoken',
  'linktoken',
  'secret',
  'authorization',
  'password',
  'client_secret',
  'plaid-verification',
];

function isSecretKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return SECRET_MARKERS.some((marker) => lowered.includes(marker));
}

/** Recursively redact secret-looking keys in objects/arrays; never mutates input. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => redact(v));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? REDACTED : redact(v);
    }
    return out;
  }
  return value;
}

const logger = new Logger('connections');

/** Log a structured connections event with all secret-ish fields redacted. */
export function safeLog(event: string, fields: Record<string, unknown>): void {
  logger.log(`${event} ${JSON.stringify(redact(fields))}`);
}
