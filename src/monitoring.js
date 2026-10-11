export function summarizeChecks(checks, { now = Date.now(), days = 1, monitorId = '' } = {}) {
  const start = now - days * 86400000;
  const samples = checks.filter(c => {
    const time = Date.parse(c.checked_at);
    return time >= start && time <= now && (!monitorId || c.monitor_id === monitorId);
  }).sort((a, b) => Date.parse(a.checked_at) - Date.parse(b.checked_at));
  const failures = samples.filter(c => c.status !== 'up');
  const timings = samples.filter(c => Number.isFinite(c.response_ms) && c.response_ms >= 0);
  const count = days === 1 ? 24 : 7;
  const width = (now - start) / count;
  const buckets = Array.from({ length: count }, (_, i) => ({ start: start + i * width, total: 0, healthy: 0, rate: null }));
  for (const check of samples) {
    const bucket = buckets[Math.min(count - 1, Math.floor((Date.parse(check.checked_at) - start) / width))];
    bucket.total++; if (check.status === 'up') bucket.healthy++;
  }
  for (const bucket of buckets) if (bucket.total) bucket.rate = 100 * bucket.healthy / bucket.total;
  return { samples, failures, timings, buckets, start, now,
    rate: samples.length ? 100 * (samples.length - failures.length) / samples.length : null,
    averageMs: timings.length ? timings.reduce((sum, c) => sum + c.response_ms, 0) / timings.length : null };
}

export function failureExplanation(check) {
  if (check.error) return check.error;
  if (check.http_code >= 500) return 'The backend returned a server error.';
  if (check.http_code === 429) return 'The backend rate-limited the health check.';
  if (check.http_code >= 400) return 'The backend rejected the request. Check the health path and access requirements.';
  return 'The health request did not complete successfully.';
}

