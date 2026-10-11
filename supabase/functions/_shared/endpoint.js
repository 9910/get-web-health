export const DEFAULT_HOST_SUFFIXES = ['onrender.com', 'up.railway.app', 'fly.dev', 'vercel.app', 'workers.dev'];

export function normalizeEndpoint(raw) {
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error('Enter a full URL, starting with https://.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Use a public HTTPS URL without credentials or a custom port.');
  const hostname = url.hostname.toLowerCase();
  if (!hostname.includes('.') || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.startsWith('[') || /^[\d.]+$/.test(hostname)) throw new Error('Use a public backend hostname, not a local address.');
  if (url.hash) throw new Error('Remove the #fragment from the endpoint URL.');
  if (url.pathname === '/') url.pathname = '/health';
  return url.toString();
}

export function approvedEndpoint(raw, extraHosts = []) {
  const normalized = normalizeEndpoint(raw);
  const host = new URL(normalized).hostname;
  if (!DEFAULT_HOST_SUFFIXES.some(suffix => host.endsWith('.' + suffix)) && !extraHosts.includes(host)) throw new Error('This hostname is not enabled. Use Render, Railway, Fly, Vercel or Workers, or ask the workspace owner to allow your custom hostname.');
  return normalized;
}

export function monitorState(monitor, now = Date.now()) {
  if (!monitor.enabled) return 'paused';
  if (!monitor.last_checked_at) return 'pending';
  if (now - new Date(monitor.last_checked_at).getTime() > (monitor.interval_minutes * 2 + 2) * 60000) return 'overdue';
  return monitor.last_status === 'up' ? 'up' : 'down';
}

export async function checkEndpoint(raw, { fetcher = fetch, extraHosts = [], timeoutMs = 85000 } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = approvedEndpoint(raw, extraHosts);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetcher(current, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'GetWebHealth/1.0' } });
      await response.body?.cancel();
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === 3) throw new Error('Too many redirects.');
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect is missing a destination.');
        current = approvedEndpoint(new URL(location, current).toString(), extraHosts);
        continue;
      }
      return { status: response.ok ? 'up' : 'down', http_code: response.status, response_ms: Date.now() - started, error: response.ok ? null : `Endpoint returned HTTP ${response.status}.` };
    }
  } catch (error) {
    return { status: 'down', http_code: null, response_ms: Date.now() - started, error: error.name === 'AbortError' ? 'Request timed out after 85 seconds.' : String(error.message).slice(0, 350) };
  } finally { clearTimeout(timeout); }
}
