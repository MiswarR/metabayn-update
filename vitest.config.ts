import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'metabayn-backend/**', 'src-tauri/**'],
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80
      },
      include: ['src/utils/modelVisionFilter.ts', 'src/utils/gatewayBalance.ts'],
    },
  },
});
