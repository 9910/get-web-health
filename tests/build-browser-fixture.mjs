import { build } from 'esbuild';
import { mkdir,copyFile,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
await mkdir('.qa',{recursive:true});
await build({ entryPoints:['src/app.js'], bundle:true, format:'esm',target:'es2022',outfile:'.qa/app.js',alias:{'@supabase/supabase-js':path.resolve('tests/browser-client.js')},define:{__SUPABASE_URL__:JSON.stringify('local-ui-test'),__SUPABASE_KEY__:JSON.stringify('local-ui-test')} });
await copyFile('src/styles.css','.qa/styles.css'); await copyFile('src/icon.svg','.qa/icon.svg');
await writeFile('.qa/index.html',(await readFile('src/index.html','utf8')).replace('<title>','<title>LOCAL UI TEST — '));
console.log('Built isolated local UI fixture. No Supabase calls, no real users.');
