/**
 * Settings / Data Sources screen.
 *
 * Reads `GET /api/v1/connections` and renders one card per source with its
 * Local↔API mode and `item_status`, plus a summary of linked Plaid Items. Each
 * card offers the right affordance (Connect / Reconnect) and a mode toggle.
 *
 * The Plaid Link flow lives in the isolated `features/connections/` module
 * (`usePlaidConnect`), which is mocked in dev/tests so no real Plaid Link opens
 * (DATA PRIVACY). When connecting/switching succeeds we `reload()` the snapshot.
 *
 * Mirrors the Settings wireframe in `pencil/website_wire.pen`.
 */

import { Badge } from '../../components/Badge';
import { InsightCallout } from '../../components/InsightCallout';
import { PageHeader } from '../../components/PageHeader';
import { Panel } from '../../components/Card';
import { ScreenState } from '../../components/ScreenState';
import { getConnections } from '../../lib/api';
import type { ConnectionItem, ConnectionsList } from '../../lib/types';
import { useApi } from '../../lib/useApi';
import { SOURCE_META, STATUS_META, UPLOAD_META } from './sourceMeta';
import { SourceCard } from './SourceCard';
import { UploadControl } from './UploadControl';

export function SettingsScreen() {
  // `keepDataOnReload` so an upload's success summary survives the invalidation
  // refetch (a child UploadControl calls `onIngested` -> reload; without this
  // the subtree would remount and the "loaded N rows" message would vanish).
  const state = useApi<ConnectionsList>(() => getConnections(), [], {
    keepDataOnReload: true,
  });

  return (
    <>
      <PageHeader
        title="Data sources & connections"
        subtitle="Flip each source between a local file and a live API. Connect an account once and your screens update automatically."
      />
      <ScreenState
        state={state}
        emptyTitle="No data sources yet"
        emptyBody="Nothing is connected. Connect a source below to start syncing, or keep it on a local file."
      >
        {(connections) => (
          <ConnectionsBody connections={connections} onChanged={state.reload} />
        )}
      </ScreenState>
    </>
  );
}

function ConnectionsBody({
  connections,
  onChanged,
}: {
  connections: ConnectionsList;
  onChanged: () => void;
}) {
  const needsAttention = connections.sources.filter(
    (s) => s.status === 'needs_reauth' || s.status === 'error',
  );

  return (
    <div className="flex flex-col gap-6">
      {needsAttention.length > 0 ? (
        <InsightCallout>
          {needsAttention.length === 1
            ? 'One source needs your attention — reconnect it to keep its data fresh.'
            : `${needsAttention.length} sources need your attention — reconnect them to keep their data fresh.`}
        </InsightCallout>
      ) : (
        <InsightCallout>
          All connected sources are syncing. Switch any source to a local file
          anytime — your screens stay on the same contract.
        </InsightCallout>
      )}

      <section className="flex flex-col gap-4" aria-label="Data sources">
        {connections.sources.map((connection) => (
          <SourceCard
            key={connection.source}
            connection={connection}
            onChanged={onChanged}
          />
        ))}
      </section>

      <AccountsUploadCard onChanged={onChanged} />

      <LinkedItems items={connections.items} />
    </div>
  );
}

/**
 * `accounts` is an ingest source (an `accounts.yaml` snapshot powering Net
 * Worth) with no Plaid/connections row, so it gets a standalone upload card
 * rather than a `SourceCard`.
 */
function AccountsUploadCard({ onChanged }: { onChanged: () => void }) {
  const meta = UPLOAD_META.accounts;
  return (
    <Panel title={meta.label}>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{meta.purpose}</p>
      <UploadControl source="accounts" onIngested={onChanged} />
    </Panel>
  );
}

function LinkedItems({ items }: { items: ConnectionItem[] }) {
  if (items.length === 0) {
    return (
      <Panel title="Linked accounts">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No accounts linked yet. Connect a source above to link an institution.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Linked accounts">
      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const status = STATUS_META[item.status];
          return (
            <li
              key={item.item_id}
              className="flex flex-col gap-2 rounded-lg border border-slate-200 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800"
            >
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {item.institution}
                  </span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {item.sources.map((s) => SOURCE_META[s].label).join(' · ')}
                </span>
              </div>
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {item.last_synced
                  ? `Last synced ${item.last_synced.slice(0, 10)}`
                  : 'Never synced'}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
