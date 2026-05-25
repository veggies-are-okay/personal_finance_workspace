import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { ThemeProvider } from './lib/theme';
import { AppRoutes } from './App';

function renderApp(route = '/') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[route]}>
        <AppRoutes />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('App shell', () => {
  it('renders the sidebar with all six nav items and a Data Sources placeholder', () => {
    renderApp();
    const nav = screen.getByRole('navigation', { name: /primary/i });
    for (const label of [
      'Story',
      'Budget',
      'Net Worth',
      'Investments',
      'Debt',
      'Goals',
    ]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    // Settings/Data Sources is a disabled placeholder until P5.2.
    const placeholder = within(nav).getByText(/data sources/i);
    expect(placeholder).toHaveAttribute('aria-disabled', 'true');
  });

  it('routes to the Story home by default', async () => {
    renderApp('/');
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: /your financial story/i }),
      ).toBeInTheDocument(),
    );
  });

  it('navigates to another screen when a nav link is clicked', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await user.click(screen.getByRole('link', { name: 'Debt' }));
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: /debt payoff/i }),
      ).toBeInTheDocument(),
    );
  });

  it('renders a not-found screen for an unknown route', () => {
    renderApp('/nope');
    expect(
      screen.getByRole('heading', { level: 1, name: /page not found/i }),
    ).toBeInTheDocument();
  });

  it('toggles the theme and reflects it on the document element', async () => {
    const user = userEvent.setup();
    renderApp();
    const toggle = screen.getByRole('button', { name: /theme/i });
    const before = document.documentElement.classList.contains('dark');
    await user.click(toggle);
    expect(document.documentElement.classList.contains('dark')).toBe(!before);
  });

  it('exposes a skip-to-content link for keyboard users', () => {
    renderApp();
    expect(
      screen.getByRole('link', { name: /skip to content/i }),
    ).toHaveAttribute('href', '#main-content');
  });
});

describe('AppLayout', () => {
  it('renders a main landmark', () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <AppLayout />
        </MemoryRouter>
      </ThemeProvider>,
    );
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
