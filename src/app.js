import { createClient } from '@supabase/supabase-js';
import { normalizeEndpoint, monitorState } from './shared.js';
import { monitoringView } from './monitoring.js';
let healthDays = 1, healthMonitorId = '';

const supabase = createClient(__SUPABASE_URL__, __SUPABASE_KEY__);
const app = document.querySelector('#app');
const toastElement = document.querySelector('#toast');
let session = null, authMode = 'login', page = 'monitors', monitors = [], checks = [], scheduler = null, loading = false, loadError = '', search = '', filter = 'all', authNotice = '', authError = '', toastTimer, pollTimer;
let recovery = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  pulse: '<path d="M3 12h5l3-7 4 14 3-7h3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  link: '<path d="m10 13 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2-1 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  refresh: '<path d="M20 7a9 9 0 1 0 1 9M20 3v5h-5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  logout: '<path d="M9 4H4v16h5m6-12 4 4-4 4M9 12h10"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  bolt: '<path d="m13 2-8 12h6l-1 8 9-12h-6z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 6 8 7 8-7"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.pulse}</svg>`;
const brand = () => `<a class="brand" href="./" aria-label="Get Web Health home"><span class="brand-icon">${icon('pulse')}</span><span>get web health<span class="brand-dot">.</span></span></a>`;
const stateLabel = { up: 'Healthy', down: 'Not responding', paused: 'Paused', pending: 'Awaiting first check', overdue: 'Check overdue' };
const ago = date => {
  if (!date) return 'Not checked yet';
  const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  return seconds < 60 ? 'Just now' : seconds < 3600 ? `${Math.floor(seconds / 60)} min ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)} hr ago` : `${Math.floor(seconds / 86400)} days ago`;
};
const toast = message => { clearTimeout(toastTimer); toastElement.textContent = message; toastElement.classList.add('visible'); toastTimer = setTimeout(() => toastElement.classList.remove('visible'), 5000); };
const errorText = error => {
  if (['42P01', 'PGRST205', '42501'].includes(error?.code)) return 'The monitor database is not ready yet. The workspace owner needs to complete the Supabase setup.';
  return error?.message || 'Something went wrong. Please try again.';
};

function renderAuth() {
  clearInterval(pollTimer);
  const signup = authMode === 'signup', reset = authMode === 'reset', forgot = authMode === 'forgot';
  const title = signup ? 'Your uptime starts here.' : reset ? 'A fresh start.' : forgot ? 'Let’s get you back in.' : 'Welcome back.';
  app.innerHTML = `<div class="auth-layout"><section class="auth-story">${brand()}<div class="story-content"><div class="eyebrow"><span class="small-dot"></span> A LITTLE PEACE OF UPTIME</div><h1>Small checks.<br>Big peace<br>of mind<span>.</span></h1><p>Give your backends a gentle nudge.<br>Keep an eye on their health, all in one place.</p><div class="story-graphic" aria-hidden="true"><div class="graphic-top"><span class="graphic-icon">${icon('pulse')}</span><span>Every endpoint.<br><b>A little more looked after.</b></span><span class="graphic-check">${icon('check')}</span></div><div class="wave"><svg viewBox="0 0 400 75" preserveAspectRatio="none"><path d="M0 50H50L66 50 78 28 91 65 105 8 120 50H166L180 50 193 32 207 67 223 15 238 50H289L304 50 318 24 332 62 347 8 363 50H400" fill="none" stroke="currentColor" stroke-width="2.5"/></svg></div><div class="graphic-bottom"><span>HTTPS endpoints</span><span>Scheduled in the cloud</span></div></div><div class="story-benefits"><span>${icon('clock')} Checks while you’re away</span><span>${icon('shield')} A workspace of your own</span></div></div><footer>Built for side projects. Made for peace of mind.<span>01 — GET WEB HEALTH</span></footer></section><section class="auth-panel"><div class="auth-top-note">${icon('shield')} YOUR PERSONAL WORKSPACE</div><div class="auth-card"><span class="section-kicker">${signup ? 'LET’S GET STARTED' : reset || forgot ? 'ACCOUNT RECOVERY' : 'GOOD TO SEE YOU'}</span><h2>${title}</h2><p class="muted">${signup ? 'Create an account, then add your first backend.' : reset ? 'Choose a new password for your account.' : forgot ? 'We’ll send a password reset link to your inbox.' : 'Sign in to see how your backends are doing.'}</p>${!reset && !forgot ? `<div class="auth-tabs"><button data-auth-mode="login" class="${signup ? '' : 'selected'}">Log in</button><button data-auth-mode="signup" class="${signup ? 'selected' : ''}">Create account</button></div>` : ''}<form id="auth-form">${!reset ? `<label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required maxlength="254" />` : ''}${!forgot ? `<div class="label-row"><label for="password">${reset ? 'New password' : 'Password'}</label>${!signup && !reset ? '<button type="button" class="text-button" data-auth-mode="forgot">Forgot password?</button>' : ''}</div><div class="password-wrap"><input id="password" name="password" type="password" autocomplete="${signup || reset ? 'new-password' : 'current-password'}" placeholder="${signup || reset ? 'At least 8 characters' : 'Enter your password'}" ${signup || reset ? 'minlength="8"' : ''} required maxlength="128" /><button type="button" data-action="show-password" aria-label="Show password">${icon('eye')}</button></div>${signup || reset ? '<label for="confirm-password">Confirm password</label><input id="confirm-password" name="confirm" type="password" autocomplete="new-password" placeholder="Enter your password again" minlength="8" required maxlength="128" />' : ''}` : ''}<p id="auth-error" class="form-error" role="alert">${e(authError)}</p><p id="auth-notice" class="form-notice" role="status">${e(authNotice)}</p><button type="submit" class="primary auth-submit">${signup ? 'Create your account' : reset ? 'Update password' : forgot ? 'Send reset link' : 'Log in to your workspace'}${icon('arrow')}</button></form>${forgot || reset ? '<button class="text-button back-login" data-auth-mode="login">Back to log in</button>' : `<p class="auth-switch">${signup ? 'Already have an account?' : 'New around here?'} <button class="text-button" data-auth-mode="${signup ? 'login' : 'signup'}">${signup ? 'Log in' : 'Create an account'}</button></p>`}<div class="auth-assurance">${icon('shield')} Your endpoints stay private to your account.</div></div><div class="auth-footer"><span>Simple by design. Secure with Supabase.</span><span>GET WEB HEALTH ${icon('pulse')}</span></div></section></div>`;
}

function navigation() {
  const email = session.user.email ?? 'Your account';
  return `<aside class="sidebar">${brand()}<div class="workspace-label">YOUR WORKSPACE <span>PERSONAL</span></div><nav aria-label="Main navigation"><button data-page="monitors" class="nav-item ${page === 'monitors' ? 'active' : ''}">${icon('grid')}Overview<span class="nav-count">${monitors.length}</span></button><button data-page="health" class="nav-item ${page === 'health' ? 'active' : ''}">${icon('pulse')}Health monitoring</button><button data-page="activity" class="nav-item ${page === 'activity' ? 'active' : ''}">${icon('clock')}Check history</button><button data-page="settings" class="nav-item ${page === 'settings' ? 'active' : ''}">${icon('settings')}Account</button></nav><div class="sidebar-tip"><span class="tip-icon">${icon('bolt')}</span><h3>A gentle nudge.</h3><p>Checks run in the cloud, even when this tab is closed.</p><span>SMALL CHECKS, LESS GUESSWORK</span></div><div class="account-mini"><span class="avatar">${e(email[0].toUpperCase())}</span><span><b>Your workspace</b><small title="${e(email)}">${e(email)}</small></span><button class="icon-button" data-action="logout" aria-label="Log out">${icon('logout')}</button></div></aside>`;
}

function stats() {
  const active = monitors.filter(m => m.enabled).length;
  const healthy = monitors.filter(m => monitorState(m) === 'up').length;
  const rate = checks.length ? `${((checks.filter(c => c.status === 'up').length / checks.length) * 100).toFixed(1)}<small>%</small>` : '—';
  return `<section class="stats" aria-label="Workspace statistics"><article class="stat"><div>Total endpoints ${icon('grid')}</div><strong>${String(monitors.length).padStart(2, '0')}</strong><p>Your little corner of the internet</p></article><article class="stat"><div>Active schedules ${icon('clock')}</div><strong>${String(active).padStart(2, '0')}<span class="stat-tag">${active ? 'Scheduled' : 'Ready when you are'}</span></strong><p>${healthy} healthy · ${monitors.length - active} paused</p></article><article class="stat"><div>Recent success rate ${icon('pulse')}</div><strong>${rate}</strong><p>Across ${checks.length} most recent checks</p></article></section>`;
}

function monitorCard(m) {
  const status = monitorState(m), history = checks.filter(c => c.monitor_id === m.id).slice(0, 24).reverse();
  const latest = history.at(-1);
  let hostname = m.url;
  try { hostname = new URL(m.url).hostname; } catch {}
  return `<article class="monitor-card"><div class="monitor-top"><span class="endpoint-icon">${icon('link')}</span><span class="badge ${status}"><i></i>${stateLabel[status]}</span></div><div class="monitor-title"><h3>${e(m.name)}</h3><button data-action="edit" data-id="${e(m.id)}" class="text-button">Edit</button></div><a class="endpoint-url" href="${e(m.url)}" target="_blank" rel="noopener noreferrer" title="${e(m.url)}">${e(hostname)}${icon('arrow')}</a><div class="history-strip" aria-label="${history.length} recorded checks">${history.length ? history.map(c => `<span class="history-bar ${c.status}" title="${e(new Date(c.checked_at).toLocaleString())}: ${e(c.http_code ?? c.error ?? c.status)}"></span>`).join('') : '<span class="history-placeholder">Your first check will appear here.</span>'}</div><div class="monitor-meta"><span>${icon('clock')}Every ${m.interval_minutes} min</span><span>${latest?.response_ms != null ? `${latest.response_ms.toLocaleString()} ms` : '— ms'}</span></div><div class="monitor-bottom"><span><i class="small-dot ${status}"></i>${e(ago(m.last_checked_at))}</span><div><button class="icon-button" data-action="ping" data-id="${e(m.id)}" aria-label="Check ${e(m.name)} now" title="Check now">${icon('refresh')}</button><button class="icon-button" data-action="toggle" data-id="${e(m.id)}" aria-label="${m.enabled ? 'Pause' : 'Resume'} ${e(m.name)}" title="${m.enabled ? 'Pause' : 'Resume'}">${icon(m.enabled ? 'pause' : 'play')}</button><button class="icon-button danger-hover" data-action="delete" data-id="${e(m.id)}" aria-label="Delete ${e(m.name)}" title="Delete">${icon('trash')}</button></div></div></article>`;
}

function monitorList() {
  const displayed = monitors.filter(m => (filter === 'all' || (filter === 'active' ? m.enabled : !m.enabled)) && `${m.name} ${m.url}`.toLowerCase().includes(search.toLowerCase()));
  return `<div class="monitor-grid">${loading && !monitors.length ? '<div class="empty-state compact"><span class="loader"></span><p>Loading your endpoints…</p></div>' : displayed.length ? displayed.map(monitorCard).join('') : `<div class="empty-state"><div class="empty-orbit"><span>${icon(search || filter !== 'all' ? 'search' : 'pulse')}</span><i></i><b></b></div><h3>${search || filter !== 'all' ? 'No matching endpoints.' : 'Every good habit starts with one.'}</h3><p>${search || filter !== 'all' ? 'Try a different search or filter.' : 'Add your first backend URL. We’ll take it from here.'}</p>${!search && filter === 'all' ? `<button class="primary" data-action="add">${icon('plus')} Add your first endpoint</button><small>Your first check runs after the scheduler is connected.</small>` : ''}</div>`}</div>`;
}

function historyTable() {
  const names = new Map(monitors.map(m => [m.id, m.name]));
  return `<section class="table-panel"><div class="table-heading"><h2>Recent checks</h2><span>Latest ${checks.length} results</span></div>${checks.length ? `<div class="table-scroll"><table><thead><tr><th>Endpoint</th><th>Result</th><th>HTTP</th><th>Response time</th><th>Checked at</th></tr></thead><tbody>${checks.map(c => `<tr><td><strong>${e(names.get(c.monitor_id) ?? 'Deleted endpoint')}</strong>${c.error ? `<small class="check-error">${e(c.error)}</small>` : ''}</td><td><span class="badge ${c.status}"><i></i>${c.status === 'up' ? 'Healthy' : 'Failed'}</span></td><td>${c.http_code ?? '—'}</td><td>${c.response_ms != null ? `${c.response_ms.toLocaleString()} ms` : '—'}</td><td title="${e(new Date(c.checked_at).toLocaleString())}">${e(ago(c.checked_at))}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state compact">${icon('clock')}<h3>A clean slate.</h3><p>Real check results will show up here as your schedules run.</p></div>`}</section>`;
}

