import { Badge } from '../../components/Badge';
import { BarChart } from '../../components/BarChart';
import { DataTable } from '../../components/DataTable';
import { InsightCallout } from '../../components/InsightCallout';
import { MeterRow } from '../../components/MeterRow';
import { PageHeader } from '../../components/PageHeader';
import { Panel } from '../../components/Card';
import { ScreenState } from '../../components/ScreenState';
import { StatCard, StatRow } from '../../components/StatCard';
import { getBudget } from '../../lib/api';
import { formatMoney, formatPercent } from '../../lib/format';
import type { Budget, RecurringCharge } from '../../lib/types';
import { useApi } from '../../lib/useApi';

const BUCKET_COLOR = {
  needs: 'bg-sky-500',
  wants: 'bg-amber-500',
  savings: 'bg-brand-500',
} as const;

function isEmpty(b: Budget): boolean {
  return b.buckets.length === 0 && b.categories.length === 0;
}

export function BudgetScreen() {
  const state = useApi<Budget>(() => getBudget('12m'), [], { isEmpty });

  return (
    <>
      <PageHeader
        title="Budget & Spending"
        subtitle="Where your money goes each month, against your 50/30/20 plan."
      />
      <ScreenState
        state={state}
        emptyTitle="No budget yet"
        emptyBody="Connect a transactions source in Data Sources and your 50/30/20 breakdown will appear here."
      >
        {(budget) => <BudgetBody budget={budget} />}
      </ScreenState>
    </>
  );
}

function BudgetBody({ budget }: { budget: Budget }) {
  const savings = budget.buckets.find((b) => b.name === 'savings');
  const needs = budget.buckets.find((b) => b.name === 'needs');

  return (
    <>
      <StatRow>
        <StatCard label="Savings rate" value={formatPercent(budget.savings_rate)} />
        <StatCard
          label="Effective tax rate"
          value={formatPercent(budget.effective_tax_rate)}
        />
        <StatCard
          label="Savings this month"
          value={savings ? formatMoney(savings.amount, { compact: true }) : '—'}
        />
        <StatCard
          label="Needs spend"
          value={needs ? formatMoney(needs.amount, { compact: true }) : '—'}
        />
      </StatRow>

      <InsightCallout>
        You are saving <strong>{formatPercent(budget.savings_rate)}</strong> of your
        take-home — comfortably above the 20% target. Your needs are holding near
        {needs ? ` ${formatPercent(needs.actual_pct)}` : ' target'}, leaving room in
        the wants bucket.
      </InsightCallout>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="50 / 30 / 20 — target vs actual">
          <div className="flex flex-col gap-4">
            {budget.buckets.map((bucket) => (
              <MeterRow
                key={bucket.name}
                label={bucket.name}
                actualPct={bucket.actual_pct}
                targetPct={bucket.target_pct}
                amount={formatMoney(bucket.amount, { compact: true })}
                colorClass={BUCKET_COLOR[bucket.name]}
              />
            ))}
          </div>
        </Panel>

        <Panel title="Top spending categories">
          <ul className="flex flex-col gap-2.5">
            {budget.categories.map((cat) => (
              <li key={cat.name} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 capitalize text-slate-700 dark:text-slate-200">
                  {cat.name}
                  <Badge tone={cat.bucket}>{cat.bucket}</Badge>
                </span>
                <span className="tabular-nums text-slate-600 dark:text-slate-300">
                  {formatMoney(cat.amount)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Spending trend — needs vs wants">
        <BarChart
          title="Monthly needs and wants spending over the last year"
          bars={budget.monthly.map((m) => ({
            label: m.month,
            segments: [
              { label: 'needs', value: m.needs, colorClass: 'bg-sky-400' },
              { label: 'wants', value: m.wants, colorClass: 'bg-amber-400' },
            ],
          }))}
        />
        <div className="mt-3 flex gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-sky-400" /> Needs
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> Wants
          </span>
        </div>
      </Panel>

      <Panel title="Recurring charges">
        <DataTable<RecurringCharge>
          caption="Recurring charges detected from your transactions"
          rowKey={(r) => r.merchant}
          rows={budget.recurring}
          columns={[
            { key: 'merchant', header: 'Merchant', render: (r) => r.merchant },
            {
              key: 'category',
              header: 'Category',
              render: (r) => <Badge>{r.category}</Badge>,
            },
            { key: 'cadence', header: 'Cadence', render: (r) => r.cadence },
            { key: 'last', header: 'Last charged', render: (r) => r.last_charged },
            {
              key: 'est',
              header: 'Monthly est.',
              numeric: true,
              render: (r) => formatMoney(r.monthly_est),
            },
          ]}
        />
      </Panel>
    </>
  );
}
