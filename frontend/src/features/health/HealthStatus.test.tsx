import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import HealthStatus from './HealthStatus';

// Mock ONLY the network boundary (the api module). The real component
// tree renders; React internals are not mocked.
vi.mock('../../lib/api', () => ({
  apiBaseUrl: 'http://localhost:8000',
  getHealth: vi.fn(),
}));

import { getHealth } from '../../lib/api';

const getHealthMock = vi.mocked(getHealth);

describe('HealthStatus', () => {
  beforeEach(() => {
    getHealthMock.mockReset();
  });

  it('shows the loading state before the health check resolves', () => {
    // Never-resolving promise keeps the component in the loading phase.
    getHealthMock.mockReturnValue(new Promise(() => {}));

    render(<HealthStatus />);

    // role="status" live region is present with loading text.
    expect(screen.getByRole('status')).toHaveTextContent(
      /checking backend health/i,
    );
  });

  it('transitions from loading to success and shows status: ok', async () => {
    getHealthMock.mockResolvedValue({ status: 'ok' });

    render(<HealthStatus />);

    // Observable success behavior: visible text reporting status ok.
    expect(
      await screen.findByText(/status:\s*ok/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/checking backend health/i)).toBeNull();
  });

  it('renders the error state with an alert when the health check fails', async () => {
    getHealthMock.mockRejectedValue(new Error('Network down'));

    render(<HealthStatus />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not reach backend/i);
    expect(alert).toHaveTextContent(/network down/i);
  });

  it('shows which API base URL is in use (backend-neutral)', () => {
    getHealthMock.mockReturnValue(new Promise(() => {}));

    render(<HealthStatus />);

    expect(screen.getByText('http://localhost:8000')).toBeInTheDocument();
  });
});