function accountPanel() {
  return `<section class="account-panel"><div class="account-profile"><span class="avatar large">${e((session.user.email ?? 'U')[0].toUpperCase())}</span><div><h2>Your personal workspace</h2><p>${e(session.user.email)}</p></div><span class="badge up"><i></i>Signed in</span></div><div class="account-detail"><h3>Private by default</h3><p>Your endpoints and check history are visible only to your account.</p>${icon('shield')}</div><div class="account-detail"><h3>Background schedules</h3><p>Checks run through Supabase Cron and Edge Functions. A saved endpoint waits for the scheduler to be connected before its first result appears.</p>${icon('clock')}</div><div class="account-detail"><h3>Supported endpoints</h3><p>Render, Railway, Fly, Vercel and Cloudflare Workers HTTPS URLs. Custom domains can be enabled by the workspace owner.</p>${icon('link')}</div><button class="secondary" data-action="logout">${icon('logout')} Log out of your account</button></section>`;
}

function renderDashboard() {
  const titles = { monitors: ['A little peace of uptime.', 'Your backends, all looked after in one place.'], activity: ['Every check tells a story.', 'The real responses behind your endpoint health.'], settings: ['A workspace of your own.', 'Your account and how your checks work.'] };
  const [title, subtitle] = page === 'health' ? ['A clearer picture of health.', 'Explore uptime, response times, and failed checks.'] : titles[page];
  app.innerHTML = `<div class="dashboard">${navigation()}<main class="main"><header class="topbar"><span class="breadcrumb">Workspace <span>/</span> ${page === 'monitors' ? 'Overview' : page === 'health' ? 'Health monitoring' : page === 'activity' ? 'Check history' : 'Account'}</span><div><span class="private-label">${icon('shield')} Private workspace</span><span class="avatar small">${e((session.user.email ?? 'U')[0].toUpperCase())}</span></div></header><div class="main-content"><div class="page-heading"><div><div class="section-kicker">${page === 'monitors' ? 'YOUR BACKEND COMPANION' : 'YOUR WORKSPACE'}</div><h1>${page === 'health' ? 'A clearer picture of health.' : title}</h1><p>${page === 'health' ? 'Explore uptime, response times, and failed checks.' : subtitle}</p></div>${page === 'settings' ? '' : `<button class="primary" data-action="add">${icon('plus')} Add endpoint</button>`}</div>${loadError ? `<div class="error-banner" role="alert">${icon('pulse')}<span>${e(loadError)}</span><button class="text-button" data-action="refresh">Try again</button></div>` : ''}${page === 'monitors' ? `${stats()}<section class="endpoints-section"><div class="section-heading"><h2>Your endpoints <span>${monitors.length}</span></h2><button class="text-button refresh-button" data-action="refresh" ${loading ? 'disabled' : ''}>${icon('refresh', loading ? 'spin' : '')}${loading ? 'Refreshing' : 'Refresh'}</button></div><div class="list-toolbar"><div class="filters" role="group" aria-label="Filter endpoints">${['all', 'active', 'paused'].map(f => `<button data-filter="${f}" class="${filter === f ? 'selected' : ''}">${f === 'all' ? 'All endpoints' : f === 'active' ? 'Active' : 'Paused'}</button>`).join('')}</div><div class="search-wrap">${icon('search')}<input type="search" id="endpoint-search" aria-label="Search endpoints" placeholder="Search endpoints…" value="${e(search)}" /></div></div><div id="monitor-list">${monitorList()}</div></section><div class="calm-note">${icon('shield')} Saved securely. Checked in the cloud. Yours to control.<span>Refreshes every 30 seconds</span></div>` : page === 'health' ? monitoringView(monitors, checks, { days: healthDays, monitorId: healthMonitorId }, e) : page === 'activity' ? historyTable() : accountPanel()}<footer class="dashboard-footer"><span>KEEP BUILDING. WE’LL KEEP CHECKING.</span><span>get web health<span class="brand-dot">.</span></span></footer></div></main></div>`;
  if (page !== 'settings' && !loading && !loadError) {
    const schedulerHealthy = scheduler?.last_run_at && Date.now() - new Date(scheduler.last_run_at).getTime() < 180000;
    const notice = document.createElement('div');
    notice.className = schedulerHealthy ? 'scheduler-indicator' : 'error-banner';
    notice.innerHTML = `${icon('clock')}<span>${schedulerHealthy ? `Cloud scheduler connected · last run ${e(ago(scheduler.last_run_at))}` : scheduler?.last_run_at ? 'The cloud scheduler has not reported recently. Checks may be delayed.' : 'Cloud scheduling is not connected yet. You can save endpoints; checks begin after the workspace owner finishes setup.'}</span>`;
    document.querySelector('.page-heading').after(notice);
  }
}

