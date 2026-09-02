/**
 * Test double for virtual:plinto-blocks.
 *
 * Separate from the config double for the same reason the real modules are
 * separate: this one holds live component references, and a test that only
 * needs `content.pagesDir` should not drag a block registry in behind it.
 *
 * Empty by default. A test that needs real blocks says so — see
 * mdx/__tests__/corpus.test.ts, which mocks richtext-fields directly rather
 * than pretending the registry is populated.
 */
export const blocks = {};
