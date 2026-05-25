import type { ReactNode } from 'react';

export interface Column<Row> {
  key: string;
  header: string;
  /** Right-align numeric columns. */
  numeric?: boolean;
  render: (row: Row) => ReactNode;
}

/** A simple, accessible data table used by every screen's detail section. */
export function DataTable<Row>({
  columns,
  rows,
  caption,
  rowKey,
}: {
  columns: Column<Row>[];
  rows: Row[];
  caption: string;
  rowKey: (row: Row, index: number) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-slate-200 text-left dark:border-slate-800">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`pb-2 pr-4 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                  col.numeric ? 'text-right' : ''
                }`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className="border-b border-slate-100 last:border-0 dark:border-slate-800/60"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`py-2.5 pr-4 text-slate-700 dark:text-slate-200 ${
                    col.numeric ? 'text-right tabular-nums' : ''
                  }`}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