export function monitoringView(monitors, checks, options, escape) {
  const e = escape, summary = summarizeChecks(checks, options);
  const names = new Map(monitors.map(m => [m.id, m]));
  const date = value => new Date(value).toLocaleString();
  const percent = value => value == null ? '—' : `${value.toFixed(1)}%`;
  const bucketLabel = value => new Date(value).toLocaleString(undefined, options.days === 1 ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' });
  const bars = summary.buckets.map(bucket => `<div class="uptime-column"><div class="uptime-track"><span class="uptime-fill ${bucket.rate === null ? 'no-data' : bucket.rate < 100 ? 'has-failures' : ''}" style="height:${bucket.rate === null ? 100 : Math.max(2, bucket.rate)}%"></span></div><span>${e(bucketLabel(bucket.start))}</span><span class="chart-tooltip">${e(bucketLabel(bucket.start))}: ${bucket.total ? `${percent(bucket.rate)} · ${bucket.total} checks` : 'No checks'}</span></div>`).join('');
  const maxMs = Math.max(1, ...summary.timings.map(c => c.response_ms));
  const points = summary.timings.map(c => ({ x: 35 + 690 * (Date.parse(c.checked_at) - summary.start) / (summary.now - summary.start), y: 175 - 145 * c.response_ms / maxMs, check: c }));
  const latency = points.length ? `<svg class="latency-chart" viewBox="0 0 760 205" role="img" aria-label="Response times for ${points.length} recorded checks, from ${e(date(summary.start))} to ${e(date(summary.now))}"><line x1="35" y1="30" x2="725" y2="30" class="chart-grid"/><line x1="35" y1="103" x2="725" y2="103" class="chart-grid"/><line x1="35" y1="175" x2="725" y2="175" class="chart-grid"/><text x="35" y="18">${maxMs.toLocaleString()} ms</text><text x="35" y="196">${e(bucketLabel(summary.start))}</text><text x="725" y="196" text-anchor="end">Now</text><polyline points="${points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" fill="none" stroke="#78975d" stroke-width="2"/>${points.map(p => `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4" fill="${p.check.status === 'up' ? '#527c44' : '#c16b51'}"><title>${e(date(p.check.checked_at))}: ${p.check.response_ms} ms · ${e(names.get(p.check.monitor_id)?.name ?? 'Endpoint')} · ${p.check.status === 'up' ? 'Healthy' : 'Failed'}</title></circle>`).join('')}</svg>` : '<p class="chart-empty">Response times will appear after checks are recorded.</p>';
  const failures = summary.failures.slice().reverse().map(c => {
    const monitor = names.get(c.monitor_id);
    return `<details class="failure-item"><summary><span><strong>${e(monitor?.name ?? 'Deleted endpoint')}</strong><small>${e(date(c.checked_at))}</small></span><span class="badge down">${c.http_code == null ? 'Network failure' : `HTTP ${e(c.http_code)}`}</span><span class="failure-expand">Details +</span></summary><div class="failure-detail"><dl><dt>Failure</dt><dd>${e(failureExplanation(c))}</dd><dt>Health URL</dt><dd>${e(monitor?.url ?? 'Endpoint no longer available')}</dd><dt>Elapsed time</dt><dd>${c.response_ms == null ? 'Not recorded' : `${e(c.response_ms.toLocaleString())} ms`}</dd><dt>Check time</dt><dd>${e(date(c.checked_at))}</dd></dl><p>This is a recorded check failure. It does not establish how long the backend was unavailable.</p></div></details>`;
  }).join('');
  return `<section class="monitoring-section"><div class="monitoring-toolbar"><label>Endpoint<select id="health-endpoint"><option value="">All endpoints</option>${monitors.map(m => `<option value="${e(m.id)}" ${options.monitorId === m.id ? 'selected' : ''}>${e(m.name)}</option>`).join('')}</select></label><label>Time range<select id="health-range"><option value="1" ${options.days === 1 ? 'selected' : ''}>Last 24 hours</option><option value="7" ${options.days === 7 ? 'selected' : ''}>Last 7 days</option></select></label></div><p class="monitoring-note">Based on ${summary.samples.length} checks in this view, from the latest ${checks.length} loaded results (maximum 200). Percentages measure successful checks, not continuous availability. Empty periods mean no data.</p><div class="stats"><article class="stat"><div>Recorded uptime</div><strong>${percent(summary.rate)}</strong><p>Successful checks in this view</p></article><article class="stat"><div>Failed checks</div><strong>${summary.failures.length}</strong><p>Out of ${summary.samples.length} recorded checks</p></article><article class="stat"><div>Average response</div><strong>${summary.averageMs == null ? '—' : `${Math.round(summary.averageMs).toLocaleString()}<small>ms</small>`}</strong><p>Includes completed and failed requests with timing</p></article></div><article class="chart-panel"><div class="table-heading"><h2>Uptime over time</h2><span>Green: healthy · Orange: failures · Grey: no data</span></div><div class="uptime-chart" role="img" aria-label="Recorded uptime by ${options.days === 1 ? 'hour' : 'day'}">${bars}</div><details class="chart-data"><summary>View chart data</summary><div class="table-scroll"><table><thead><tr><th>Period starts</th><th>Successful checks</th><th>Total checks</th><th>Uptime</th></tr></thead><tbody>${summary.buckets.map(b => `<tr><td>${e(date(b.start))}</td><td>${b.healthy}</td><td>${b.total}</td><td>${percent(b.rate)}</td></tr>`).join('')}</tbody></table></div></details></article><article class="chart-panel"><div class="table-heading"><h2>Response time</h2><span>Hover a point for check details</span></div>${latency}</article><article class="chart-panel"><div class="table-heading"><h2>Failure details</h2><span>${summary.failures.length} failed checks</span></div>${failures || `<div class="chart-empty">${summary.samples.length ? 'No failed checks in this view.' : 'No checks recorded in this view yet.'}</div>`}</article></section>`;
}
