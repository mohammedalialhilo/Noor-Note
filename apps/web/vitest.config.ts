import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { environment: 'node', exclude: [...configDefaults.exclude, 'e2e/**'] },
});
