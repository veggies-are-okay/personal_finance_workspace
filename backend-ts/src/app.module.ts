import { join } from 'node:path';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';

import { BudgetModule } from './budget/budget.module';
import { DebtModule } from './debt/debt.module';
import { ALL_ENTITIES } from './entities/entities';
import { HealthModule } from './health/health.module';
import { InvestmentsModule } from './investments/investments.module';
import { NetWorthModule } from './networth/networth.module';
import { TransactionsModule } from './transactions/transactions.module';

// The shared `.env` lives at the repo root (two levels up from this file:
// backend-ts/src/app.module.ts). It is gitignored and holds DATABASE_URL and
// TS_API_PORT. Defaults below match the local docker-compose Postgres so the
// app boots without a `.env` present.
const REPO_ROOT_ENV = join(__dirname, '..', '..', '.env');
export const DEFAULT_DATABASE_URL =
  'postgresql://pf:pf@localhost:5432/personal_finance';

/**
 * Build the TypeORM connection options.
 *
 * Mirrors the Python backend's DB wiring intent:
 * - Alembic (backend-python) owns the schema, so `synchronize: false` — TypeORM
 *   never auto-syncs the schema out from under Alembic.
 * - `entities: ALL_ENTITIES` mirror the Alembic-owned schema (P2.3). They are
 *   registered for metadata only; `synchronize: false` means TypeORM never
 *   creates or alters tables.
 * - `retryAttempts: 0` so app/test startup never blocks on an unavailable DB.
 *   `/health` is DB-independent and the e2e suite must boot without Postgres.
 *
 * Exported (and pure) so it can be unit-tested without booting Nest.
 */
export function buildTypeOrmOptions(
  config: ConfigService,
): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    url: config.get<string>('DATABASE_URL', DEFAULT_DATABASE_URL),
    synchronize: false,
    entities: ALL_ENTITIES,
    retryAttempts: 0,
    // Our `resilientDataSourceFactory` owns initialization (it tolerates a
    // DB-down boot). `manualInitialization: true` stops @nestjs/typeorm from
    // re-initializing + retrying (which would crash the process) — see DA-18.
    manualInitialization: true,
  };
}

/**
 * Resilient DataSource factory (parity with FastAPI's lazy engine, DA-18).
 *
 * FastAPI's SQLAlchemy engine connects lazily, so the app boots even when
 * Postgres is down and a per-request query then fails into a canonical 503.
 * TypeORM, by contrast, connects at boot and `retryAttempts: 0` would crash the
 * process — diverging from FastAPI (`/health` would never come up). This factory
 * TRIES to initialize and, on failure, returns the un-initialized DataSource so
 * the app still boots; the first repository query then throws and the
 * `TransactionsService` maps it to the same canonical 503 FastAPI returns.
 *
 * No connection string / error detail is logged (data-privacy.md).
 */
export async function resilientDataSourceFactory(
  options: DataSourceOptions | undefined,
): Promise<DataSource> {
  const dataSource = new DataSource(options as DataSourceOptions);
  try {
    return await dataSource.initialize();
  } catch {
    // DB unavailable at boot: keep booting (DB-independent /health stays up).
    return dataSource;
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: REPO_ROOT_ENV,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildTypeOrmOptions,
      dataSourceFactory: resilientDataSourceFactory,
    }),
    HealthModule,
    TransactionsModule,
    BudgetModule,
    NetWorthModule,
    InvestmentsModule,
    DebtModule,
  ],
})
export class AppModule {}
