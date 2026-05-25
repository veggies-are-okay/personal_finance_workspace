import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  AppModule,
  buildTypeOrmOptions,
  DEFAULT_DATABASE_URL,
} from './app.module';
import { ALL_ENTITIES } from './entities/entities';
import { HealthController } from './health/health.controller';

/**
 * Wiring + DB-config tests for the root module.
 *
 * `buildTypeOrmOptions` is tested in isolation (no Nest boot, no real DB) for
 * both the configured- and default-URL paths. The full module compile uses an
 * inert `DataSource` stub so it boots without a live Postgres — proving the app
 * is DB-independent at startup, which the `/health` contract requires.
 */
describe('buildTypeOrmOptions', () => {
  it('uses DATABASE_URL from config when present', () => {
    const url = 'postgresql://user:pass@db.example:5432/finance';
    const config = { get: jest.fn().mockReturnValue(url) };
    const options = buildTypeOrmOptions(config as unknown as ConfigService);

    expect(options).toMatchObject({
      type: 'postgres',
      url,
      synchronize: false,
      entities: ALL_ENTITIES,
      retryAttempts: 0,
    });
    expect(config.get).toHaveBeenCalledWith(
      'DATABASE_URL',
      DEFAULT_DATABASE_URL,
    );
  });

  it('registers all P2.3 entities (mirrors the Alembic schema)', () => {
    const config = new ConfigService({});
    const options = buildTypeOrmOptions(config);
    expect(options.entities).toHaveLength(ALL_ENTITIES.length);
    expect(options.entities).toContain(ALL_ENTITIES[0]);
  });

  it('falls back to the docker-compose default when DATABASE_URL is unset', () => {
    // Real ConfigService with no DATABASE_URL set returns the provided default.
    const config = new ConfigService({});
    const options = buildTypeOrmOptions(config);

    expect(options).toMatchObject({
      url: DEFAULT_DATABASE_URL,
      synchronize: false,
      retryAttempts: 0,
    });
  });

  it('never enables synchronize (Alembic owns the schema)', () => {
    const config = new ConfigService({});
    expect(buildTypeOrmOptions(config).synchronize).toBe(false);
  });
});

describe('AppModule', () => {
  const fakeDataSource: Partial<DataSource> = {
    isInitialized: true,
    destroy: jest.fn().mockResolvedValue(undefined),
  };

  it('compiles and wires HealthController without a live database', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getDataSourceToken())
      .useValue(fakeDataSource)
      .compile();

    expect(moduleRef.get(HealthController)).toBeInstanceOf(HealthController);
    expect(moduleRef.get(ConfigService)).toBeInstanceOf(ConfigService);

    await moduleRef.close();
  });
});
