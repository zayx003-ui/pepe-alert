import { defineConfig } from 'vitest/config';

// base relative : le build fonctionne aussi bien sur https://<user>.github.io/<repo>/
// que sur un domaine racine ou en local.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
  server: { port: 5173, strictPort: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
});
