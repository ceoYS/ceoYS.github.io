// POST /api/lead — receives the WeThru Interior qualification form and
// emails it to WeThru through Resend. Secrets live only in the Vercel
// project environment; nothing here is shipped to the browser.
//
// Env (same names as the existing WeThru Google-Biz intake app):
//   EMAIL_PROVIDER_API_KEY        Resend API key (secret)
//   SUBMISSION_NOTIFICATION_EMAIL where leads are delivered
//   EMAIL_FROM                    verified Resend sender, e.g. "WeThru <...@auth.nitual.com>"
//   ALLOWED_ORIGINS               optional, comma separated (defaults below)

import { validateLead, scoreLead, renderEmail } from '../lib/lead.js';

const DEFAULT_ORIGINS = ['https://ceoys.github.io'];
const MAX_BODY_BYTES = 20_000;
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 5;
const hits = new Map(); // best effort, per warm instance

function allowedOrigins() {
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

function rateLimited(ip, now = Date.now()) {
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > RATE_MAX;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === 'string' ? req.body : '';
  if (!raw) {
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) throw Object.assign(new Error('too_large'), { status: 413 });
    }
  }
  if (raw.length > MAX_BODY_BYTES) throw Object.assign(new Error('too_large'), { status: 413 });
  try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('bad_json'), { status: 400 }); }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = allowedOrigins();
  if (allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') { res.statusCode = allowed.has(origin) ? 204 : 403; return res.end(); }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  if (!allowed.has(origin)) return send(res, 403, { ok: false, error: 'origin_not_allowed' });
  if (!String(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { ok: false, error: 'json_only' });
  if (Number(req.headers['content-length'] || 0) > MAX_BODY_BYTES) return send(res, 413, { ok: false, error: 'too_large' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) return send(res, 429, { ok: false, error: 'rate_limited' });

  let body;
  try { body = await readBody(req); } catch (e) { return send(res, e.status || 400, { ok: false, error: e.message }); }

  const result = validateLead(body);
  // Bots get the same success shape so they learn nothing; nothing is sent.
  if (result.bot.honeypot || result.bot.tooFast) return send(res, 200, { ok: true });
  if (!result.ok) return send(res, 400, { ok: false, error: 'invalid', fields: result.errors });

  const { EMAIL_PROVIDER_API_KEY: key, SUBMISSION_NOTIFICATION_EMAIL: to, EMAIL_FROM: from } = process.env;
  if (!key || !to || !from) return send(res, 503, { ok: false, error: 'not_configured' });

  const quality = scoreLead(result.lead);
  const mail = renderEmail(result.lead, quality);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], reply_to: result.lead.email, subject: mail.subject, html: mail.html, text: mail.text, tags: [{ name: 'tier', value: quality.tier }] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return send(res, 502, { ok: false, error: `email_http_${r.status}` });
  } catch {
    return send(res, 502, { ok: false, error: 'email_failed' });
  }
  return send(res, 200, { ok: true });
}
