import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { globalIgnores } from 'eslint/config';

// `eslint-plugin-react-hooks`'s preset configs still declare `plugins` as a
// legacy string array, which ESLint 10 flat config rejects. Register the
// plugin object ourselves and apply its recommended rule set.
const reactHooksRecommendedRules =
  reactHooks.configs['recommended-latest'].rules;

export default tseslint.config([
  globalIgnores(['dist', 'coverage', 'public/mockServiceWorker.js']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      ...reactHooksRecommendedRules,
    },
  },
  {
    // Test files run under Vitest globals (describe/it/expect/vi).
    files: ['**/*.{test,spec}.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.vitest },
    },
  },
]);
