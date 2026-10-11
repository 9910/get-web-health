import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { checkEndpoint } from '../_shared/endpoint.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const extraHosts = (Deno.env.get('ALLOWED_HEALTH_HOSTS') ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);

async function sameSecret(provided: string, expected: string) {
  const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([hash(provided), hash(expected)]);
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  try {
    const secret = Deno.env.get('HEALTH_CRON_SECRET');
    const presented = req.headers.get('x-cron-secret');
    const scheduler = Boolean(secret && presented && await sameSecret(presented, secret));
    let monitorId: string | null = null, userId: string | null = null;
    if (!scheduler) {
      const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
      if (!token) return json({ error: 'Sign in to run a check.' }, 401);
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) return json({ error: 'Your session expired. Please sign in again.' }, 401);
      userId = data.user.id;
      const body = await req.json();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.monitor_id ?? '')) return json({ error: 'Select a valid endpoint.' }, 400);
      monitorId = body.monitor_id;
      const { data: owned, error: ownershipError } = await admin.from('monitors').select('id').eq('id', monitorId).eq('user_id', userId).maybeSingle();
      if (ownershipError) throw ownershipError;
      if (!owned) return json({ error: 'Endpoint not found.' }, 404);
    }
    const { data: claimed, error: claimError } = await admin.rpc('claim_health_checks', { p_monitor_id: monitorId, p_user_id: userId });
    if (claimError) throw claimError;
    if (!scheduler && !claimed.length) return json({ error: 'A check is already running or was started in the last minute. Try again shortly.' }, 429);
    const results = await Promise.all(claimed.map(async (monitor: { id: string; url: string; lease_id: string }) => {
      const result = await checkEndpoint(monitor.url, { extraHosts });
      const { data: saved, error } = await admin.rpc('complete_health_check', {
        p_monitor_id: monitor.id, p_lease_id: monitor.lease_id, p_status: result.status,
        p_http_code: result.http_code, p_response_ms: result.response_ms, p_error: result.error,
      });
      if (error) throw error;
      return { ...result, saved };
    }));
    if (scheduler) {
      const { error } = await admin.from('scheduler_status').update({ last_run_at: new Date().toISOString() }).eq('id', true);
      if (error) throw error;
    }
    if (!scheduler && !results[0]?.saved) return json({ error: 'The endpoint changed while this check was running. Refresh and try again.' }, 409);
    return json(scheduler ? { checked: results.length } : { result: results[0] });
  } catch (error) {
    console.error('Health worker failed:', error instanceof Error ? error.message : 'Database operation failed');
    return json({ error: 'The check could not be completed. Review the scheduler setup and try again.' }, 500);
  }
});
