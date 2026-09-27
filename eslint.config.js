import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  // Type-checked rules: CLAUDE.md requires strict TypeScript, and the cheap
  // syntactic ruleset cannot see the type errors that actually matter here.
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // CLAUDE.md: no `any` escape without a comment justifying it. The rule
      // stays an error; a justified escape uses an inline disable with a reason.
      '@typescript-eslint/no-explicit-any': 'error',
      // Functional over OOP — flag mutation of function parameters.
      'no-param-reassign': ['error', { props: true }],
      // Early returns over nesting.
      'no-else-return': ['error', { allowElseIf: false }],
      // `type` over `interface`: this codebase leans on discriminated unions and
      // readonly object types, which interfaces express worse.
      '@typescript-eslint/consistent-type-definitions': 'off',
    },
  },
  {
    // Tests may reach for shapes the production rules forbid.
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // Config files are not covered by tsconfig's `include`.
    files: ['*.js', '*.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
