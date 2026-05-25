import type { ReactNode } from 'react';

/**
 * The plain-language insight banner that appears on every screen (and composes
 * the Story home). The UI reserves this space for the deferred LangGraph/Gemini
 * insight client; for now the copy is derived deterministically from the data.
 *
 * Accessibility: rendered as an aside with a descriptive label; the lightbulb
 * glyph is decorative (aria-hidden).
 */
export function InsightCallout({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <aside
      aria-label="Insight"
      className="flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-slate-700 sm:flex-row sm:items-center sm:justify-between dark:border-brand-900 dark:bg-brand-900/20 dark:text-slate-200"
    >
      <p className="flex items-start gap-2">
        <span aria-hidden="true">💡</span>
        <span>{children}</span>
      </p>
      {action}
    </aside>
  );
}
