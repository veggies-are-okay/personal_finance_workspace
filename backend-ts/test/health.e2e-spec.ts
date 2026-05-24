import type { Server } from 'node:http';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';

/**
 * E2E contract for the canonical `GET /health` (mirrors the FastAPI test in
 * `backend-python/tests/test_health.py`):
 *   GET /health -> 200, body deep-equals { status: 'ok' }, content-type JSON.
 *
 * MUST run without a live database. The TypeORM `DataSource` provider is
 * overridden with an inert stub so the Nest app boots even when Postgres is
 * down — `/health` is intentionally DB-independent.
 */
describe('HealthController (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  // Inert stub standing in for a real, initialized TypeORM DataSource.
  const fakeDataSource: Partial<DataSource> = {
    isInitialized: true,
    destroy: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getDataSourceToken())
      .useValue(fakeDataSource)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health -> 200 with body { status: "ok" }', () =>
    request(server)
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual({ status: 'ok' });
      }));

  it('GET /health responds with JSON content-type', () =>
    request(server)
      .get('/health')
      .expect(200)
      .expect('Content-Type', /application\/json/));

  it('GET /health body serializes to exactly {"status":"ok"}', () =>
    request(server)
      .get('/health')
      .expect(200)
      .expect((res) => {
        // Byte-for-byte match with FastAPI's serialized body.
        expect(res.text).toBe('{"status":"ok"}');
      }));
});
