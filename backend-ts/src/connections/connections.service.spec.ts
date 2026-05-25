import { ConfigService } from '@nestjs/config';

import { CanonicalServiceUnavailableException } from '../errors/canonical-error';
import {
  ConnectionsService,
  parseAllowlist,
  resolveRedirect,
  sourcesForProducts,
} from './connections.service';
import { decryptToken } from './crypto';
import type { ExchangeResult, LinkToken, PlaidGateway } from './plaid.gateway';

/**
 * Unit tests for the connections service (P6.1) — parity twin of the FastAPI
 * service/router tests. Repositories + the Plaid gateway are mocked (no network,
 * no DB). Proves: link-token + exchange (encrypt, NO plaintext at rest, decrypts
 * back); the snapshot shape + per-source status; Plaid-down -> 503; the source
 * mapping; and the OAuth allowlist (exact match only).
 */

const KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const SYNTHETIC_ACCESS_TOKEN = 'access-sandbox-do-not-store-plaintext';
const ITEM_ID = 'item-parity-p61-001';

function makeConfig(): ConfigService {
  const values: Record<string, string> = {
    APP_ENCRYPTION_KEY: KEY,
    PLAID_USER_ID: 'local',
    PLAID_WEBHOOK_URL: 'http://localhost:8000/api/v1/connections/webhook',
  };
  return {
    get: <T>(key: string, def?: T): T => (values[key] as unknown as T) ?? def,
  } as unknown as ConfigService;
}

class FakeGateway implements PlaidGateway {
  raiseLink = false;
  raiseExchange = false;
  createLinkToken(): Promise<LinkToken> {
    if (this.raiseLink) return Promise.reject(new Error('plaid down'));
    return Promise.resolve({
      linkToken: 'link-sandbox-synthetic',
      expiration: '2026-05-24T10:30:00.000Z',
    });
  }
  exchangePublicToken(): Promise<ExchangeResult> {
    if (this.raiseExchange) return Promise.reject(new Error('plaid down'));
    return Promise.resolve({
      accessToken: SYNTHETIC_ACCESS_TOKEN,
      itemId: ITEM_ID,
    });
  }
  getWebhookVerificationKey(): Promise<never> {
    return Promise.reject(new Error('unused'));
  }
  createSandboxPublicToken(): Promise<string> {
    return Promise.resolve('public-sandbox-synthetic');
  }
}

type Row = Record<string, unknown>;

interface FakeItemsRepo {
  store: Record<string, Row>;
  findOne: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  find: jest.Mock;
}

function makeItemsRepo(): FakeItemsRepo {
  const store: Record<string, Row> = {};
  return {
    store,
    findOne: jest.fn(
      (arg: { where: { itemId: string } }): Promise<Row | null> =>
        Promise.resolve(store[arg.where.itemId] ?? null),
    ),
    insert: jest.fn((row: Row): Promise<void> => {
      store[row.itemId as string] = { ...row };
      return Promise.resolve();
    }),
    update: jest.fn((where: { itemId: string }, patch: Row): Promise<void> => {
      store[where.itemId] = { ...store[where.itemId], ...patch };
      return Promise.resolve();
    }),
    find: jest.fn((): Promise<Row[]> => Promise.resolve(Object.values(store))),
  };
}

function makeService(
  gateway: PlaidGateway,
  items: FakeItemsRepo,
  configRepo: { find: jest.Mock },
): ConnectionsService {
  return new ConnectionsService(
    gateway,
    makeConfig(),
    items as never,
    configRepo as never,
  );
}

