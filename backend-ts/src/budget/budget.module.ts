import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  BudgetAggregateEntity,
  BudgetBucketAggregateEntity,
  BudgetCategoryAggregateEntity,
  BudgetMonthlyAggregateEntity,
  RecurringChargeEntity,
} from '../entities/entities';
import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';

/**
 * Budget view feature (P4.2). Registers the precomputed aggregate repositories
 * so the service can issue thin reads of those tables (no recompute, DA-23).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      BudgetAggregateEntity,
      BudgetBucketAggregateEntity,
      BudgetCategoryAggregateEntity,
      BudgetMonthlyAggregateEntity,
      RecurringChargeEntity,
    ]),
  ],
  controllers: [BudgetController],
  providers: [BudgetService],
})
export class BudgetModule {}
