import { summarizeChecks, failureExplanation } from './monitoring.js';
import { monitorState } from './shared.js';

export function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
}

export function deriveIncidents(monitors, checks) {
  const incidents = [];
  for (const monitor of monitors) {
    const samples = checks.filter(c => c.monitor_id === monitor.id).sort((a, b) => Date.parse(a.checked_at) - Date.parse(b.checked_at));
    let incident = null, previous = null;
    for (const check of samples) {
      const gap = previous && Date.parse(check.checked_at) - Date.parse(previous.checked_at) > monitor.interval_minutes * 180000;
      if (gap && incident) { incident.state = 'unknown'; incident = null; }
      if (check.status === 'down') {
        if (!incident) {
          incident = { monitor, start: check.checked_at, lastFailure: check.checked_at, count: 0, state: 'unresolved', recovery: null, cause: failureExplanation(check), code: check.http_code, boundary: !previous || gap };
          incidents.push(incident);
        }
        incident.count++; incident.lastFailure = check.checked_at;
      } else if (incident) {
        incident.state = 'recovered'; incident.recovery = check.checked_at; incident = null;
      }
      previous = check;
    }
  }
  return incidents.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
}

export function checksCsv(monitors, checks) {
  const names = new Map(monitors.map(m => [m.id, m.name]));
  const cell = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return ['Endpoint,Checked at,Status,HTTP code,Response ms,Failure', ...checks.map(c => [names.get(c.monitor_id) ?? 'Deleted endpoint', c.checked_at, c.status, c.http_code, c.response_ms, c.error].map(cell).join(','))].join('\r\n');
}

export function reliabilityView(monitors, checks, options, e) {
  const summary = summarizeChecks(checks, options), target = options.target ?? 99.9;
  const p95 = percentile(summary.timings.map(c => c.response_ms), .95);
  const allowance = summary.samples.length * (100 - target) / 100;
  const budget = summary.samples.length ? Math.max(0, allowance - summary.failures.length) : null;
  return `<section class="chart-panel"><div class="table-heading"><h2>Reliability report</h2><button class="secondary compact-button" data-action="export-checks">Download CSV</button></div><div class="reliability-goal"><label for="health-target">Success target</label><select id="health-target">${[99,99.9,99.99].map(value => `<option value="${value}" ${target === value ? 'selected' : ''}>${value}%</option>`).join('')}</select><span>Targets apply to recorded checks in the selected view.</span></div><div class="reliability-metrics"><div><small>P95 response</small><strong>${p95 == null ? '—' : `${p95.toLocaleString()} ms`}</strong><p>95% of timed checks were at or below this.</p></div><div><small>Success target</small><strong>${summary.rate == null ? 'Awaiting data' : summary.rate >= target ? 'Meeting target' : 'Below target'}</strong><p>${target}% target · ${summary.rate == null ? 'No samples' : `${summary.rate.toFixed(2)}% observed`}</p></div><div><small>Failure budget remaining</small><strong>${budget == null ? '—' : `${budget.toFixed(2)} checks`}</strong><p>Allowance ${allowance.toFixed(2)} · failures ${summary.failures.length}. This is a sample budget, not downtime.</p></div></div><div class="table-scroll"><table><thead><tr><th>Endpoint</th><th>Current health</th><th>Success rate</th><th>P95 response</th><th>Failed / total</th><th>Next schedule</th></tr></thead><tbody>${monitors.filter(m => !options.monitorId || m.id === options.monitorId).map(m => {
    const data = summarizeChecks(checks, { ...options, monitorId: m.id });
    const latency = percentile(data.timings.map(c => c.response_ms), .95);
    const state = monitorState(m);
    return `<tr><td><strong>${e(m.name)}</strong></td><td><span class="badge ${state}">${e({up:'Healthy',down:'Failed',paused:'Paused',pending:'Pending',overdue:'Overdue'}[state])}</span></td><td>${data.rate == null ? '—' : `${data.rate.toFixed(2)}%`}</td><td>${latency == null ? '—' : `${latency} ms`}</td><td>${data.failures.length} / ${data.samples.length}</td><td>${!m.enabled ? 'Paused' : m.next_check_at ? e(new Date(m.next_check_at).toLocaleString()) : 'Awaiting scheduler'}</td></tr>`;
  }).join('') || '<tr><td colspan="6">Add an endpoint to begin your reliability report.</td></tr>'}</tbody></table></div></section>`;
}

