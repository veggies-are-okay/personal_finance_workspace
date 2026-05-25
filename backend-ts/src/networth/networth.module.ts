import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountEntity } from '../entities/entities';
import { NetWorthController } from './networth.controller';
import { NetWorthService } from './networth.service';

/**
 * Net Worth view feature (P4.3). Registers the `accounts` repository so the
 * service can issue a thin read of that table (no recompute, DA-23).
 */
@Module({
  imports: [TypeOrmModule.forFeature([AccountEntity])],
  controllers: [NetWorthController],
  providers: [NetWorthService],
})
export class NetWorthModule {}
