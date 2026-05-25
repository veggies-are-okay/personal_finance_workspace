import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  AppModule,
  buildTypeOrmOptions,
  DEFAULT_DATABASE_URL,
  resilientDataSourceFactory,
} from './app.module';
import {
  ALL_ENTITIES,
  BudgetAggregateEntity,
  BudgetBucketAggregateEntity,
  BudgetCategoryAggregateEntity,
  BudgetMonthlyAggregateEntity,
  RecurringChargeEntity,
  TransactionEntity,
} from './entities/entities';
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

  it('marks the connection for manual initialization (DA-18 boot resilience)', () => {
    const config = new ConfigService({});
    expect(
      (buildTypeOrmOptions(config) as { manualInitialization?: boolean })
        .manualInitialization,
    ).toBe(true);
  });
});

describe('resilientDataSourceFactory (DA-18)', () => {
  it('returns the initialized DataSource on success', async () => {
    // Real DataSource.initialize() resolves to `this`; emulate that.
    const spy = jest
      .spyOn(DataSource.prototype, 'initialize')
      .mockImplementation(function (this: DataSource) {
        return Promise.resolve(this);
      });
    const result = await resilientDataSourceFactory({
      type: 'postgres',
      url: DEFAULT_DATABASE_URL,
    } as never);
    expect(result).toBeInstanceOf(DataSource);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('returns the un-initialized DataSource when the DB is down (no throw)', async () => {
    const spy = jest
      .spyOn(DataSource.prototype, 'initialize')
      .mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await resilientDataSourceFactory({
      type: 'postgres',
      url: 'postgresql://x:y@localhost:1/none',
    } as never);
    expect(result).toBeInstanceOf(DataSource);
    expect(result.isInitialized).toBe(false);
    spy.mockRestore();
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
      // The feature modules' forFeature repo providers need the DataSource's
      // entity metadata; override them so the module boots without a live DB.
      .overrideProvider(getRepositoryToken(TransactionEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(BudgetAggregateEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(BudgetBucketAggregateEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(BudgetCategoryAggregateEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(BudgetMonthlyAggregateEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(RecurringChargeEntity))
      .useValue({})
      .compile();

    expect(moduleRef.get(HealthController)).toBeInstanceOf(HealthController);
    expect(moduleRef.get(ConfigService)).toBeInstanceOf(ConfigService);

    await moduleRef.close();
  });
});
