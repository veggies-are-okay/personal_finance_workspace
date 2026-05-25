/**
 * One source row on the Settings screen: title + purpose, the Local↔API toggle,
 * the local file / live provider columns, a status badge, and the right
 * affordance (Connect / Reconnect, or none when connected).
 *
 * Mirrors the Settings wireframe card in `pencil/website_wire.pen`.
 */

import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import type { SourceConnection } from '../../lib/types';
import { ConnectButton } from './ConnectButton';
import { ModeToggle } from './ModeToggle';
import { SOURCE_META, SOURCE_TO_INGEST, STATUS_META } from './sourceMeta';
import { UploadControl } from './UploadControl';

export function SourceCard({
  connection,
  onChanged,
}: {
  connection: SourceConnection;
  /** Refresh the connections snapshot after a connect / mode switch. */
  onChanged?: () => void;
}) {
  const meta = SOURCE_META[connection.source];
  const status = STATUS_META[connection.status];
  const ingestSource = SOURCE_TO_INGEST[connection.source];

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {meta.label}
            </h3>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {meta.purpose}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ModeToggle
            source={connection.source}
            mode={connection.mode}
            onModeChanged={onChanged}
          />
          <ConnectButton
            affordance={status.affordance}
            products={meta.products}
            onConnected={onChanged}
          />
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Local file
          </dt>
          <dd className="mt-0.5 break-all font-mono text-xs text-slate-700 dark:text-slate-300">
            {meta.localFile}
          </dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Live API
          </dt>
          <dd className="mt-0.5 text-xs text-slate-700 dark:text-slate-300">
            {meta.provider}
          </dd>
        </div>
      </dl>

      {ingestSource && (
        <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Upload a file
          </h4>
          <UploadControl source={ingestSource} onIngested={onChanged} />
        </div>
      )}
    </Card>
  );
}
