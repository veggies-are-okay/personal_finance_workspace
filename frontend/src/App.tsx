import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { ThemeProvider } from './lib/theme';
import { BudgetScreen } from './features/budget/BudgetScreen';
import { DebtScreen } from './features/debt/DebtScreen';
import { GoalsScreen } from './features/goals/GoalsScreen';
import { InvestmentsScreen } from './features/investments/InvestmentsScreen';
import { NetWorthScreen } from './features/networth/NetWorthScreen';
import { StoryScreen } from './features/story/StoryScreen';

function NotFound() {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
        Page not found
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        That screen doesn&rsquo;t exist yet.
      </p>
      <Link
        to="/"
        className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        Back to your story
      </Link>
    </div>
  );
}

/** Client routing for the six core screens, mounted inside the app shell. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<StoryScreen />} />
        <Route path="budget" element={<BudgetScreen />} />
        <Route path="net-worth" element={<NetWorthScreen />} />
        <Route path="investments" element={<InvestmentsScreen />} />
        <Route path="debt" element={<DebtScreen />} />
        <Route path="goals" element={<GoalsScreen />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
