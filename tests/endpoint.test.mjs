import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEndpoint, approvedEndpoint, monitorState, checkEndpoint } from '../src/shared.js';

test('normalizes a backend root and preserves an explicit health path', () => {
  assert.equal(normalizeEndpoint('https://hello.onrender.com'), 'https://hello.onrender.com/health');
  assert.equal(normalizeEndpoint('https://hello.onrender.com/api/status'), 'https://hello.onrender.com/api/status');
});

test('rejects credentials, private addresses, non-HTTPS and custom ports', () => {
  for (const url of ['http://hello.onrender.com', 'https://user:pass@hello.onrender.com', 'https://127.0.0.1/health', 'https://[::1]/health', 'https://localhost/health', 'https://hello.internal/health', 'https://hello.onrender.com:444/health']) assert.throws(() => normalizeEndpoint(url));
  assert.throws(() => approvedEndpoint('https://hello.onrender.com.evil.example/health'));
  assert.throws(() => approvedEndpoint('https://onrender.com/health'));
});

test('allows configured custom domains explicitly', () => {
  assert.equal(approvedEndpoint('https://api.example.com/health', ['api.example.com']), 'https://api.example.com/health');
});

test('expired success is overdue, not healthy', () => {
  const now = Date.now();
  assert.equal(monitorState({ enabled: true, interval_minutes: 10, last_status: 'up', last_checked_at: new Date(now - 30 * 60000).toISOString() }, now), 'overdue');
  assert.equal(monitorState({ enabled: false }), 'paused');
  assert.equal(monitorState({ enabled: true }), 'pending');
});

test('records HTTP success and failure without reading large response bodies', async () => {
  let cancelled = false;
  const fetcher = async () => ({ ok: true, status: 204, body: { cancel: async () => { cancelled = true; } } });
  const good = await checkEndpoint('https://hello.onrender.com/health', { fetcher });
  assert.equal(good.status, 'up'); assert.equal(good.http_code, 204); assert.equal(cancelled, true);
  const bad = await checkEndpoint('https://hello.onrender.com/health', { fetcher: async () => new Response('down', { status: 503 }) });
  assert.equal(bad.status, 'down'); assert.equal(bad.http_code, 503);
});

test('revalidates redirect destinations before requesting them', async () => {
  let requests = 0;
  const result = await checkEndpoint('https://hello.onrender.com/health', { fetcher: async () => { requests++; return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }); } });
  assert.equal(requests, 1); assert.equal(result.status, 'down'); assert.equal(result.http_code, null);
});

test('follows safe redirects but stops redirect loops', async () => {
  let requests = 0;
  const good = await checkEndpoint('https://hello.onrender.com/health', { fetcher: async () => ++requests === 1 ? new Response(null, { status: 302, headers: { location: '/api/health' } }) : new Response(null, { status: 200 }) });
  assert.equal(requests, 2); assert.equal(good.status, 'up');
  const loop = await checkEndpoint('https://hello.onrender.com/health', { fetcher: async () => new Response(null, { status: 302, headers: { location: '/health' } }) });
  assert.equal(loop.status, 'down'); assert.match(loop.error, /Too many redirects/);
});
