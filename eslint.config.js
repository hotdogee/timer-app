import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import svelte from 'eslint-plugin-svelte'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import ts from 'typescript-eslint'

import svelteConfig from './svelte.config.js'

export default defineConfig(
  globalIgnores(['dist/', 'coverage/', 'src-tauri/target/', 'src-tauri/gen/']),
  js.configs.recommended,
  ts.configs.recommendedTypeChecked,
  ts.configs.stylisticTypeChecked,
  svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: {
          // Root config files are outside tsconfig.json; type them with tsconfig.node.json.
          allowDefaultProject: ['*.js', '*.ts'],
          defaultProject: 'tsconfig.node.json',
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    // Components and rune modules: svelte-eslint-parser hands <script lang="ts"> to typescript-eslint.
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        svelteConfig,
      },
    },
  },
  {
    // Root config files run in Node.
    files: ['*.js', '*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // Formatting is Prettier's job: turn off every rule that would fight it. Keep these last.
  prettier,
  svelte.configs.prettier,
)
