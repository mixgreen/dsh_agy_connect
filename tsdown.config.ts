import { defineConfig } from 'tsdown'

const packageName = 'dsh-agy-connect'

export default defineConfig([
  {
    name: packageName,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    tsconfig: 'tsconfig.json',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      neverBundle: [/^@deepseek-ai\//],
    },
  },
  {
    name: `${packageName}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    tsconfig: 'tsconfig.json',
    fixedExtension: true,
    dts: false,
    clean: false,
    sourcemap: true,
    deps: {
      neverBundle: [/^@deepseek-ai\//, /^react(?:\/|$)/],
    },
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageName)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
    footer: 'return module.exports;\n} });',
  },
])
