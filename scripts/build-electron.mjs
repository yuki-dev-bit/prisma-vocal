#!/usr/bin/env node
/**
 * Compila o processo principal e o preload para CJS em `dist-electron/`.
 * Usa esbuild (rápido, sem bundler pesado) e mantém `electron` como externo.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  external: ['electron'],
  sourcemap: process.env.NODE_ENV === 'development' ? 'inline' : false,
  minify: process.env.NODE_ENV === 'production',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
};

const targets = [
  {
    entryPoints: [path.join(root, 'electron/main.ts')],
    outfile: path.join(root, 'dist-electron/main.cjs'),
  },
  {
    entryPoints: [path.join(root, 'electron/preload.ts')],
    outfile: path.join(root, 'dist-electron/preload.cjs'),
  },
];

for (const target of targets) {
  if (watch) {
    const ctx = await import('esbuild').then((m) => m.context({ ...shared, ...target }));
    await ctx.watch();
  } else {
    await build({ ...shared, ...target });
  }
}

if (!watch) console.log('[build-electron] dist-electron/main.cjs + preload.cjs prontos');
