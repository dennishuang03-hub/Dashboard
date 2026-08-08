import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.vercel']),

  /* The browser half. React rules belong here and only here — they are about a
     component tree, and the API routes do not have one. */
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },

  /* The server half. Node globals rather than browser ones: `process`, `Buffer`
     and `console` are real here, and `window` is not — a rule set that had them
     the other way round would be quietly wrong about both. */
  {
    files: ['api/**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
])
