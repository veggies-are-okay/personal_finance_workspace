import { DataTable } from '../../components/DataTable';
import { InsightCallout } from '../../components/InsightCallout';
import { MeterRow } from '../../components/MeterRow';
import { PageHeader } from '../../components/PageHeader';
import { Panel } from '../../components/Card';
import { ScreenState } from '../../components/ScreenState';
import { StatCard, StatRow } from '../../components/StatCard';
import { getInvestments } from '../../lib/api';
import { formatMoney, formatPercent, isNegativeMoney } from '../../lib/format';
import type { Holding, Investments } from '../../lib/types';
import { useApi } from '../../lib/useApi';

const ALLOC_COLOR = ['bg-brand-500', 'bg-sky-500', 'bg-amber-500', 'bg-violet-500'];

function isEmpty(inv: Investments): boolean {
  return inv.holdings.length === 0 && inv.allocation.length === 0;
}

export function InvestmentsScreen() {
  const state = useApi<Investments>(getInvestments, [], { isEmpty });

  return (
    <>
      <PageHeader
        title="Investments"
        subtitle="Your brokerage holdings, allocation, and concentration."
      />
      <ScreenState
        state={state}
        emptyTitle="No holdings yet"
        emptyBody="Connect a brokerage source in Data Sources to see allocation, gains, and concentration."
      >
        {(inv) => <InvestmentsBody inv={inv} />}
      </ScreenState>
    </>
  );
}

function InvestmentsBody({ inv }: { inv: Investments }) {
  const topWeight = inv.concentration[0];
  return (
    <>
      <StatRow>
        <StatCard
          label="Portfolio value"
          value={formatMoney(inv.portfolio_value, { compact: true })}
        />
        <StatCard
          label="Unrealized gain"
          value={formatMoney(inv.unrealized_gain, { compact: true })}
          tone={isNegativeMoney(inv.unrealized_gain) ? 'down' : 'up'}
        />
        <StatCard
          label="Top holding weight"
          value={topWeight ? formatPercent(topWeight.weight) : '—'}
        />
        <StatCard label="Holdings" value={String(inv.holdings.length)} />
      </StatRow>

      <InsightCallout>
        {topWeight ? (
          <>
            Your largest single position, <strong>{topWeight.holding}</strong>, is{' '}
            {formatPercent(topWeight.weight)} of the portfolio. Equities are running near
            target; consider whether that concentration matches your risk tolerance.
          </>
        ) : (
          <>Your allocation is close to target across asset classes.</>
        )}
      </InsightCallout>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Allocation vs target">
          <div className="flex flex-col gap-4">
            {inv.allocation.map((a, i) => (
              <MeterRow
                key={a.class}
                label={a.class}
                actualPct={a.actual_pct}
                targetPct={a.target_pct}
                amount={formatMoney(a.amount, { compact: true })}
                colorClass={ALLOC_COLOR[i % ALLOC_COLOR.length]}
              />
            ))}
          </div>
        </Panel>

        <Panel title="Concentration">
          <ul className="flex flex-col gap-2.5">
            {inv.concentration.map((c) => (
              <li key={c.holding} className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {c.holding}
                </span>
                <span className="tabular-nums text-slate-600 dark:text-slate-300">
                  {formatPercent(c.weight)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Holdings">
        <DataTable<Holding>
          caption="Each holding with its value, portfolio weight, and unrealized gain"
          rowKey={(h) => h.symbol}
          rows={inv.holdings}
          columns={[
            { key: 'symbol', header: 'Symbol', render: (h) => h.symbol },
            { key: 'name', header: 'Holding', render: (h) => h.name },
            {
              key: 'value',
              header: 'Value',
              numeric: true,
              render: (h) => formatMoney(h.value),
            },
            {
              key: 'weight',
              header: 'Weight',
              numeric: true,
              render: (h) => formatPercent(h.weight),
            },
            {
              key: 'gain',
              header: 'Gain',
              numeric: true,
              render: (h) => (
                <span
                  className={
                    isNegativeMoney(h.gain)
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-brand-700 dark:text-brand-400'
                  }
                >
                  {formatMoney(h.gain)}
                </span>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}
