/**
 * TypeORM entities — a 1:1 MIRROR of the Alembic-owned Postgres schema (P2.3).
 *
 * Alembic (backend-python) is the CANONICAL owner of the schema; these entities
 * only mirror it and run with `synchronize: false` so TypeORM never alters the
 * schema out from under Alembic. A schema-parity check in `contracts/` asserts
 * these entities and the Alembic head stay identical (tables + columns + types)
 * — see DA-8.
 *
 * Column-type conventions (Appendix A of plans/agent_checklist.md), matched
 * column-for-column to backend-python/app/models.py:
 *  - Money       -> numeric(14, 2)        (decimal-string on the wire)
 *  - Percentage  -> numeric (unscaled)    (a number 0-100 on the wire)
 *  - Datetimes   -> timestamptz; dates -> date
 *  - Enums       -> text + a CHECK constraint over the canonical registry
 *  - Plaid token -> bytea (encrypted ciphertext; encryption is P6.1)
 *
 * The CHECK constraints are declared via @Check so they appear in TypeORM's
 * metadata; the schema-parity check focuses on tables/columns/types (the
 * canonical enum registry itself is asserted in the OpenAPI contract).
 */

import { Check, Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

// Canonical enum registries (Appendix A) — kept here so the CHECK constraints
// match backend-python/app/models.py exactly.
const BUCKET = "('needs', 'wants', 'savings')";
const SOURCE = "('transactions', 'income', 'holdings', 'loans', 'listings')";
const SOURCE_MODE = "('local', 'api')";
const ITEM_STATUS =
  "('connected', 'needs_reauth', 'error', 'disconnected', 'not_connected')";
const LOAN_PRIORITY = "('pay_first', 'then', 'minimums')";

@Entity({ name: 'accounts' })
export class AccountEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  type!: string;

  @Column({ type: 'text', nullable: true })
  institution!: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  balance!: string | null;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency!: string;
}

@Entity({ name: 'transactions' })
@Unique('uq_transactions_dedupe_key', ['dedupeKey'])
@Check('ck_transactions_bucket', `bucket IN ${BUCKET}`)
export class TransactionEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'account_id', type: 'bigint', nullable: true })
  accountId!: string | null;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ name: 'dedupe_key', type: 'text' })
  dedupeKey!: string;

  @Column({ type: 'text', nullable: true })
  category!: string | null;

  @Column({ type: 'text', nullable: true })
  bucket!: string | null;

  @Column({ name: 'is_transfer', type: 'boolean', default: false })
  isTransfer!: boolean;

  @Column({ name: 'is_recurring', type: 'boolean', default: false })
  isRecurring!: boolean;
}

@Entity({ name: 'categories' })
@Unique(['name'])
@Check('ck_categories_bucket', `bucket IN ${BUCKET}`)
export class CategoryEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  bucket!: string;
}

@Entity({ name: 'budgets' })
@Check('ck_budgets_bucket', `bucket IN ${BUCKET}`)
export class BudgetEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  category!: string;

  @Column({ type: 'text' })
  bucket!: string;

  @Column({ name: 'monthly_target', type: 'numeric', precision: 14, scale: 2 })
  monthlyTarget!: string;
}

@Entity({ name: 'loans' })
@Check('ck_loans_priority', `priority IN ${LOAN_PRIORITY}`)
export class LoanEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  balance!: string;

  @Column({ type: 'numeric' })
  rate!: string;

  @Column({ name: 'minimum_payment', type: 'numeric', precision: 14, scale: 2 })
  minimumPayment!: string;

  @Column({ type: 'text' })
  priority!: string;
}

@Entity({ name: 'goals' })
export class GoalEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  target!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  saved!: string;

  @Column({ name: 'progress_pct', type: 'numeric', nullable: true })
  progressPct!: string | null;
}

@Entity({ name: 'holdings' })
export class HoldingEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  symbol!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  value!: string;

  @Column({ type: 'numeric' })
  weight!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  gain!: string;

  @Column({ name: 'asset_class', type: 'text', nullable: true })
  assetClass!: string | null;
}

@Entity({ name: 'budget_aggregates' })
@Unique('uq_budget_aggregates_window', ['window'])
export class BudgetAggregateEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  window!: string;

  @Column({ name: 'savings_rate', type: 'numeric' })
  savingsRate!: string;

  @Column({ name: 'effective_tax_rate', type: 'numeric' })
  effectiveTaxRate!: string;
}

@Entity({ name: 'budget_bucket_aggregates' })
@Check('ck_budget_bucket_aggregates_name', `name IN ${BUCKET}`)
export class BudgetBucketAggregateEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  window!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'target_pct', type: 'numeric' })
  targetPct!: string;

  @Column({ name: 'actual_pct', type: 'numeric' })
  actualPct!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount!: string;
}

@Entity({ name: 'budget_category_aggregates' })
@Check('ck_budget_category_aggregates_bucket', `bucket IN ${BUCKET}`)
export class BudgetCategoryAggregateEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  window!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ type: 'text' })
  bucket!: string;
}

@Entity({ name: 'budget_monthly_aggregates' })
export class BudgetMonthlyAggregateEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  window!: string;

  @Column({ type: 'varchar', length: 7 })
  month!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  needs!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  wants!: string;
}

@Entity({ name: 'recurring_charges' })
export class RecurringChargeEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  merchant!: string;

  @Column({ type: 'text' })
  category!: string;

  @Column({ type: 'text' })
  cadence!: string;

  @Column({ name: 'last_charged', type: 'date' })
  lastCharged!: string;

  @Column({ name: 'monthly_est', type: 'numeric', precision: 14, scale: 2 })
  monthlyEst!: string;
}

@Entity({ name: 'plaid_items' })
@Unique('uq_plaid_items_item_id', ['itemId'])
@Check('ck_plaid_items_status', `status IN ${ITEM_STATUS}`)
export class PlaidItemEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ name: 'item_id', type: 'text' })
  itemId!: string;

  // Encrypted ciphertext (AES-256-GCM; encryption itself is P6.1). Never plaintext.
  @Column({ name: 'access_token', type: 'bytea' })
  accessToken!: Buffer;

  @Column({ type: 'text', nullable: true })
  institution!: string | null;

  @Column({ type: 'text', array: true, nullable: true })
  products!: string[] | null;

  @Column({ type: 'text', default: 'connected' })
  status!: string;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  createdAt!: Date;

  @Column({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  updatedAt!: Date;
}

@Entity({ name: 'source_config' })
@Unique('uq_source_config_source', ['source'])
@Check('ck_source_config_source', `source IN ${SOURCE}`)
@Check('ck_source_config_mode', `mode IN ${SOURCE_MODE}`)
export class SourceConfigEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  source!: string;

  @Column({ type: 'text', default: 'local' })
  mode!: string;
}

/** Every entity, for registration in the TypeORM DataSource / Nest module. */
export const ALL_ENTITIES = [
  AccountEntity,
  TransactionEntity,
  CategoryEntity,
  BudgetEntity,
  LoanEntity,
  GoalEntity,
  HoldingEntity,
  BudgetAggregateEntity,
  BudgetBucketAggregateEntity,
  BudgetCategoryAggregateEntity,
  BudgetMonthlyAggregateEntity,
  RecurringChargeEntity,
  PlaidItemEntity,
  SourceConfigEntity,
];
