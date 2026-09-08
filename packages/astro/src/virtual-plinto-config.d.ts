/**
 * TypeScript declaration for the virtual module provided by the plinto
 * Astro integration. Vite resolves 'virtual:plinto-config' at build time,
 * but TypeScript doesn't know about Vite plugins, so we declare the
 * module's shape here.
 *
 * The config types arrive as inline `import(...)` types rather than an import
 * statement: this file has to stay a global script for `declare module` to be
 * an ambient declaration, and any top-level import would turn it into a module
 * whose `declare module` block is a mere augmentation of something undeclared —
 * which reads, silently, as `any` at every use site.
 */
declare module 'virtual:plinto-config' {
  type ResolvedConfig = import('@plinto/core/resolved-config').ResolvedConfig;

  /**
   * The module is the ResolvedConfig, one named export per member — see
   * lib/resolved-config.ts for what each one holds and why the library takes
   * it as a parameter rather than importing it from here.
   */
  export const i18n: ResolvedConfig['i18n'];
  export const content: ResolvedConfig['content'];
  export const git: ResolvedConfig['git'];
  export const storage: ResolvedConfig['storage'];
  export const partials: ResolvedConfig['partials'];
  /** The adapter's own — see lib/block-imports. */
  export const blockImports: import('./lib/block-imports').BlockImportMap;
  /**
   * The site's own `trailingSlash`, straight off Astro's config. The engine
   * never sees it: it is a fact about URLs, and only lib/urls reads it.
   */
  export const trailingSlash: 'always' | 'never' | 'ignore';
}

/**
 * The site's block registry, in a module of its own because it is the one
 * thing here that cannot be JSON — it is a live re-export of React component
 * references, so importing it pulls every block and, through Puck's field
 * types, Puck. See the comment on VIRTUAL_BLOCKS_ID in integration.ts for what
 * that cost while it shared a module with the config.
 */
declare module 'virtual:plinto-blocks' {
  export const blocks: import('./config').BlockRegistry;
}

/**
 * The site's preview shell, in a module of its own so that virtual:plinto-config
 * never depends on site code that depends back on the library — see the comment
 * on VIRTUAL_PREVIEW_ID in integration.ts.
 */
declare module 'virtual:plinto-preview' {
  /** Default export of the site's previewPath module, or null if it has none. */
  export const previewShell:
    import('react').ComponentType<{ children?: import('react').ReactNode }> | null;
}
