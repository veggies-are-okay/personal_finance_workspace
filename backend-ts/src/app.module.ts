import { join } from 'node:path';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';

import { HealthModule } from './health/health.module';

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
 * - `entities: []` for now; the schema (and entities) arrive in P2.1.
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
    entities: [],
    autoLoadEntities: true,
    retryAttempts: 0,
  };
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
    }),
    HealthModule,
  ],
})
export class AppModule {}
