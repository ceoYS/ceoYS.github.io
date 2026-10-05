import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { validateLead, scoreLead, renderEmail, escapeHtml } from '../lib/lead.js';
import handler from '../api/lead.js';

const valid = () => ({
  company: '테스트 인테리어', owner: '홍길동', region: '부산 수영구', phone: '010-1234-5678', email: 'owner@example.com', links: '@test_interior',
  field: 'residential', channels: ['instagram', 'blog'], painPoint: 'noTime',
  projectCount: '10to30', showFirst: ['cases', 'brand'], threeD: 'interested',
  budget: '100to150', startTiming: 'within2w', intent: 'conditional', notes: '추가 요청 <b>없음</b>',
  consentPrivacy: true, consentMarketing: false, website: '', elapsedMs: 45000, page: 'https://ceoys.github.io/wethru/interior/', referrer: '',
});

test('valid payload passes and normalises', () => {
  const r = validateLead(valid());
  assert.equal(r.ok, true);
  assert.deepEqual(r.lead.channels, ['instagram', 'blog']);
  assert.equal(r.bot.honeypot, false);
  assert.equal(r.bot.tooFast, false);
});

test('required fields, enums, email, phone and consent are enforced', () => {
  const p = { ...valid(), company: ' ', email: 'nope', phone: '12', budget: 'free', channels: [], consentPrivacy: 'yes' };
  const r = validateLead(p);
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['budget', 'channels', 'company', 'consentPrivacy', 'email', 'phone'].sort());
});

test('single-line fields lose line breaks, notes keep them', () => {
  const r = validateLead({ ...valid(), company: 'A\r\nBcc: x@y.z', notes: '첫 줄\n둘째 줄' });
  assert.equal(r.lead.company, 'A Bcc: x@y.z');
  assert.equal(r.lead.notes, '첫 줄\n둘째 줄');
  assert.ok(!renderEmail(r.lead, scoreLead(r.lead)).subject.includes('\n'));
});

test('optional step-3 answers may be empty', () => {
  const r = validateLead({ ...valid(), projectCount: '', showFirst: [], threeD: '' });
  assert.equal(r.ok, true);
});

test('"none" channel is dropped when combined with real channels', () => {
  const r = validateLead({ ...valid(), channels: ['none', 'instagram'] });
  assert.deepEqual(r.lead.channels, ['instagram']);
});

test('bot signals', () => {
  assert.equal(validateLead({ ...valid(), website: 'http://spam' }).bot.honeypot, true);
  assert.equal(validateLead({ ...valid(), elapsedMs: 800 }).bot.tooFast, true);
});

test('scoring tiers', () => {
  assert.equal(scoreLead({ budget: '150to300', startTiming: 'asap', intent: 'now' }).tier, 'HIGH');
  assert.equal(scoreLead({ budget: '100to150', startTiming: 'within1m', intent: 'conditional' }).tier, 'HIGH');
  assert.equal(scoreLead({ budget: 'lt100', startTiming: 'asap', intent: 'researching' }).tier, 'LOW');
  assert.equal(scoreLead({ budget: 'unknown', startTiming: 'within2w', intent: 'now' }).tier, 'MEDIUM');
  assert.equal(scoreLead({ budget: 'gt300', startTiming: '1to3m', intent: 'now' }).tier, 'MEDIUM');
});

test('email is escaped and has the expected subject', () => {
  const { lead } = validateLead({ ...valid(), company: '<script>x</script>' });
  const mail = renderEmail(lead, scoreLead(lead), new Date('2026-10-06T01:00:00Z'));
  assert.equal(mail.subject, '[WeThru Interior] 신규 상담 — <script>x</script>');
  assert.ok(!mail.html.includes('<script>'));
  assert.ok(mail.html.includes('&lt;b&gt;없음&lt;/b&gt;'));
  assert.ok(mail.text.includes('예상 예산: 100~150만원'));
  assert.equal(escapeHtml(`"'&`), '&quot;&#39;&amp;');
});

// ---- handler ----
function mockReq({ method = 'POST', origin = 'https://ceoys.github.io', body, headers = {} } = {}) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from(raw ? [raw] : []);
  req.method = method;
  req.headers = { origin, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(raw)), 'x-forwarded-for': headers.ip || `10.0.0.${Math.floor(Math.random() * 250)}`, ...headers };
  return req;
}
function mockRes() {
  const res = { statusCode: 200, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = (b = '') => { res.body = b; res.done = true; };
  return res;
}
const json = (res) => JSON.parse(res.body || '{}');

test('handler: preflight from allowed origin, reject others', async () => {
  let res = mockRes(); await handler(mockReq({ method: 'OPTIONS' }), res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], 'https://ceoys.github.io');
  res = mockRes(); await handler(mockReq({ origin: 'https://evil.example', body: valid() }), res);
  assert.equal(res.statusCode, 403);
});

test('handler: 503 when email env is missing', async () => {
  delete process.env.EMAIL_PROVIDER_API_KEY;
  const res = mockRes(); await handler(mockReq({ body: valid() }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(json(res).error, 'not_configured');
});

test('handler: invalid payload returns field errors', async () => {
  const res = mockRes(); await handler(mockReq({ body: { ...valid(), email: '' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(json(res).fields.email, 'required');
});

test('handler: honeypot gets silent success and sends nothing', async () => {
  let called = false;
  const orig = globalThis.fetch; globalThis.fetch = async () => { called = true; return { ok: true }; };
  Object.assign(process.env, { EMAIL_PROVIDER_API_KEY: 'k', SUBMISSION_NOTIFICATION_EMAIL: 'to@example.com', EMAIL_FROM: 'WeThru <from@example.com>' });
  const res = mockRes(); await handler(mockReq({ body: { ...valid(), website: 'x' } }), res);
  globalThis.fetch = orig;
  assert.equal(res.statusCode, 200);
  assert.equal(called, false);
});

test('handler: sends Resend request with reply_to and subject', async () => {
  let sent;
  const orig = globalThis.fetch; globalThis.fetch = async (url, init) => { sent = { url, init }; return { ok: true, status: 200 }; };
  Object.assign(process.env, { EMAIL_PROVIDER_API_KEY: 'k', SUBMISSION_NOTIFICATION_EMAIL: 'to@example.com', EMAIL_FROM: 'WeThru <from@example.com>' });
  const res = mockRes(); await handler(mockReq({ body: valid() }), res);
  globalThis.fetch = orig;
  assert.equal(res.statusCode, 200);
  assert.equal(sent.url, 'https://api.resend.com/emails');
  const payload = JSON.parse(sent.init.body);
  assert.equal(payload.subject, '[WeThru Interior] 신규 상담 — 테스트 인테리어');
  assert.equal(payload.reply_to, 'owner@example.com');
  assert.deepEqual(payload.to, ['to@example.com']);
  assert.equal(sent.init.headers.Authorization, 'Bearer k');
});

test('handler: provider failure surfaces as 502', async () => {
  const orig = globalThis.fetch; globalThis.fetch = async () => ({ ok: false, status: 422 });
  const res = mockRes(); await handler(mockReq({ body: valid() }), res);
  globalThis.fetch = orig;
  assert.equal(res.statusCode, 502);
});

test('handler: rate limit per IP', async () => {
  const orig = globalThis.fetch; globalThis.fetch = async () => ({ ok: true, status: 200 });
  let last;
  for (let i = 0; i < 6; i++) { last = mockRes(); await handler(mockReq({ body: valid(), headers: { ip: '192.168.9.9' } }), last); }
  globalThis.fetch = orig;
  assert.equal(last.statusCode, 429);
});
