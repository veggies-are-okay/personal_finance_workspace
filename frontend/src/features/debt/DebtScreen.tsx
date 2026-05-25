import { Badge, type BadgeTone } from '../../components/Badge';
import { DataTable } from '../../components/DataTable';
import { InsightCallout } from '../../components/InsightCallout';
import { MeterRow } from '../../components/MeterRow';
import { PageHeader } from '../../components/PageHeader';
import { Card, Panel } from '../../components/Card';
import { ScreenState } from '../../components/ScreenState';
import { StatCard, StatRow } from '../../components/StatCard';
import { getDebt } from '../../lib/api';
import { formatMoney, formatPercent } from '../../lib/format';
import type { Debt, LoanPriority, Loan } from '../../lib/types';
import { useApi } from '../../lib/useApi';

const PRIORITY_LABEL: Record<LoanPriority, string> = {
  pay_first: 'Pay first',
  then: 'Then',
  minimums: 'Minimums',
};
const PRIORITY_TONE: Record<LoanPriority, BadgeTone> = {
  pay_first: 'warn',
  then: 'neutral',
  minimums: 'neutral',
};
const TRANCHE_COLOR = ['bg-red-500', 'bg-amber-500', 'bg-brand-500'];

function isEmpty(d: Debt): boolean {
  return d.loans.length === 0 && d.tranches.length === 0;
}

export function DebtScreen() {
  const state = useApi<Debt>(() => getDebt('avalanche'), [], { isEmpty });

  return (
    <>
      <PageHeader
        title="Debt Payoff"
        subtitle="Your loans by interest rate, and the smartest payoff order."
      />
      <ScreenState
        state={state}
        emptyTitle="No loans yet"
        emptyBody="Connect a loans source in Data Sources to see balances, rates, and payoff projections."
      >
        {(debt) => <DebtBody debt={debt} />}
      </ScreenState>
    </>
  );
}

function DebtBody({ debt }: { debt: Debt }) {
  const maxBalance = Math.max(
    1,
    ...debt.tranches.map((t) => Math.abs(Number.parseFloat(t.balance))),
  );
  const avalanche = debt.payoff.find((p) => p.strategy === 'avalanche');
  const minimums = debt.payoff.find((p) => p.strategy === 'minimums');

  return (
    <>
      <StatRow>
        <StatCard label="Total debt" value={formatMoney(debt.total, { compact: true })} />
        <StatCard label="Weighted avg rate" value={formatPercent(debt.weighted_avg_rate)} />
        <StatCard label="Monthly minimum" value={formatMoney(debt.monthly_minimum)} />
        <StatCard
          label="Debt-free (avalanche)"
          value={avalanche ? String(avalanche.debt_free_year) : '—'}
        />
      </StatRow>

      <InsightCallout>
        Send every spare dollar at the{' '}
        <strong>{formatPercent(debt.tranches[0]?.rate ?? debt.weighted_avg_rate)}</strong>{' '}
        tranche first.{' '}
        {avalanche && minimums && (
          <>
            Avalanche gets you debt-free in {avalanche.debt_free_year} —{' '}
            {minimums.debt_free_year - avalanche.debt_free_year} years sooner than paying
            minimums, saving{' '}
            {formatMoney(
              (
                Number.parseFloat(minimums.total_interest) -
                Number.parseFloat(avalanche.total_interest)
              ).toFixed(2),
              { compact: true },
            )}{' '}
            in interest.
          </>
        )}
      </InsightCallout>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Loan tranches by interest rate">
          <div className="flex flex-col gap-4">
            {debt.tranches.map((t, i) => (
              <MeterRow
                key={`${t.rate}-${t.priority}`}
                label={`${formatPercent(t.rate)} · ${t.loan_count} loan${t.loan_count === 1 ? '' : 's'}`}
                actualPct={(Math.abs(Number.parseFloat(t.balance)) / maxBalance) * 100}
                amount={formatMoney(t.balance, { compact: true })}
                colorClass={TRANCHE_COLOR[i % TRANCHE_COLOR.length]}
              />
            ))}
          </div>
        </Panel>

        <Panel title="Payoff outlook">
          <div className="grid gap-3 sm:grid-cols-2">
            {debt.payoff.map((p) => (
              <Card key={p.strategy} className="bg-slate-50 dark:bg-slate-800/50">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 capitalize dark:text-slate-400">
                  {p.strategy}
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
                  Debt-free by {p.debt_free_year}
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {formatMoney(p.total_interest, { compact: true })} total interest
                </p>
              </Card>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Loans">
        <DataTable<Loan>
          caption="Each loan with its balance, rate, minimum payment, and payoff priority"
          rowKey={(l) => l.name}
          rows={debt.loans}
          columns={[
            { key: 'name', header: 'Loan', render: (l) => l.name },
            {
              key: 'balance',
              header: 'Balance',
              numeric: true,
              render: (l) => formatMoney(l.balance),
            },
            {
              key: 'rate',
              header: 'Rate',
              numeric: true,
              render: (l) => formatPercent(l.rate),
            },
            {
              key: 'min',
              header: 'Min. payment',
              numeric: true,
              render: (l) => formatMoney(l.minimum_payment),
            },
            {
              key: 'priority',
              header: 'Priority',
              render: (l) => (
                <Badge tone={PRIORITY_TONE[l.priority]}>
                  {PRIORITY_LABEL[l.priority]}
                </Badge>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}
