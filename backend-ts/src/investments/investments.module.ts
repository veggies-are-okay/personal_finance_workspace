import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { HoldingEntity } from '../entities/entities';
import { InvestmentsController } from './investments.controller';
import { InvestmentsService } from './investments.service';

/**
 * Investments view feature (P4.4). Registers the `holdings` repository so the
 * service can issue a thin read of that table (no recompute, DA-23).
 */
@Module({
  imports: [TypeOrmModule.forFeature([HoldingEntity])],
  controllers: [InvestmentsController],
  providers: [InvestmentsService],
})
export class InvestmentsModule {}
