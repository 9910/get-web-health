import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const aliceMonitor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bobMonitor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('Postgres enforces owner isolation, restricted columns, worker leases and real history', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      insert into auth.users values ('${alice}'), ('${bob}');
    `);
    await db.exec(await readFile(new URL('../supabase/setup.sql', import.meta.url), 'utf8'));
    await db.exec(`insert into public.monitors(id,user_id,name,url) values
      ('${aliceMonitor}','${alice}','Alice backend','https://alice.onrender.com/health'),
      ('${bobMonitor}','${bob}','Bob backend','https://bob.onrender.com/health');
      set role authenticated; select set_config('request.jwt.claim.sub','${alice}',false);`);
    const rows = await db.query('select name from public.monitors');
    assert.deepEqual(rows.rows.map(r => r.name), ['Alice backend']);
    assert.equal((await db.query(`update public.monitors set name='Hacked' where id='${bobMonitor}' returning id`)).rows.length, 0);
    await assert.rejects(db.exec(`insert into public.monitors(user_id,name,url) values('${bob}','Wrong owner','https://alice.onrender.com/health')`), /row-level security/i);
    await assert.rejects(db.exec(`update public.monitors set user_id='${bob}' where id='${aliceMonitor}'`), /permission denied/i);
    await assert.rejects(db.exec(`update public.monitors set last_status='up' where id='${aliceMonitor}'`), /permission denied/i);
    await assert.rejects(db.query('select * from public.claim_health_checks()'), /permission denied/i);
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select * from public.monitors'), /permission denied/i);
    await db.exec('reset role; set role service_role;');
    const claimed = await db.query('select * from public.claim_health_checks()');
    assert.equal(claimed.rows.length, 2);
    assert.equal((await db.query('select * from public.claim_health_checks()')).rows.length, 0);
    const monitor = claimed.rows.find(r => r.id === aliceMonitor);
    await db.query('select public.complete_health_check($1,$2,$3,$4,$5,$6)', [monitor.id,monitor.lease_id,'up',200,123,null]);
    const repeat = await db.query('select public.complete_health_check($1,$2,$3,$4,$5,$6) as saved', [monitor.id,monitor.lease_id,'up',200,123,null]);
    assert.equal(repeat.rows[0].saved, false);
    await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${bob}',false);`);
    assert.equal((await db.query('select * from public.health_checks')).rows.length, 0);
    await db.exec(`select set_config('request.jwt.claim.sub','${alice}',false);`);
    const history = await db.query('select status,http_code,response_ms from public.health_checks');
    assert.deepEqual(history.rows, [{ status:'up', http_code:200, response_ms:123 }]);
    await db.exec(`update public.monitors set url='https://alice.onrender.com/other-health' where id='${aliceMonitor}'`);
    assert.equal((await db.query('select last_checked_at from public.monitors')).rows[0].last_checked_at, null);
    // Bounded per-user usage, with no privileges to forge scheduler fields.
    for(let n=0;n<9;n++) await db.exec(`insert into public.monitors(user_id,name,url) values('${alice}','Endpoint ${n}','https://alice.onrender.com/health')`);
    await assert.rejects(db.exec(`insert into public.monitors(user_id,name,url) values('${alice}','Too many','https://alice.onrender.com/health')`), /up to 10 endpoints/i);
  } finally { await db.close(); }
});
