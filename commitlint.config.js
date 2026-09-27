/**
 * Conventional commits. These types are also what the changeset workflow in
 * issue #3 will read when generating changelogs.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [1, 'always', 100],
  },
};
