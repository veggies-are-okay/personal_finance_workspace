import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConfigService } from '@nestjs/config';

import { PlaidItemEntity, SourceConfigEntity } from '../entities/entities';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';
import { FakePlaidGateway } from './fake-gateway';
import {
  PLAID_GATEWAY,
  SdkPlaidGateway,
  type PlaidGateway,
} from './plaid.gateway';

/**
 * Connections feature (P6.1): Plaid link/exchange/list + encrypted Item store +
 * JWT-verified webhook. Registers the `plaid_items` + `source_config`
 * repositories and binds the Plaid gateway behind the `PLAID_GATEWAY` token.
 *
 * `PLAID_FAKE=1` (set by the `contracts/` parity harness + CI) selects the
 * network-free `FakePlaidGateway` so no real Plaid call is made; otherwise the
 * real SDK gateway. Tests can also `useValue` their own fake directly.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PlaidItemEntity, SourceConfigEntity])],
  controllers: [ConnectionsController],
  providers: [
    ConnectionsService,
    {
      provide: PLAID_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PlaidGateway =>
        process.env.PLAID_FAKE === '1'
          ? new FakePlaidGateway()
          : new SdkPlaidGateway(config),
    },
  ],
})
export class ConnectionsModule {}