export function incidentsView(monitors, checks, options, e) {
  const samples = summarizeChecks(checks, options).samples;
  const incidents = deriveIncidents(monitors, samples);
  const displayed = incidents.filter(i => options.state === 'all' || i.state === options.state);
  const label = { unresolved: 'Recovery not observed', recovered: 'Recovery observed', unknown: 'Gap in checks' };
  const controls = `<div class="monitoring-toolbar"><label>Endpoint<select id="health-endpoint"><option value="">All endpoints</option>${monitors.map(m => `<option value="${e(m.id)}" ${m.id === options.monitorId ? 'selected' : ''}>${e(m.name)}</option>`).join('')}</select></label><label>Time range<select id="health-range"><option value="1" ${options.days === 1 ? 'selected' : ''}>Last 24 hours</option><option value="7" ${options.days === 7 ? 'selected' : ''}>Last 7 days</option></select></label><label>Incident state<select id="incident-state">${['all','unresolved','recovered','unknown'].map(s => `<option value="${s}" ${options.state === s ? 'selected' : ''}>${s === 'all' ? 'All incidents' : label[s]}</option>`).join('')}</select></label></div>`;
  return `${controls}<p class="monitoring-note">Incidents group consecutive failed checks for each endpoint. A gap longer than three scheduled intervals ends the observed sequence. Start and recovery times are observations, not exact outage times. This view uses ${samples.length} checks from the latest ${checks.length} loaded results.</p><div class="stats"><article class="stat"><div>Observed incidents</div><strong>${incidents.length}</strong><p>Within the selected check history</p></article><article class="stat"><div>Recoveries observed</div><strong>${incidents.filter(i => i.state === 'recovered').length}</strong><p>A successful check followed failures</p></article><article class="stat"><div>Recovery not observed</div><strong>${incidents.filter(i => i.state !== 'recovered').length}</strong><p>Includes gaps and unresolved sequences</p></article></div><section class="chart-panel"><div class="table-heading"><h2>Incident timeline</h2><span>${displayed.length} incidents in this view</span></div>${displayed.map(i => `<details class="failure-item"><summary><span><strong>${e(i.monitor.name)}</strong><small>First failure ${e(new Date(i.start).toLocaleString())} · ${i.count} failed checks</small></span><span class="badge ${i.state === 'recovered' ? 'up' : i.state === 'unknown' ? 'overdue' : 'down'}">${label[i.state]}</span><span class="failure-expand">Details +</span></summary><div class="failure-detail"><dl><dt>Initial failure</dt><dd>${e(i.cause)}</dd><dt>HTTP code</dt><dd>${i.code == null ? 'No response code' : e(i.code)}</dd><dt>Last failure</dt><dd>${e(new Date(i.lastFailure).toLocaleString())}</dd><dt>Recovery</dt><dd>${i.recovery ? e(new Date(i.recovery).toLocaleString()) : 'No recovery observed in this sequence'}</dd><dt>Observed span</dt><dd>${i.recovery ? `${Math.round((Date.parse(i.recovery) - Date.parse(i.start)) / 60000)} min from first failed check to recovery check` : 'Not established'}</dd><dt>History boundary</dt><dd>${i.boundary ? 'Sequence begins without a preceding healthy check in contiguous loaded history' : 'A healthy check preceded this sequence'}</dd></dl></div></details>`).join('') || '<div class="chart-empty">No incidents match this view. Failures will appear here when checks record them.</div>'}</section>`;
}

export function plansView(monitors, e) {
  return `<div class="plan-banner"><span class="badge up">Current plan: Free</span><p>Your workspace uses ${monitors.length} of 10 endpoint slots. All currently available monitoring features are included.</p><progress max="10" value="${Math.min(10,monitors.length)}" aria-label="Endpoint usage"></progress></div><p class="monitoring-note">Paid plans are a product preview. Prices and features below are proposals. Checkout, billing, and paid entitlements are not enabled; no payment is collected.</p><div class="plan-grid"><article class="plan-card"><span class="section-kicker">FOR SIDE PROJECTS</span><h2>Free</h2><div class="plan-price">$0<small>/ month</small></div><p>Available now</p><ul><li>Up to 10 endpoints</li><li>Checks every 5–60 minutes</li><li>7-day history retention</li><li>Uptime charts and incident timeline</li><li>Reliability report and CSV export</li><li>Backend request logs and performance</li><li>In-app alerts and three status pages</li></ul><button class="secondary" disabled>Current plan</button></article><article class="plan-card featured"><span class="section-kicker">PLANNED · FOR GROWING APPS</span><h2>Pro</h2><div class="plan-price">$9<small>/ month · proposed</small></div><p>Paid plan preview</p><ul><li>Planned: 25 endpoints</li><li>Planned: 1-minute checks</li><li>Planned: 30-day history</li><li>Planned: email outage alerts</li><li>Planned: custom status page branding</li></ul><button class="primary" disabled>Checkout coming soon</button></article><article class="plan-card"><span class="section-kicker">PLANNED · FOR TEAMS</span><h2>Business</h2><div class="plan-price">$29<small>/ month · proposed</small></div><p>Paid plan preview</p><ul><li>Planned: 100 endpoints</li><li>Planned: 90-day history</li><li>Planned: team workspaces</li><li>Planned: webhooks and integrations</li><li>Planned: advanced alert routing</li></ul><button class="secondary" disabled>Checkout coming soon</button></article></div><section class="chart-panel plan-faq"><h2>Your workspace stays on Free</h2><p>Free monitoring is available now. The paid tiers are a preview; checkout is not available and no account is charged or upgraded.</p></section>`;
}
