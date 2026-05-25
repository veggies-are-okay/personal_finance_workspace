import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LoanEntity } from '../entities/entities';
import { DebtController } from './debt.controller';
import { DebtService } from './debt.service';

/**
 * Debt view feature (P4.5). Registers the `loans` repository so the service can
 * issue a thin read of that table (no recompute, DA-23) and project the payoff
 * scenarios.
 */
@Module({
  imports: [TypeOrmModule.forFeature([LoanEntity])],
  controllers: [DebtController],
  providers: [DebtService],
})
export class DebtModule {}
