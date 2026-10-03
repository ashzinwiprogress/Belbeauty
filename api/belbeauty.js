/**
 * BELBEAUTY — /api/belbeauty (Vercel serverless function)
 * @owner Progress Tech — Bamenda, Cameroon
 *
 * Node equivalent of api.php, for hosts (like Vercel) that don't run PHP.
 * Same contract: POST {endpoint, payload} -> {success, answer, sessionId,
 * model, raw}. The point of this file is CORS: a browser enforces CORS
 * based on headers the THIRD PARTY sends, which the frontend can't control
 * no matter how the fetch is written. A server-to-server request made from
 * here isn't subject to CORS at all, so routing through this endpoint makes
 * every Omegatech route reachable regardless of what CORS headers it does
 * or doesn't send.
 *
 * Zero dependencies — uses the fetch global built into Vercel's Node 18+
 * runtime. Vercel auto-deploys anything under /api as a serverless
 * function, so no extra config is needed beyond this file existing.
 */

const ALLOWED_HOSTS = ['api.omegatech.app', 'omegatech.app'];
const TIMEOUT_MS = 55000; // stay under Vercel's default 60s function limit

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Powered-By', 'Belbeauty (Progress Tech)');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || !body.endpoint) {
    return res.status(400).json({
      success: false,
      error: 'Missing endpoint',
      hint: 'Send JSON: {endpoint: "https://...", payload: {...}}'
    });
  }

  const { endpoint, payload } = body;

  // Only ever relay to Omegatech — this must never become an open proxy.
  let host;
  try { host = new URL(endpoint).hostname; } catch (e) {
    return res.status(400).json({ success: false, error: 'Invalid endpoint URL' });
  }
  const isAllowed = ALLOWED_HOSTS.some(d => host === d || host.endsWith('.' + d));
  if (!isAllowed) {
    return res.status(403).json({ success: false, error: 'Endpoint not allowed. Only Omegatech API permitted.' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Belbeauty-Vercel/1.0 (Progress Tech)',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload || {}),
      signal: controller.signal
    });
    clearTimeout(timer);

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch (e) {
      // Upstream didn't return JSON — pass the raw text back as the answer
      // rather than failing, same as the PHP proxy does.
      return res.status(200).json({ success: true, answer: text, raw: text, via: 'node-proxy-vercel', httpCode: upstream.status });
    }

    if (upstream.status >= 400) {
      return res.status(upstream.status).json({
        success: false,
        error: `Progress Tech returned HTTP ${upstream.status}`,
        raw: data,
        endpoint
      });
    }

    const answer =
      data.answer ?? data.response ?? data.reply ?? data.output ?? data.result ??
      data?.data?.code ?? data?.data?.response ?? data?.data?.reply ?? data?.data?.output ??
      data?.data ?? data.message ?? text;

    const sessionId = data.sessionId ?? data.session_id ?? data?.data?.sessionId ?? null;

    return res.status(200).json({
      success: true,
      answer: typeof answer === 'string' ? answer : JSON.stringify(answer),
      sessionId,
      model: data.model ?? null,
      via: 'node-proxy-vercel',
      httpCode: upstream.status,
      raw: data // full original response, so image/audio URL fields are always reachable too
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    return res.status(502).json({
      success: false,
      error: isTimeout ? `Timed out after ${TIMEOUT_MS / 1000}s waiting on Omegatech` : `Fetch error: ${err.message}`,
      endpoint
    });
  }
};
  
