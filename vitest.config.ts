import { defineConfig } from 'vitest/config';

// The combined Pages build checks out staging below this project. Test it only
// in its own workflow step, after its generated fixtures and dependencies exist.
export default defineConfig({
  test: {
    include: [
      'src/**/*.test.{ts,tsx}',
      'scripts/**/*.test.mjs',
      'training/**/*.test.mjs',
      'menu-reader-worker/**/*.test.mjs',
    ],
  },
});
