import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
const url = process.env.PUBLIC_SUPABASE_URL || 'https://ywkeuvdhtrmhtsugbntj.supabase.co';
const key = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_VWt8S3XXbT1wczmClNum9Q_xc8DMUu4';
if (!url.startsWith('https://') || !key || key.startsWith('sb_secret_')) throw new Error('Use a Supabase HTTPS project URL and browser-safe publishable key.');
if (key.startsWith('eyJ')) {
  const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  if (payload.role !== 'anon') throw new Error('Only a publishable or legacy anon key can be bundled.');
}
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'esm', target: 'es2022', outfile: 'dist/app.js', define: { __SUPABASE_URL__: JSON.stringify(url), __SUPABASE_KEY__: JSON.stringify(key) } });
await copyFile('src/styles.css', 'dist/styles.css');
await copyFile('src/icon.svg', 'dist/icon.svg');
await copyFile('sdk/express.mjs', 'dist/express.mjs');
await writeFile('dist/index.html', await readFile('src/index.html', 'utf8'));
await build({ entryPoints: ['supabase/functions/health-worker/index.ts'], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', external: ['npm:*'], outfile: 'supabase/dashboard-worker.js' });
console.log('Built Get Web Health into dist/. Only public Supabase credentials are included.');
