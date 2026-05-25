import { createHash } from 'node:crypto';
import type { Server } from 'node:http';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import request from 'supertest';

import { ConnectionsController } from '../src/connections/connections.controller';
import { ConnectionsService } from '../src/connections/connections.service';
import { decryptToken } from '../src/connections/crypto';
import {
  PLAID_GATEWAY,
  type ExchangeResult,
  type LinkToken,
  type PlaidGateway,
  type PlaidJwk,
} from '../src/connections/plaid.gateway';
import { PlaidItemEntity, SourceConfigEntity } from '../src/entities/entities';
import { CanonicalExceptionFilter } from '../src/errors/canonical-exception.filter';
import { canonicalValidationExceptionFactory } from '../src/errors/validation-exception.factory';

/**
 * Controller-level e2e for the connections API (P6.1) — exercises real Nest
 * route wiring, the global ValidationPipe (canonical 422), the canonical filter
 * (401/503), and the rawBody webhook flow, with the Plaid gateway + repositories
 * faked (no network, no DB). Mirrors the scenarios the parity harness asserts.
 */

const KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const KID = 'synthetic-kid-1';
const ACCESS_TOKEN = 'access-sandbox-do-not-store-plaintext';
const ITEM_ID = 'item-parity-p61-001';

type Row = Record<string, unknown>;

interface ErrorBody {
  error: { code: string; message: string; details: unknown[] };
}
interface LinkBody {
  link_token: string;
  expiration: string;
}
interface ConnectionsBody {
  items: Row[];
  sources: Row[];
}

let privateKey: CryptoKey;
let jwk: PlaidJwk;

class FakeGateway implements PlaidGateway {
  createLinkToken(): Promise<LinkToken> {
    return Promise.resolve({
      linkToken: 'link-sandbox-synthetic',
      expiration: '2026-05-24T10:30:00.000Z',
    });
  }
  exchangePublicToken(): Promise<ExchangeResult> {
    return Promise.resolve({ accessToken: ACCESS_TOKEN, itemId: ITEM_ID });
  }
  getWebhookVerificationKey(): Promise<PlaidJwk> {
    return Promise.resolve(jwk);
  }
  createSandboxPublicToken(): Promise<string> {
    return Promise.resolve('public-sandbox-synthetic');
  }
}

function makeItemsRepo() {
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

async function signed(body: Buffer): Promise<string> {
  const hash = createHash('sha256').update(body).digest('hex');
  return new SignJWT({ request_body_sha256: hash })
    .setProtectedHeader({ alg: 'ES256', kid: KID })
    .setIssuedAt()
    .sign(privateKey);
}

describe('ConnectionsController (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let itemsRepo: ReturnType<typeof makeItemsRepo>;

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256', { extractable: true });
    privateKey = pair.privateKey;
    jwk = { ...(await exportJWK(pair.publicKey)), kid: KID } as PlaidJwk;

    itemsRepo = makeItemsRepo();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              APP_ENCRYPTION_KEY: KEY,
              PLAID_USER_ID: 'local',
              OAUTH_REDIRECT_ALLOWLIST: 'http://localhost:5173/oauth',
            }),
          ],
        }),
      ],
      controllers: [ConnectionsController],
      providers: [
        ConnectionsService,
        { provide: PLAID_GATEWAY, useClass: FakeGateway },
        { provide: getRepositoryToken(PlaidItemEntity), useValue: itemsRepo },
        {
          provide: getRepositoryToken(SourceConfigEntity),
          useValue: {
            find: jest.fn((): Promise<unknown[]> => Promise.resolve([])),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalFilters(new CanonicalExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: canonicalValidationExceptionFactory,
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /link-token -> 200 with ISO-Z expiration', () =>
    request(server)
      .post('/api/v1/connections/link-token')
      .send({ products: ['transactions'] })
      .expect(200)
      .expect((res) => {
        const body = res.body as LinkBody;
        expect(body.link_token).toBe('link-sandbox-synthetic');
        expect(body.expiration).toBe('2026-05-24T10:30:00Z');
      }));

  it('POST /exchange encrypts + stores (no plaintext) and returns the shape', () =>
    request(server)
      .post('/api/v1/connections/exchange')
      .send({ public_token: 'public-sandbox-synthetic' })
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual({ item_id: ITEM_ID, status: 'connected' });
        const blob = itemsRepo.store[ITEM_ID].accessToken as Buffer;
        expect(blob.includes(Buffer.from(ACCESS_TOKEN))).toBe(false);
        expect(decryptToken(blob, KEY)).toBe(ACCESS_TOKEN);
      }));

  it('POST /exchange with missing public_token -> canonical 422', () =>
    request(server)
      .post('/api/v1/connections/exchange')
      .send({})
      .expect(422)
      .expect((res) => {
        expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
      }));

  it('GET /connections -> 200 snapshot', () =>
    request(server)
      .get('/api/v1/connections')
      .expect(200)
      .expect((res) => {
        const body = res.body as ConnectionsBody;
        expect(Object.keys(body).sort()).toEqual(['items', 'sources']);
        expect(body.sources).toHaveLength(5);
      }));

  it('POST /webhook verified -> 200 accepted', async () => {
    const bodyStr =
      '{"webhook_type":"TRANSACTIONS","webhook_code":"SYNC_UPDATES_AVAILABLE"}';
    return request(server)
      .post('/api/v1/connections/webhook')
      .set('plaid-verification', await signed(Buffer.from(bodyStr)))
      .set('content-type', 'application/json')
      .send(bodyStr)
      .expect(200)
      .expect({ status: 'accepted' });
  });

  it('POST /webhook unsigned -> canonical 401', () => {
    const bodyStr = '{"webhook_type":"TRANSACTIONS","webhook_code":"X"}';
    return request(server)
      .post('/api/v1/connections/webhook')
      .set('content-type', 'application/json')
      .send(bodyStr)
      .expect(401)
      .expect((res) => {
        expect((res.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
      });
  });

  it('POST /webhook forged signature -> canonical 401', async () => {
    const bodyStr = '{"webhook_type":"TRANSACTIONS","webhook_code":"X"}';
    const attacker = await generateKeyPair('ES256', { extractable: true });
    const hash = createHash('sha256').update(bodyStr).digest('hex');
    const forged = await new SignJWT({ request_body_sha256: hash })
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setIssuedAt()
      .sign(attacker.privateKey);
    return request(server)
      .post('/api/v1/connections/webhook')
      .set('plaid-verification', forged)
      .set('content-type', 'application/json')
      .send(bodyStr)
      .expect(401);
  });

  it('POST /webhook verified but bad body schema -> canonical 422', async () => {
    const bodyStr = '{"unexpected":"shape"}';
    return request(server)
      .post('/api/v1/connections/webhook')
      .set('plaid-verification', await signed(Buffer.from(bodyStr)))
      .set('content-type', 'application/json')
      .send(bodyStr)
      .expect(422)
      .expect((res) => {
        expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
      });
  });

  it('GET /oauth allowlisted -> 307 redirect', () =>
    request(server)
      .get('/api/v1/connections/oauth')
      .query({ redirect_uri: 'http://localhost:5173/oauth' })
      .expect(307)
      .expect((res) => {
        expect(res.headers.location).toBe('http://localhost:5173/oauth');
      }));

  it('GET /oauth non-allowlisted -> canonical 422 (no open redirect)', () =>
    request(server)
      .get('/api/v1/connections/oauth')
      .query({ redirect_uri: 'http://evil.example.com/steal' })
      .expect(422)
      .expect((res) => {
        expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
      }));
});
