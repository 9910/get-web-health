import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveIncidents, percentile, checksCsv } from '../src/operations.js';
const monitors = [{ id:'a', name:'Backend', interval_minutes:5 }, { id:'b', name:'Other', interval_minutes:5 }];
const check = (minute, status, monitor_id = 'a') => ({ checked_at: new Date(Date.UTC(2026,9,11,0,minute)).toISOString(), monitor_id, status, http_code: status === 'up' ? 200 : 503 });
test('incident sequences stay isolated by endpoint and recover on success', () => {
  const result = deriveIncidents(monitors, [check(0,'up'),check(5,'down'),check(10,'down'),check(12,'down','b'),check(15,'up')]);
  assert.equal(result.length,2);
  const recovered = result.find(i => i.monitor.id === 'a');
  assert.equal(recovered.count,2); assert.equal(recovered.state,'recovered'); assert.equal(recovered.boundary,false);
  assert.equal(result.find(i => i.monitor.id === 'b').state,'unresolved');
});
test('missing check periods prevent claiming an observed recovery across a gap', () => {
  const result = deriveIncidents(monitors, [check(0,'down'),check(25,'up'),check(30,'down')]);
  assert.equal(result.find(i => i.start === check(0,'down').checked_at).state,'unknown');
  assert.equal(result.length,2);
});
test('percentiles handle no data and CSV escapes formulas, quotes and newlines', () => {
  assert.equal(percentile([], .95),null); assert.equal(percentile([4,1,3,2],.95),4);
  const csv = checksCsv([{id:'a',name:'=HYPERLINK("bad")'}], [{ ...check(0,'down'), error:'line1\nline2' }]);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/); assert.ok(csv.includes('"line1\nline2"'));
});
