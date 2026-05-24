import HealthStatus from './features/health/HealthStatus';

function App() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Personal Finance
          </h1>
          <p className="mt-2 text-slate-600 dark:text-slate-300">
            Local-first, backend-neutral frontend. It renders the
            configured backend&rsquo;s <code>/health</code> result below.
          </p>
        </header>

        <HealthStatus />
      </div>
    </main>
  );
}

export default App;