describe('ConnectionsService', () => {
  let gateway: FakeGateway;
  let items: FakeItemsRepo;
  let configRepo: { find: jest.Mock };
  let service: ConnectionsService;

  beforeEach(() => {
    gateway = new FakeGateway();
    items = makeItemsRepo();
    configRepo = {
      find: jest.fn((): Promise<unknown[]> => Promise.resolve([])),
    };
    service = makeService(gateway, items, configRepo);
  });

  it('createLinkToken returns the token + ISO-Z expiration', async () => {
    const res = await service.createLinkToken(['transactions']);
    expect(res.link_token).toBe('link-sandbox-synthetic');
    expect(res.expiration).toBe('2026-05-24T10:30:00Z');
  });

  it('createLinkToken -> 503 when Plaid is down', async () => {
    gateway.raiseLink = true;
    await expect(service.createLinkToken()).rejects.toBeInstanceOf(
      CanonicalServiceUnavailableException,
    );
  });

  it('exchange encrypts + stores (NO plaintext at rest) and decrypts back', async () => {
    const res = await service.exchange('public-sandbox-synthetic');
    expect(res).toEqual({ item_id: ITEM_ID, status: 'connected' });

    const stored = items.store[ITEM_ID];
    const blob = stored.accessToken as Buffer;
    // The stored bytes are ciphertext, not the plaintext token (DA-12).
    expect(blob.includes(Buffer.from(SYNTHETIC_ACCESS_TOKEN))).toBe(false);
    expect(decryptToken(blob, KEY)).toBe(SYNTHETIC_ACCESS_TOKEN);
  });

  it('exchange -> 503 when Plaid is down', async () => {
    gateway.raiseExchange = true;
    await expect(service.exchange('x')).rejects.toBeInstanceOf(
      CanonicalServiceUnavailableException,
    );
  });

  it('storeExchangedItem upserts in place (idempotent re-link)', async () => {
    await service.storeExchangedItem(ITEM_ID, 'tok-1', {
      products: ['transactions'],
    });
    await service.storeExchangedItem(ITEM_ID, 'tok-2', {
      products: ['transactions'],
    });
    expect(Object.keys(items.store)).toEqual([ITEM_ID]);
    expect(decryptToken(items.store[ITEM_ID].accessToken as Buffer, KEY)).toBe(
      'tok-2',
    );
  });

  it('list builds the snapshot with per-source status', async () => {
    await service.storeExchangedItem(ITEM_ID, SYNTHETIC_ACCESS_TOKEN, {
      institution: 'Example Bank',
      products: ['transactions', 'liabilities'],
    });
    const snapshot = await service.list();
    expect(snapshot.sources.map((s) => s.source).sort()).toEqual([
      'holdings',
      'income',
      'listings',
      'loans',
      'transactions',
    ]);
    const tx = snapshot.sources.find((s) => s.source === 'transactions')!;
    expect(tx.status).toBe('connected');
    expect(tx.mode).toBe('local');
    const item = snapshot.items.find((i) => i.item_id === ITEM_ID)!;
    expect(item.institution).toBe('Example Bank');
    expect(item.sources.sort()).toEqual(['loans', 'transactions']);
    expect(typeof item.last_synced).toBe('string');
  });

  it('list on an empty DB returns all sources not_connected', async () => {
    const snapshot = await service.list();
    expect(snapshot.items).toEqual([]);
    expect(snapshot.sources).toHaveLength(5);
    expect(snapshot.sources.every((s) => s.status === 'not_connected')).toBe(
      true,
    );
  });

  it('list -> 503 when the DB fails', async () => {
    items.find.mockRejectedValueOnce(new Error('db down'));
    await expect(service.list()).rejects.toBeInstanceOf(
      CanonicalServiceUnavailableException,
    );
  });
});

describe('source mapping + allowlist helpers', () => {
  it('maps products to sorted unique sources', () => {
    expect(sourcesForProducts(['transactions', 'liabilities'])).toEqual([
      'loans',
      'transactions',
    ]);
    expect(sourcesForProducts(['investments'])).toEqual(['holdings']);
    expect(sourcesForProducts(null)).toEqual([]);
    expect(sourcesForProducts(['unknown'])).toEqual([]);
  });

  it('parseAllowlist trims + drops empties', () => {
    expect(parseAllowlist('a , b ,, c')).toEqual(['a', 'b', 'c']);
  });

  it('resolveRedirect matches EXACTLY only (no open redirect)', () => {
    const allow = ['http://localhost:5173/oauth'];
    expect(resolveRedirect('http://localhost:5173/oauth', allow)).toBe(
      'http://localhost:5173/oauth',
    );
    expect(resolveRedirect('http://localhost:5173/oauthX', allow)).toBeNull();
    expect(resolveRedirect('http://evil.example.com', allow)).toBeNull();
  });
});
