import { NavLink } from 'react-router-dom';
import { useTheme } from '../lib/themeContext';
import { NAV_ITEMS } from './navItems';

const baseLink =
  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';
const activeLink =
  'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-200';
const idleLink =
  'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100';

export function Sidebar() {
  const { theme, toggleTheme } = useTheme();

  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-5 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-center gap-2 px-2">
        <span
          aria-hidden="true"
          className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-sm font-bold text-white"
        >
          T
        </span>
        <span className="text-base font-semibold text-slate-900 dark:text-slate-50">
          Throughline
        </span>
      </div>

      <ul className="mt-6 flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={'end' in item ? item.end : undefined}
              className={({ isActive }) =>
                `${baseLink} ${isActive ? activeLink : idleLink}`
              }
            >
              <span aria-hidden="true" className="text-xs">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-col gap-1 border-t border-slate-200 pt-4 dark:border-slate-800">
        {/* Settings / Data Sources is built in P5.2 — placeholder slot for now. */}
        <span
          aria-disabled="true"
          title="Data sources — coming soon"
          className={`${baseLink} ${idleLink} cursor-not-allowed opacity-60`}
        >
          <span aria-hidden="true" className="text-xs">
            ⚙
          </span>
          Data sources
        </span>

        <button
          type="button"
          onClick={toggleTheme}
          className={`${baseLink} ${idleLink} w-full`}
          aria-pressed={theme === 'dark'}
        >
          <span aria-hidden="true" className="text-xs">
            {theme === 'dark' ? '☾' : '☀'}
          </span>
          {theme === 'dark' ? 'Dark theme' : 'Light theme'}
        </button>
      </div>
    </nav>
  );
}