function render() { session && !recovery ? renderDashboard() : renderAuth(); }

async function loadWorkspace({ quiet = false } = {}) {
  if (!session || recovery || loading) return;
  const userId = session.user.id;
  loading = true;
  if (!quiet && !document.querySelector('dialog[open]')) renderDashboard();
  try {
    const [m, c, s] = await Promise.all([
      supabase.from('monitors').select('*').order('created_at', { ascending: false }),
      supabase.from('health_checks').select('*').order('checked_at', { ascending: false }).limit(200),
      supabase.from('scheduler_status').select('last_run_at').eq('id', true).maybeSingle(),
    ]);
    if (!session || session.user.id !== userId) return;
    if (m.error) throw m.error;
    if (c.error) throw c.error;
    if (s.error) throw s.error;
    monitors = m.data; checks = c.data; scheduler = s.data; loadError = '';
  } catch (error) { if (session?.user.id === userId) loadError = errorText(error); }
  finally {
    loading = false;
    if (session?.user.id === userId && !recovery && !document.querySelector('dialog[open]')) renderDashboard();
  }
}

function startPolling() { clearInterval(pollTimer); pollTimer = setInterval(() => { if (document.visibilityState === 'visible') void loadWorkspace({ quiet: true }); }, 30000); }

function showMonitorDialog(monitor = null) {
  const dialog = document.createElement('dialog');
  dialog.className = 'monitor-dialog';
  dialog.innerHTML = `<div class="dialog-top"><span class="endpoint-icon">${icon('link')}</span><button class="icon-button" data-close-dialog aria-label="Close dialog">${icon('close')}</button></div><span class="section-kicker">${monitor ? 'MAKE IT YOURS' : 'ONE MORE THING LOOKED AFTER'}</span><h2>${monitor ? 'Edit your endpoint.' : 'Add a backend.'}</h2><p class="muted">Give it a name, a health URL, and a little attention.</p><form id="monitor-form"><label for="monitor-name">Endpoint name</label><input id="monitor-name" name="name" placeholder="My side project" maxlength="80" value="${e(monitor?.name ?? '')}" required /><label for="monitor-url">Backend health URL</label><input id="monitor-url" name="url" type="url" placeholder="https://your-app.onrender.com/health" maxlength="2048" value="${e(monitor?.url ?? '')}" required /><small class="field-help">A root URL automatically gets /health added. Render, Railway, Fly, Vercel and Workers are supported.</small><label for="monitor-interval">Check every</label><select id="monitor-interval" name="interval">${[5, 10, 15, 30, 60].map(n => `<option value="${n}" ${n === (monitor?.interval_minutes ?? 10) ? 'selected' : ''}>${n} minutes${n === 10 ? ' · Recommended' : ''}</option>`).join('')}</select><div class="schedule-note">${icon('clock')}<span>Scheduled checks continue when you close this page. New endpoints wait for their first cloud check.</span></div><p id="monitor-error" class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary" data-close-dialog>Cancel</button><button type="submit" class="primary">${monitor ? 'Save changes' : 'Add endpoint'}${icon('arrow')}</button></div></form>`;
  app.append(dialog); dialog.showModal();
  dialog.addEventListener('click', event => { if (event.target.closest('[data-close-dialog]')) dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true;
    const data = new FormData(event.target);
    try {
      const values = { name: data.get('name').trim(), url: normalizeEndpoint(data.get('url')), interval_minutes: Number(data.get('interval')) };
      if (!values.name) throw new Error('Give your endpoint a name.');
      const result = monitor ? await supabase.from('monitors').update(values).eq('id', monitor.id).select('id').single() : await supabase.from('monitors').insert({ ...values, user_id: session.user.id }).select('id').single();
      if (result.error) throw result.error;
      dialog.close(); toast(monitor ? 'Endpoint updated.' : 'Endpoint saved. Awaiting its first scheduled check.'); await loadWorkspace();
    } catch (error) { dialog.querySelector('#monitor-error').textContent = errorText(error); }
    finally { button.disabled = false; }
  });
}

