import { BarChart } from '../../components/BarChart';
import { Badge } from '../../components/Badge';
import { DataTable } from '../../components/DataTable';
import { InsightCallout } from '../../components/InsightCallout';
import { PageHeader } from '../../components/PageHeader';
import { Panel } from '../../components/Card';
import { ScreenState } from '../../components/ScreenState';
import { StatCard, StatRow } from '../../components/StatCard';
import { getNetworth } from '../../lib/api';
import { formatDelta, formatMoney, isNegativeMoney } from '../../lib/format';
import type { NetWorth, NetWorthAccount } from '../../lib/types';
import { useApi } from '../../lib/useApi';

function isEmpty(n: NetWorth): boolean {
  return n.accounts.length === 0 && n.series.length === 0;
}

export function NetWorthScreen() {
  const state = useApi<NetWorth>(() => getNetworth('12m'), [], { isEmpty });

  return (
    <>
      <PageHeader
        title="Net Worth & Accounts"
        subtitle="What you own, what you owe, and how it's tracked over time."
      />
      <ScreenState
        state={state}
        emptyTitle="No accounts yet"
        emptyBody="Connect your accounts in Data Sources to track assets, liabilities, and net worth over time."
      >
        {(nw) => <NetWorthBody nw={nw} />}
      </ScreenState>
    </>
  );
}

function NetWorthBody({ nw }: { nw: NetWorth }) {
  const latest = nw.series.at(-1);
  return (
    <>
      <StatRow>
        <StatCard label="Net worth" value={formatMoney(nw.net_worth, { compact: true })} />
        <StatCard
          label="Total assets"
          value={formatMoney(nw.assets, { compact: true })}
        />
        <StatCard
          label="Liabilities"
          value={formatMoney(nw.liabilities, { compact: true })}
        />
        <StatCard
          label="Accounts tracked"
          value={String(nw.accounts.length)}
        />
      </StatRow>

      <InsightCallout>
        Your net worth is{' '}
        <strong>{formatMoney(nw.net_worth, { compact: true })}</strong> — assets of{' '}
        {formatMoney(nw.assets, { compact: true })} against{' '}
        {formatMoney(nw.liabilities, { compact: true })} owed. Most of the growth this
        year came from retirement and investment gains.
      </InsightCallout>

      <Panel title="Net worth over time">
        <BarChart
          title="Net worth composition by month: retirement, investments and cash"
          bars={nw.series.map((p) => ({
            label: p.month,
            segments: [
              { label: 'retirement', value: p.retirement, colorClass: 'bg-brand-600' },
              { label: 'investments', value: p.investments, colorClass: 'bg-brand-400' },
              { label: 'cash', value: p.cash, colorClass: 'bg-slate-300 dark:bg-slate-600' },
            ],
          }))}
        />
        {latest && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Latest month splits into {formatMoney(latest.retirement, { compact: true })}{' '}
            retirement · {formatMoney(latest.investments, { compact: true })} investments ·{' '}
            {formatMoney(latest.cash, { compact: true })} cash.
          </p>
        )}
      </Panel>

      <Panel title="Accounts">
        <DataTable<NetWorthAccount>
          caption="Each tracked account with its balance and 30-day change"
          rowKey={(a) => a.name}
          rows={nw.accounts}
          columns={[
            { key: 'name', header: 'Account', render: (a) => a.name },
            { key: 'type', header: 'Type', render: (a) => <Badge>{a.type}</Badge> },
            {
              key: 'balance',
              header: 'Balance',
              numeric: true,
              render: (a) => formatMoney(a.balance),
            },
            {
              key: 'delta',
              header: '30-day change',
              numeric: true,
              render: (a) => (
                <span
                  className={
                    isNegativeMoney(a.delta_30d)
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-brand-700 dark:text-brand-400'
                  }
                >
                  {formatDelta(a.delta_30d)}
                </span>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}
