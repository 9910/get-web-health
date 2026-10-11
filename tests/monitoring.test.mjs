import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeChecks, failureExplanation } from '../src/monitoring.js';
test('monitoring respects endpoint and time bounds, and leaves missing periods empty', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');
  const check = (hours, status, id = 'a', response_ms = 100) => ({ checked_at: new Date(now - hours * 3600000).toISOString(), monitor_id: id, status, response_ms });
  const result = summarizeChecks([check(1, 'up'), check(2, 'down', 'a', 300), check(3, 'up', 'b'), check(25, 'up'), check(-1, 'down')], { now, days: 1, monitorId: 'a' });
  assert.equal(result.rate, 50); assert.equal(result.averageMs, 200); assert.equal(result.failures.length, 1);
  assert.equal(result.buckets.filter(b => b.rate === null).length, 22);
  assert.equal(summarizeChecks([], { now }).rate, null);
});
test('failure details distinguish HTTP and network failures', () => {
  assert.match(failureExplanation({ http_code: 503 }), /server error/);
  assert.match(failureExplanation({ http_code: 404 }), /health path/);
  assert.equal(failureExplanation({ error: 'Request timed out' }), 'Request timed out');
});
