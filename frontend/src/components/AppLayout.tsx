import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

/** The persistent app shell: sidebar rail + scrollable main content. */
export function AppLayout() {
  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-brand-600 focus:px-3 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>
      <Sidebar />
      <main
        id="main-content"
        className="flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-8"
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
