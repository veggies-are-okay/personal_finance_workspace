import { Logger } from '@nestjs/common';

import { REDACTED, redact, safeLog } from './redaction';

/** Redaction (P6.1, DA-14): no token/secret ever reaches a log path. */
describe('redaction', () => {
  it('scrubs secret-looking keys recursively', () => {
    const out = redact({
      access_token: 'access-sandbox-secret',
      public_token: 'public-sandbox-secret',
      link_token: 'link-sandbox-secret',
      nested: { secret: 'shh', item_id: 'item-1' },
      list: [{ authorization: 'Bearer x' }],
      item_id: 'item-1',
    }) as Record<string, unknown>;

    expect(out.access_token).toBe(REDACTED);
    expect(out.public_token).toBe(REDACTED);
    expect(out.link_token).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).secret).toBe(REDACTED);
    expect(
      ((out.list as unknown[])[0] as Record<string, unknown>).authorization,
    ).toBe(REDACTED);
    // Non-secret keys pass through.
    expect(out.item_id).toBe('item-1');
    expect((out.nested as Record<string, unknown>).item_id).toBe('item-1');
  });

  it('passes scalars through unchanged', () => {
    expect(redact('plain')).toBe('plain');
    expect(redact(7)).toBe(7);
    expect(redact(null)).toBeNull();
  });

  it('safeLog never emits a token', () => {
    const logs: string[] = [];
    const spy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((msg: unknown) => {
        logs.push(String(msg));
      });
    const secret = 'access-sandbox-MUST-NOT-APPEAR';
    safeLog('item_linked', {
      access_token: secret,
      item_id: 'item-1',
      status: 'connected',
    });
    spy.mockRestore();

    const combined = logs.join('\n');
    expect(combined).not.toContain(secret);
    expect(combined).toContain(REDACTED);
    expect(combined).toContain('item-1');
  });
});
