import { build } from 'esbuild';

await build({
  entryPoints: ['api/_lib/publicBookingServerEntry.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'api/_lib/publicBookingServer.bundle.js',
  legalComments: 'none',
  sourcemap: false,
});
