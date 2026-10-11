// supabase/functions/health-worker/index.ts
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

// supabase/functions/_shared/endpoint.js
var DEFAULT_HOST_SUFFIXES = ["onrender.com", "up.railway.app", "fly.dev", "vercel.app", "workers.dev"];
function normalizeEndpoint(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Enter a full URL, starting with https://.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") throw new Error("Use a public HTTPS URL without credentials or a custom port.");
  const hostname = url.hostname.toLowerCase();
  if (!hostname.includes(".") || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.startsWith("[") || /^[\d.]+$/.test(hostname)) throw new Error("Use a public backend hostname, not a local address.");
  if (url.hash) throw new Error("Remove the #fragment from the endpoint URL.");
  if (url.pathname === "/") url.pathname = "/health";
  return url.toString();
}
function approvedEndpoint(raw, extraHosts2 = []) {
  const normalized = normalizeEndpoint(raw);
  const host = new URL(normalized).hostname;
  if (!DEFAULT_HOST_SUFFIXES.some((suffix) => host.endsWith("." + suffix)) && !extraHosts2.includes(host)) throw new Error("This hostname is not enabled. Use Render, Railway, Fly, Vercel or Workers, or ask the workspace owner to allow your custom hostname.");
  return normalized;
}
async function checkEndpoint(raw, { fetcher = fetch, extraHosts: extraHosts2 = [], timeoutMs = 85e3 } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = approvedEndpoint(raw, extraHosts2);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetcher(current, { method: "GET", redirect: "manual", signal: controller.signal, headers: { "User-Agent": "GetWebHealth/1.0" } });
      await response.body?.cancel();
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === 3) throw new Error("Too many redirects.");
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirect is missing a destination.");
        current = approvedEndpoint(new URL(location, current).toString(), extraHosts2);
        continue;
      }
      return { status: response.ok ? "up" : "down", http_code: response.status, response_ms: Date.now() - started, error: response.ok ? null : `Endpoint returned HTTP ${response.status}.` };
    }
  } catch (error) {
    return { status: "down", http_code: null, response_ms: Date.now() - started, error: error.name === "AbortError" ? "Request timed out after 85 seconds." : String(error.message).slice(0, 350) };
  } finally {
    clearTimeout(timeout);
  }
}

// supabase/functions/health-worker/index.ts
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var json = (body, status = 200) => Response.json(body, { status, headers: cors });
var admin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
var extraHosts = (Deno.env.get("ALLOWED_HEALTH_HOSTS") ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
async function sameSecret(provided, expected) {
  const hash = async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([hash(provided), hash(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const secret = Deno.env.get("HEALTH_CRON_SECRET");
    const presented = req.headers.get("x-cron-secret");
    const scheduler = Boolean(secret && presented && await sameSecret(presented, secret));
    let monitorId = null, userId = null;
    if (!scheduler) {
      const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) return json({ error: "Sign in to run a check." }, 401);
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) return json({ error: "Your session expired. Please sign in again." }, 401);
      userId = data.user.id;
      const body = await req.json();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.monitor_id ?? "")) return json({ error: "Select a valid endpoint." }, 400);
      monitorId = body.monitor_id;
      const { data: owned, error: ownershipError } = await admin.from("monitors").select("id").eq("id", monitorId).eq("user_id", userId).maybeSingle();
      if (ownershipError) throw ownershipError;
      if (!owned) return json({ error: "Endpoint not found." }, 404);
    }
    const { data: claimed, error: claimError } = await admin.rpc("claim_health_checks", { p_monitor_id: monitorId, p_user_id: userId });
    if (claimError) throw claimError;
    if (!scheduler && !claimed.length) return json({ error: "A check is already running or was started in the last minute. Try again shortly." }, 429);
    const results = await Promise.all(claimed.map(async (monitor) => {
      const result = await checkEndpoint(monitor.url, { extraHosts });
      const { data: saved, error } = await admin.rpc("complete_health_check", {
        p_monitor_id: monitor.id,
        p_lease_id: monitor.lease_id,
        p_status: result.status,
        p_http_code: result.http_code,
        p_response_ms: result.response_ms,
        p_error: result.error
      });
      if (error) throw error;
      return { ...result, saved };
    }));
    if (scheduler) {
      const { error } = await admin.from("scheduler_status").update({ last_run_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", true);
      if (error) throw error;
    }
    if (!scheduler && !results[0]?.saved) return json({ error: "The endpoint changed while this check was running. Refresh and try again." }, 409);
    return json(scheduler ? { checked: results.length } : { result: results[0] });
  } catch (error) {
    console.error("Health worker failed:", error instanceof Error ? error.message : "Database operation failed");
    return json({ error: "The check could not be completed. Review the scheduler setup and try again." }, 500);
  }
});
