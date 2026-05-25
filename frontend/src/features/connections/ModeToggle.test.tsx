import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { apiBaseUrl } from '../../lib/api';
import { server } from '../../mocks/server';
import { connectionsFixture } from '../../mocks/fixtures';
import { ModeToggle } from './ModeToggle';

const MODE_URL = `${apiBaseUrl}/api/v1/connections/source-mode`;

describe('ModeToggle', () => {
  it('renders a radiogroup with the current mode checked', () => {
    render(<ModeToggle source="transactions" mode="api" />);
    expect(screen.getByRole('radio', { name: /live api/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /local file/i })).not.toBeChecked();
  });

  it('calls the connections API with the new mode and notifies on success', async () => {
    const user = userEvent.setup();
    let received: { source?: string; mode?: string } = {};

    server.use(
      http.post(MODE_URL, async ({ request }) => {
        received = (await request.json()) as { source: string; mode: string };
        return HttpResponse.json({
          ...connectionsFixture,
          sources: connectionsFixture.sources.map((s) =>
            s.source === received.source ? { ...s, mode: received.mode } : s,
          ),
        });
      }),
    );

    const changed: string[] = [];
    render(
      <ModeToggle
        source="holdings"
        mode="api"
        onModeChanged={(next) => changed.push(next)}
      />,
    );

    await user.click(screen.getByRole('radio', { name: /local file/i }));

    // The request fired with the right source + target mode (not just a render).
    await waitFor(() => expect(received.source).toBe('holdings'));
    expect(received.mode).toBe('local');
    await waitFor(() => expect(changed).toEqual(['local']));
  });

  it('does not call the API when clicking the already-selected mode', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.post(MODE_URL, () => {
        calls += 1;
        return HttpResponse.json(connectionsFixture);
      }),
    );

    render(<ModeToggle source="loans" mode="local" />);
    await user.click(screen.getByRole('radio', { name: /local file/i }));
    // Give any (incorrect) request a tick to fire.
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBe(0);
  });

  it('shows an inline error when the switch fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(MODE_URL, () =>
        HttpResponse.json(
          { error: { code: 'SERVICE_UNAVAILABLE', message: 'down', details: [] } },
          { status: 503 },
        ),
      ),
    );

    render(<ModeToggle source="income" mode="local" />);
    await user.click(screen.getByRole('radio', { name: /live api/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/could not switch mode/i),
    );
  });
});
