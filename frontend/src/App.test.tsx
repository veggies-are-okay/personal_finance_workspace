import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

// Mock the network boundary so App mounts without real fetches.
vi.mock('./lib/api', () => ({
  apiBaseUrl: 'http://localhost:8000',
  getHealth: vi.fn().mockResolvedValue({ status: 'ok' }),
}));

describe('App', () => {
  it('renders the page heading and the health section', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: /personal finance/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /backend health/i }),
    ).toBeInTheDocument();
  });
});
