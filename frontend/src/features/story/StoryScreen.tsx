import { Link } from 'react-router-dom';
import { InsightCallout } from '../../components/InsightCallout';
import { PageHeader } from '../../components/PageHeader';
import { Card } from '../../components/Card';
import { ScreenState } from '../../components/ScreenState';
import { StatCard, StatRow } from '../../components/StatCard';
import { getBudget, getDebt, getGoals, getInvestments, getNetworth } from '../../lib/api';
import { formatMoney, formatPercent } from '../../lib/format';
import type { Budget, Debt, Goals, Investments, NetWorth } from '../../lib/types';
import { useApi } from '../../lib/useApi';

interface StoryData {
  budget: Budget;
  networth: NetWorth;
  investments: Investments;
  debt: Debt;
  goals: Goals;
}

async function loadStory(): Promise<StoryData> {
  const [budget, networth, investments, debt, goals] = await Promise.all([
    getBudget('12m'),
    getNetworth('12m'),
    getInvestments(),
    getDebt('avalanche'),
    getGoals(),
  ]);
  return { budget, networth, investments, debt, goals };
}

function isEmpty(d: StoryData): boolean {
  return (
    d.networth.accounts.length === 0 &&
    d.budget.buckets.length === 0 &&
    d.investments.holdings.length === 0 &&
    d.debt.loans.length === 0
  );
}

export function StoryScreen() {
  const state = useApi<StoryData>(loadStory, [], { isEmpty });

  return (
    <>
      <PageHeader
        title="Your Financial Story"
        subtitle="A connected view of where you stand — and what to do next."
      />
      <ScreenState
        state={state}
        emptyTitle="Let's get connected"
        emptyBody="Connect your first data source in Data Sources and your financial story will start filling in here."
      >
        {(data) => <StoryBody data={data} />}
      </ScreenState>
    </>
  );
}

function StoryBody({ data }: { data: StoryData }) {
  const { budget, networth, investments, debt, goals } = data;
  const avalanche = debt.payoff.find((p) => p.strategy === 'avalanche');

  return (
    <>
      <StatRow>
        <StatCard label="Net worth" value={formatMoney(networth.net_worth, { compact: true })} />
        <StatCard label="Savings rate" value={formatPercent(budget.savings_rate)} />
        <StatCard
          label="Portfolio"
          value={formatMoney(investments.portfolio_value, { compact: true })}
        />
        <StatCard
          label="Goal progress"
          value={formatPercent(goals.progress_pct)}
        />
      </StatRow>

      <InsightCallout>
        You're keeping a healthy{' '}
        <strong>{formatPercent(budget.savings_rate)}</strong> of what you earn, and your
        net worth is{' '}
        <strong>{formatMoney(networth.net_worth, { compact: true })}</strong>. The biggest
        lever this quarter: attack your{' '}
        {formatPercent(debt.tranches[0]?.rate ?? debt.weighted_avg_rate)} debt first while
        the down-payment fund keeps compounding.
      </InsightCallout>

      <section aria-labelledby="explore-heading" className="flex flex-col gap-4">
        <h2
          id="explore-heading"
          className="text-sm font-semibold text-slate-900 dark:text-slate-100"
        >
          Explore your story
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StoryCard
            to="/budget"
            title="Budget"
            metric={formatPercent(budget.savings_rate)}
            note="saving more than you spend — needs and wants both near target."
          />
          <StoryCard
            to="/net-worth"
            title="Net Worth"
            metric={formatMoney(networth.net_worth, { compact: true })}
            note="up over the year, led by retirement and investment growth."
          />
          <StoryCard
            to="/investments"
            title="Investments"
            metric={formatMoney(investments.portfolio_value, { compact: true })}
            note={`${formatMoney(investments.unrealized_gain, { compact: true })} unrealized gain across your holdings.`}
          />
          <StoryCard
            to="/debt"
            title="Debt payoff"
            metric={formatMoney(debt.total, { compact: true })}
            note={
              avalanche
                ? `avalanche gets you debt-free by ${avalanche.debt_free_year}.`
                : 'attack the highest-rate balance first.'
            }
          />
          <StoryCard
            to="/goals"
            title="Home goal"
            metric={formatMoney(goals.target, { compact: true })}
            note={`${formatPercent(goals.progress_pct)} of the way to a 20% down payment.`}
          />
          <StoryCard
            to="/net-worth"
            title="Cash & savings"
            metric={formatMoney(networth.assets, { compact: true })}
            note="total assets working across your accounts."
          />
        </div>
      </section>
    </>
  );
}

function StoryCard({
  to,
  title,
  metric,
  note,
}: {
  to: string;
  title: string;
  metric: string;
  note: string;
}) {
  return (
    <Card className="transition-colors hover:border-brand-300 dark:hover:border-brand-700">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h3>
        <Link
          to={to}
          className="rounded text-sm font-medium text-brand-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:text-brand-400"
        >
          View →
        </Link>
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
        {metric}
      </p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{note}</p>
    </Card>
  );
}
