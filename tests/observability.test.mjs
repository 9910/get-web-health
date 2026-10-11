import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {PGlite} from '@electric-sql/pglite';
import {createWebHealth} from '../sdk/express.mjs';
import {requestSummary} from '../src/observability.js';
const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
test('telemetry ownership, secret columns, quotas and transactional status components',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;insert into auth.users values('${alice}'),('${bob}');`);
 await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/observability.sql',import.meta.url),'utf8'));
 const am=(await db.query(`insert into monitors(user_id,name,url) values('${alice}','A','https://a.onrender.com/health') returning id`)).rows[0].id;
 const bm=(await db.query(`insert into monitors(user_id,name,url) values('${bob}','B','https://b.onrender.com/health') returning id`)).rows[0].id;
 await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${alice}',false)`);
 const app=(await db.query(`insert into telemetry_apps(user_id,name,key_hash) values('${alice}','API','${'a'.repeat(64)}') returning id`)).rows[0].id;
 await assert.rejects(db.query('select key_hash from telemetry_apps'),/permission denied/);
 await assert.rejects(db.exec(`update telemetry_apps set quota_used=0`),/permission denied/);
 await assert.rejects(db.exec(`insert into request_events(app_id,user_id,method,route,status_code,duration_ms) values('${app}','${alice}','GET','/',200,1)`),/permission denied/);
 await assert.rejects(db.query(`select record_telemetry('${app}','[]')`),/permission denied/);
 const page=(await db.query(`insert into status_pages(user_id,title) values('${alice}','My status') returning id,published`)).rows[0];assert.equal(page.published,false);
 await db.query('select set_status_components($1,$2)',[page.id,[am]]);
 await assert.rejects(db.query('select set_status_components($1,$2)',[page.id,[bm]]),/row-level security/);
 assert.equal((await db.query('select monitor_id from status_components')).rows[0].monitor_id,am);
 await db.exec(`select set_config('request.jwt.claim.sub','${bob}',false)`);
 assert.equal((await db.query('select id from telemetry_apps')).rows.length,0);assert.equal((await db.query('select * from status_pages')).rows.length,0);
 await assert.rejects(db.query('select set_status_components($1,$2)',[page.id,[]]),/Page not found/);
 await db.exec('reset role;set role service_role');
 const events=[{method:'GET',route:'/users/:id',status_code:500,duration_ms:50,error_type:'TypeError'}];
 assert.equal((await db.query('select record_telemetry($1,$2) as n',[app,JSON.stringify(events)])).rows[0].n,1);
 await db.exec(`update telemetry_apps set quota_used=1000 where id='${app}'`);
 assert.equal((await db.query('select record_telemetry($1,$2) as n',[app,JSON.stringify(events)])).rows[0].n,-1);
 await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${bob}',false)`);assert.equal((await db.query('select * from request_events')).rows.length,0);
 await db.exec(`select set_config('request.jwt.claim.sub','${alice}',false)`);assert.equal((await db.query('select * from request_events')).rows.length,1);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from status_pages'),/permission denied/);
 }finally{await db.close();}
});
test('SDK captures route templates without request secrets and drains queued batches',async()=>{
 const payloads=[];const sdk=createWebHealth({key:'gwh_'+'a'.repeat(64),batchSize:2,flushMs:60000,fetchImpl:async(_u,options)=>{payloads.push(JSON.parse(options.body));await new Promise(r=>setTimeout(r,5));return {ok:true};}});
 for(let i=0;i<9;i++){const res=new EventEmitter();res.statusCode=i===0?500:200;res.locals={};let next=false;
 sdk.middleware({method:'GET',baseUrl:'/api',route:{path:'/users/:id'},originalUrl:'/api/users/private-id?token=SECRET',body:{password:'SECRET'},headers:{authorization:'SECRET'}},res,()=>{next=true;});assert.equal(next,true);
 if(i===0)sdk.errorMiddleware(new TypeError('SECRET stack'),{},res,()=>{});res.emit('finish');}
 await sdk.close();const rows=payloads.flatMap(p=>p.events);assert.equal(rows.length,9);assert.equal(rows[0].route,'/api/users/:id');assert.equal(rows[0].error_type,'TypeError');assert.equal(JSON.stringify(rows).includes('SECRET'),false);
});
test('SDK delivery failures do not propagate and summary measures server errors',async()=>{
 const sdk=createWebHealth({key:'gwh_'+'b'.repeat(64),fetchImpl:async()=>{throw new Error('offline')}});const res=new EventEmitter();res.statusCode=200;res.locals={};sdk.middleware({method:'GET'},res,()=>{});res.emit('finish');await sdk.close();
 const result=requestSummary([{method:'GET',route:'/',status_code:404,duration_ms:10},{method:'GET',route:'/',status_code:503,duration_ms:90}]);assert.equal(result.count,2);assert.equal(result.errorRate,50);assert.equal(result.routes[0].errors,1);
});
