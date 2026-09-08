import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // The integration generates this module in a running site; tests get
      // the fixture double instead.
      'virtual:plinto-config': fileURLToPath(new URL('./src/test/virtual-plinto-config.ts', import.meta.url)),
      'virtual:plinto-blocks': fileURLToPath(new URL('./src/test/virtual-plinto-blocks.ts', import.meta.url)),
      'virtual:plinto-preview': fileURLToPath(new URL('./src/test/virtual-plinto-preview.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
