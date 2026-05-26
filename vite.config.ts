import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/solid-start/plugin/vite';
import { defineConfig } from 'vite-plus';
import viteSolid from 'vite-plugin-solid';

const toolIgnorePatterns = ['output/**', 'src/routeTree.gen.ts', 'src/app/bagit/wasm-pkg/**'];

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  fmt: {
    ignorePatterns: toolIgnorePatterns,
    semi: true,
    singleQuote: true,
  },
  lint: {
    ignorePatterns: toolIgnorePatterns,
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 4002,
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    viteSolid({ ssr: true }),
  ],
});
