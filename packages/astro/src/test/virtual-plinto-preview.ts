/**
 * Test double for virtual:plinto-preview. In a running site the integration
 * re-exports the site's own shell module; under vitest there is none, and a
 * site without one is a supported configuration — the canvas is shown on its
 * own rather than the library inventing a shell.
 */
export const previewShell = null;