function deleteDialog(monitor) {
  const dialog = document.createElement('dialog'); dialog.className = 'monitor-dialog';
  dialog.innerHTML = `<div class="dialog-top"><span class="endpoint-icon">${icon('trash')}</span><button class="icon-button" data-close-dialog aria-label="Close">${icon('close')}</button></div><h2>Remove this endpoint?</h2><p class="muted">${e(monitor.name)} and its check history will be permanently deleted.</p><p class="form-error" role="alert"></p><div class="dialog-actions"><button class="secondary" data-close-dialog>Keep endpoint</button><button class="primary danger" id="confirm-delete">Delete endpoint</button></div>`;
  app.append(dialog); dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', async event => {
    if (event.target.closest('[data-close-dialog]')) { dialog.close(); return; }
    const button = event.target.closest('#confirm-delete'); if (!button) return; button.disabled = true;
    try { const { error } = await supabase.from('monitors').delete().eq('id', monitor.id); if (error) throw error; dialog.close(); toast('Endpoint removed.'); await loadWorkspace(); }
    catch (error) { dialog.querySelector('.form-error').textContent = errorText(error); button.disabled = false; }
  });
}

app.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  if (button.dataset.authMode) { authMode = button.dataset.authMode; authError = ''; authNotice = ''; if (authMode === 'login') recovery = false; render(); return; }
  if (button.dataset.page) { page = button.dataset.page; renderDashboard(); return; }
  if (button.dataset.filter) { filter = button.dataset.filter; renderDashboard(); return; }
  const action = button.dataset.action;
  if (action === 'show-password') { const field = document.querySelector('#password'); field.type = field.type === 'password' ? 'text' : 'password'; button.setAttribute('aria-label', field.type === 'password' ? 'Show password' : 'Hide password'); return; }
  if (!session) return;
  if (action === 'add') { showMonitorDialog(); return; }
  if (action === 'refresh') { await loadWorkspace(); return; }
  if (action === 'logout') { button.disabled = true; const { error } = await supabase.auth.signOut(); if (error) { toast(errorText(error)); button.disabled = false; } return; }
  const monitor = monitors.find(m => m.id === button.dataset.id); if (!monitor) return;
  if (action === 'edit') { showMonitorDialog(monitor); return; }
  if (action === 'delete') { deleteDialog(monitor); return; }
  button.disabled = true;
  try {
    if (action === 'toggle') { const wasEnabled = monitor.enabled; const { error } = await supabase.from('monitors').update({ enabled: !wasEnabled }).eq('id', monitor.id); if (error) throw error; toast(wasEnabled ? 'Schedule paused.' : 'Schedule resumed.'); }
    if (action === 'ping') {
      const { data, error } = await supabase.functions.invoke('health-worker', { body: { monitor_id: monitor.id } });
      if (error) {
        let message = 'Could not run this check. Make sure the cloud scheduler has been deployed.';
        try { const body = await error.context.json(); message = body.error || message; } catch {}
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      toast(data.result?.status === 'up' ? 'Endpoint responded successfully.' : `Check complete: ${data.result?.error || 'endpoint is not responding'}.`);
    }
    await loadWorkspace();
  } catch (error) { toast(errorText(error)); }
  finally { button.disabled = false; }
});

