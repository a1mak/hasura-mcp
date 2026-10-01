import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-param-reassign': ['error', { props: true }],
      'no-else-return': ['error', { allowElseIf: false }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Off because this codebase leans on discriminated unions and readonly
      // object types, which `interface` expresses worse.
      '@typescript-eslint/consistent-type-definitions': 'off',
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Vitest's asymmetric matchers (expect.any, expect.stringContaining) are
      // typed as `any`, so every assertion using one trips this.
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  {
    // Not covered by tsconfig's `include`, so type-aware rules cannot run.
    files: ['*.js', '*.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
