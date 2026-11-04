/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // config-conventional rejects sentence-case subjects, but the podcaster's repos
    // capitalize them. Enforce the type prefix and the rest of the grammar, not a
    // subject casing.
    'subject-case': [0]
  }
};
