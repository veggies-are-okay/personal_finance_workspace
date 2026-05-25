import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TransactionEntity } from '../entities/entities';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

/**
 * Transactions view feature (P4.1). Registers the `transactions` repository so
 * the service can issue thin reads of the normalized/precomputed table.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TransactionEntity])],
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
