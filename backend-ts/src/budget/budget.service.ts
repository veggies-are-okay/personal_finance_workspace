import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  BudgetAggregateEntity,
  BudgetBucketAggregateEntity,
  BudgetCategoryAggregateEntity,
  BudgetMonthlyAggregateEntity,
  RecurringChargeEntity,
} from '../entities/entities';
import { CanonicalServiceUnavailableException } from '../errors/canonical-error';
import { formatDate, formatMoney } from '../transactions/transactions.service';
import {
  BudgetBucketDto,
  BudgetCategoryDto,
  BudgetDto,
  MonthlyNeedsWantsDto,
  RecurringChargeDto,
} from './budget-response.dto';

/**
 * Thin read of the PRECOMPUTED budget aggregate tables (parity twin of the
 * FastAPI `build_budget`). NO recompute — both backends read the SAME rows
 * written by the P3.2 ingestion pipeline, so for the same DB state both return
 * byte-identical bodies (DA-9 / DA-23):
 *
 *  - `budget_aggregates`           -> savings_rate + effective_tax_rate
 *  - `budget_bucket_aggregates`    -> buckets[] (50/30/20)
 *  - `budget_category_aggregates`  -> categories[]
 *  - `budget_monthly_aggregates`   -> monthly[]
 *  - `recurring_charges`           -> recurring[]
 *
 * Deterministic ordering matches FastAPI exactly (buckets by 50/30/20 order;
 * categories by name; monthly by month; recurring by merchant). Money is a 2dp
 * decimal STRING (DA-2); percentages are JSON NUMBERS 0-100 (DA-22); dates are
 * `YYYY-MM-DD` (DA-3). An empty DB yields zeros + empty arrays. A DB failure
 * becomes the same canonical 503 FastAPI returns (DA-18).
 */
@Injectable()
export class BudgetService {
  constructor(
    @InjectRepository(BudgetAggregateEntity)
    private readonly aggregates: Repository<BudgetAggregateEntity>,
    @InjectRepository(BudgetBucketAggregateEntity)
    private readonly buckets: Repository<BudgetBucketAggregateEntity>,
    @InjectRepository(BudgetCategoryAggregateEntity)
    private readonly categories: Repository<BudgetCategoryAggregateEntity>,
    @InjectRepository(BudgetMonthlyAggregateEntity)
    private readonly monthly: Repository<BudgetMonthlyAggregateEntity>,
    @InjectRepository(RecurringChargeEntity)
    private readonly recurring: Repository<RecurringChargeEntity>,
  ) {}

  // Canonical bucket ordering so both backends list buckets identically.
  private static readonly BUCKET_ORDER: Record<string, number> = {
    needs: 0,
    wants: 1,
    savings: 2,
  };

  async get(window: string): Promise<BudgetDto> {
    let aggregate: BudgetAggregateEntity | null;
    let bucketRows: BudgetBucketAggregateEntity[];
    let categoryRows: BudgetCategoryAggregateEntity[];
    let monthlyRows: BudgetMonthlyAggregateEntity[];
    let recurringRows: RecurringChargeEntity[];
    try {
      [aggregate, bucketRows, categoryRows, monthlyRows, recurringRows] =
        await Promise.all([
          this.aggregates.findOne({ where: { window } }),
          this.buckets.find({ where: { window } }),
          this.categories.find({
            where: { window },
            order: { name: 'ASC' },
          }),
          this.monthly.find({ where: { window }, order: { month: 'ASC' } }),
          this.recurring.find({ order: { merchant: 'ASC' } }),
        ]);
    } catch {
      // DB down / table missing / connection refused -> canonical 503 (DA-18).
      throw new CanonicalServiceUnavailableException();
    }

    // Empty DB -> well-formed zeros + empty arrays (parity across both backends).
    const savings_rate = aggregate ? formatPercent(aggregate.savingsRate) : 0;
    const effective_tax_rate = aggregate
      ? formatPercent(aggregate.effectiveTaxRate)
      : 0;

    const buckets: BudgetBucketDto[] = [...bucketRows]
      .sort(
        (a, b) =>
          (BudgetService.BUCKET_ORDER[a.name] ?? 99) -
          (BudgetService.BUCKET_ORDER[b.name] ?? 99),
      )
      .map((row) => ({
        name: row.name,
        target_pct: formatPercent(row.targetPct),
        actual_pct: formatPercent(row.actualPct),
        amount: formatMoney(row.amount),
      }));

    const categories: BudgetCategoryDto[] = categoryRows.map((row) => ({
      name: row.name,
      amount: formatMoney(row.amount),
      bucket: row.bucket,
    }));

    const monthly: MonthlyNeedsWantsDto[] = monthlyRows.map((row) => ({
      month: row.month,
      needs: formatMoney(row.needs),
      wants: formatMoney(row.wants),
    }));

    const recurring: RecurringChargeDto[] = recurringRows.map((row) => ({
      merchant: row.merchant,
      category: row.category,
      cadence: row.cadence,
      last_charged: formatDate(row.lastCharged),
      monthly_est: formatMoney(row.monthlyEst),
    }));

    return {
      savings_rate,
      effective_tax_rate,
      buckets,
      categories,
      monthly,
      recurring,
    };
  }
}

/**
 * Render a percentage as a JSON NUMBER, 0-100, one decimal (Appendix A / DA-22).
 *
 * Postgres returns a `numeric` column as a STRING; we quantize to one decimal
 * place and return a `number` so the wire form is a JSON number byte-identical
 * to FastAPI's `float(Decimal.quantize("0.1"))` (e.g. `22.0` -> `22`, `18.5`).
 */
export function formatPercent(value: string): number {
  return Number(Number(value).toFixed(1));
}
