/**
 * SinapsAI - In-Process AI Gateway & Control Plane
 *
 * @author Roedy Rustam <roedyrustam.id@gmail.com>
 * @copyright 2026 Roedy Rustam
 * @license MIT
 */

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  banner: {
    js: '/**\n * SinapsAI - In-Process AI Gateway & Control Plane\n *\n * @author Roedy Rustam <roedyrustam.id@gmail.com>\n * @copyright 2026 Roedy Rustam\n * @license MIT\n */',
  },
});
