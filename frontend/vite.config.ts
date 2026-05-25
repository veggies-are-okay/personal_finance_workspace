/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      // Only application source counts toward coverage.
      include: ['src/**/*.{ts,tsx}'],
      // Entry point and non-logic files are excluded per P1.5.
      exclude: [
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/test/**',
        // Dev-only MSW browser worker entry (started from main.tsx, not unit-tested).
        'src/mocks/browser.ts',
        '**/*.d.ts',
        '**/*.config.*',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
