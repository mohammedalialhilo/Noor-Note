import { build } from 'esbuild';

const entryPoints = [
  'netlify/functions/health.ts',
  'netlify/functions/publish.tsx',
  'netlify/functions/private-share.tsx',
];
const result = await build({
  entryPoints, outdir: 'out/.function-check', bundle: true,
  platform: 'node', target: 'node24', format: 'esm', write: false,
  logLevel: 'silent',
});
if (result.outputFiles?.length !== entryPoints.length || result.errors.length) {
  throw new Error('Netlify Functions could not be bundled.');
}
console.log(`Verified ${entryPoints.length} Netlify Functions bundle for Node 24.`);