app.addEventListener('input', event => { if (event.target.id === 'endpoint-search') { search = event.target.value; document.querySelector('#monitor-list').innerHTML = monitorList(); } });
app.addEventListener('submit', async event => {
  if (event.target.id !== 'auth-form') return;
  event.preventDefault(); const button = event.submitter; const data = new FormData(event.target); button.disabled = true;
  document.querySelector('#auth-error').textContent = ''; document.querySelector('#auth-notice').textContent = '';
  try {
    const email = String(data.get('email') ?? '').trim(), password = String(data.get('password') ?? '');
    if (['signup', 'reset'].includes(authMode) && password !== data.get('confirm')) throw new Error('The passwords don’t match. Please try again.');
    const redirectTo = location.origin + location.pathname;
    if (authMode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo }); if (error) throw error;
      document.querySelector('#auth-notice').textContent = 'If an account exists for this email, a reset link is on its way. Check your inbox.';
    } else if (authMode === 'reset') {
      const { error } = await supabase.auth.updateUser({ password }); if (error) throw error;
      recovery = false; authMode = 'login'; toast('Password updated.'); render(); startPolling(); await loadWorkspace();
    } else if (authMode === 'signup') {
      const { data: result, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } }); if (error) throw error;
      if (!result.session) { document.querySelector('#auth-notice').textContent = 'Check your inbox to confirm your email, then come back to log in.'; }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error;
    }
  } catch (error) { const field = document.querySelector('#auth-error'); if (field) field.textContent = errorText(error); }
  finally { button.disabled = false; }
});

supabase.auth.onAuthStateChange((event, nextSession) => {
  const prior = session?.user.id; session = nextSession;
  if (event === 'PASSWORD_RECOVERY') { recovery = true; authMode = 'reset'; renderAuth(); return; }
  if (!session) { monitors = []; checks = []; scheduler = null; loadError = ''; page = 'monitors'; recovery = false; renderAuth(); return; }
  if (prior !== session.user.id || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
    if (recovery) { authMode = 'reset'; renderAuth(); return; }
    renderDashboard(); startPolling(); setTimeout(() => void loadWorkspace(), 0);
  }
});

const callbackError = new URLSearchParams(location.hash.slice(1)).get('error_description');
if (callbackError) authError = callbackError;
renderAuth();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session) void loadWorkspace({ quiet: true }); });

app.addEventListener('change', event => {
  if (event.target.id === 'health-range') { healthDays = Number(event.target.value) === 7 ? 7 : 1; renderDashboard(); }
  if (event.target.id === 'health-endpoint') { healthMonitorId = event.target.value; renderDashboard(); }
});
