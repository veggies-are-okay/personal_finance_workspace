import { InsightCallout } from '../../components/InsightCallout';
import { MeterRow } from '../../components/MeterRow';
import { PageHeader } from '../../components/PageHeader';
import { Panel } from '../../components/Card';
import { ScreenState } from '../../components/ScreenState';
import { StatCard, StatRow } from '../../components/StatCard';
import { getGoals } from '../../lib/api';
import { formatMoney, formatPercent } from '../../lib/format';
import type { Goals } from '../../lib/types';
import { useApi } from '../../lib/useApi';

function isEmpty(g: Goals): boolean {
  return g.funding.length === 0 && Number.parseFloat(g.target) === 0;
}

export function GoalsScreen() {
  const state = useApi<Goals>(getGoals, [], { isEmpty });

  return (
    <>
      <PageHeader
        title="Home Down Payment"
        subtitle="Tracking toward a 20% down payment — and what you can afford."
      />
      <ScreenState
        state={state}
        emptyTitle="No goal set yet"
        emptyBody="Once your accounts are connected, your savings progress and affordability will appear here."
      >
        {(goals) => <GoalsBody goals={goals} />}
      </ScreenState>
    </>
  );
}

function GoalsBody({ goals }: { goals: Goals }) {
  const remaining = (
    Number.parseFloat(goals.target) - Number.parseFloat(goals.saved)
  ).toFixed(2);
  const monthly = goals.funding.find((f) => /month/i.test(f.source));

  return (
    <>
      <StatRow>
        <StatCard label="Target" value={formatMoney(goals.target, { compact: true })} />
        <StatCard label="Saved" value={formatMoney(goals.saved, { compact: true })} />
        <StatCard label="Progress" value={formatPercent(goals.progress_pct)} />
        <StatCard
          label="Still to save"
          value={formatMoney(remaining, { compact: true })}
        />
      </StatRow>

      <InsightCallout>
        You are <strong>{formatPercent(goals.progress_pct)}</strong> of the way to a{' '}
        {formatMoney(goals.target, { compact: true })} down payment.
        {monthly && (
          <>
            {' '}
            At {formatMoney(monthly.amount)}/mo, the remaining{' '}
            {formatMoney(remaining, { compact: true })} is within reach.
          </>
        )}
      </InsightCallout>

      <Panel title="Down-payment progress">
        <MeterRow
          label="Saved toward target"
          actualPct={goals.progress_pct}
          amount={`${formatMoney(goals.saved, { compact: true })} of ${formatMoney(goals.target, { compact: true })}`}
          colorClass="bg-brand-500"
        />
        <ul className="mt-5 flex flex-col gap-2.5">
          {goals.funding.map((f) => (
            <li key={f.source} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-slate-700 dark:text-slate-200">{f.source}</span>
              <span className="tabular-nums text-slate-600 dark:text-slate-300">
                {formatMoney(f.amount)}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Affordability snapshot">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <AffordabilityItem label="Target price" value={formatMoney(goals.affordability.price, { compact: true })} />
          <AffordabilityItem label="Down payment" value={formatMoney(goals.affordability.down_payment, { compact: true })} />
          <AffordabilityItem label="Mortgage" value={formatMoney(goals.affordability.mortgage, { compact: true })} />
          <AffordabilityItem label="Monthly PITI" value={formatMoney(goals.affordability.monthly_piti)} />
          <AffordabilityItem label="Share of income" value={formatPercent(goals.affordability.income_share)} />
        </dl>
      </Panel>
    </>
  );
}

function AffordabilityItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums text-slate-900 dark:text-slate-50">
        {value}
      </dd>
    </div>
  );
}
