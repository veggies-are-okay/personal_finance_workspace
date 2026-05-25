import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GoalEntity } from '../entities/entities';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

/**
 * Goals view feature (P4.6). Registers the `goals` repository so the service can
 * issue a thin read of that table (no recompute, DA-23).
 */
@Module({
  imports: [TypeOrmModule.forFeature([GoalEntity])],
  controllers: [GoalsController],
  providers: [GoalsService],
})
export class GoalsModule {}
