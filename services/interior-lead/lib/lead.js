// Shared lead schema, validation, scoring and email rendering for the
// WeThru Interior qualification form. Pure functions only (no I/O) so the
// handler stays thin and everything here is unit-testable.

export const OPTIONS = {
  field: {
    residential: '아파트·주거',
    commercial: '상업공간',
    cafe: '카페·외식',
    office: '오피스',
    remodeling: '리모델링',
    other: '기타',
  },
  channels: {
    instagram: 'Instagram',
    blog: '블로그',
    ohouse: '오늘의집',
    website: '홈페이지',
    none: '없음',
    other: '기타',
  },
  painPoint: {
    unorganized: '작업물이 정리되어 있지 않음',
    noDifferentiation: '업체 차별점이 잘 보이지 않음',
    outdatedSite: '홈페이지가 오래됨',
    noInquiryFlow: '문의 동선이 없음',
    noTime: '직접 관리할 시간이 없음',
    other: '기타',
  },
  projectCount: {
    lt5: '5개 미만',
    '5to10': '5~10개',
    '10to30': '10~30개',
    gt30: '30개 이상',
  },
  showFirst: {
    cases: '시공 사례',
    brand: '대표·브랜드',
    specialty: '전문 분야',
    design: '설계 능력',
    consultation: '상담 과정',
    other: '기타',
  },
  threeD: {
    no: '필요 없음',
    interested: '관심 있음',
    yes: '필요함',
    later: '상담 후 결정',
  },
  budget: {
    lt100: '100만원 미만',
    '100to150': '100~150만원',
    '150to300': '150~300만원',
    gt300: '300만원 이상',
    unknown: '아직 모르겠음',
  },
  startTiming: {
    asap: '가능한 빨리',
    within2w: '2주 이내',
    within1m: '1개월 이내',
    '1to3m': '1~3개월',
    exploring: '아직 알아보는 중',
  },
  intent: {
    now: '바로 진행하고 싶음',
    conditional: '조건이 맞으면 진행',
    comparing: '비교 검토 중',
    researching: '정보 수집 중',
  },
};

const TEXT_LIMITS = { company: 60, owner: 40, region: 60, phone: 20, email: 120, links: 300, notes: 1000 };
const REQUIRED_TEXT = ['company', 'region', 'phone', 'email'];
const REQUIRED_SINGLE = ['field', 'painPoint', 'budget', 'startTiming', 'intent'];
const OPTIONAL_SINGLE = ['projectCount', 'threeD'];
const MULTI = ['channels', 'showFirst'];
const REQUIRED_MULTI = ['channels'];

export const MIN_FILL_MS = 3000;

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/;

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  // collapse control characters (keeps newlines for notes) and trim
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function phoneDigits(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

/**
 * Validate and normalise a raw payload.
 * Returns { ok: true, lead } or { ok: false, errors: { field: code } }.
 * Bot signals are reported separately so the caller can drop them silently.
 */
export function validateLead(raw) {
  const errors = {};
  const input = raw && typeof raw === 'object' ? raw : {};
  const lead = {};

  for (const key of Object.keys(TEXT_LIMITS)) {
    const value = cleanText(input[key], TEXT_LIMITS[key]);
    // single-line fields (subject, headers, table cells) never keep line breaks
    lead[key] = key === 'notes' ? value : value.replace(/\s+/g, ' ');
  }
  for (const key of REQUIRED_TEXT) {
    if (!lead[key]) errors[key] = 'required';
  }
  if (lead.email && !EMAIL_RE.test(lead.email)) errors.email = 'invalid';
  const digits = phoneDigits(lead.phone);
  if (lead.phone && (digits.length < 9 || digits.length > 12)) errors.phone = 'invalid';

  for (const key of [...REQUIRED_SINGLE, ...OPTIONAL_SINGLE]) {
    const value = typeof input[key] === 'string' ? input[key] : '';
    if (value && !Object.hasOwn(OPTIONS[key], value)) errors[key] = 'invalid';
    else lead[key] = value;
    if (REQUIRED_SINGLE.includes(key) && !value) errors[key] = 'required';
  }

  for (const key of MULTI) {
    const list = Array.isArray(input[key]) ? input[key] : [];
    const unique = [...new Set(list.filter((v) => typeof v === 'string'))];
    if (unique.some((v) => !Object.hasOwn(OPTIONS[key], v))) errors[key] = 'invalid';
    lead[key] = unique.filter((v) => Object.hasOwn(OPTIONS[key], v));
    if (REQUIRED_MULTI.includes(key) && lead[key].length === 0) errors[key] = 'required';
  }
  // "없음" is exclusive
  if (lead.channels.includes('none') && lead.channels.length > 1) {
    lead.channels = lead.channels.filter((v) => v !== 'none');
  }

  if (input.consentPrivacy !== true) errors.consentPrivacy = 'required';
  lead.consentPrivacy = input.consentPrivacy === true;
  lead.consentMarketing = input.consentMarketing === true;

  lead.page = cleanText(input.page, 300);
  lead.referrer = cleanText(input.referrer, 300);

  const elapsed = Number(input.elapsedMs);
  const bot = {
    honeypot: typeof input.website === 'string' && input.website.trim() !== '',
    tooFast: !Number.isFinite(elapsed) || elapsed < MIN_FILL_MS,
  };

  if (Object.keys(errors).length) return { ok: false, errors, bot };
  return { ok: true, lead, bot };
}

const BUDGET_PTS = { lt100: 0, '100to150': 2, '150to300': 3, gt300: 3, unknown: 1 };
const TIMING_PTS = { asap: 3, within2w: 3, within1m: 2, '1to3m': 1, exploring: 0 };
const INTENT_PTS = { now: 3, conditional: 2, comparing: 1, researching: 0 };

/** Internal-only qualification. Never shown to the visitor. */
export function scoreLead(lead) {
  const score = (BUDGET_PTS[lead.budget] ?? 0) + (TIMING_PTS[lead.startTiming] ?? 0) + (INTENT_PTS[lead.intent] ?? 0);
  const budgetOk = ['100to150', '150to300', 'gt300'].includes(lead.budget);
  const soon = ['asap', 'within2w', 'within1m'].includes(lead.startTiming);
  const willing = ['now', 'conditional'].includes(lead.intent);
  let tier = 'MEDIUM';
  if (budgetOk && soon && willing) tier = 'HIGH';
  else if (lead.budget === 'lt100' && lead.intent === 'researching') tier = 'LOW';
  return { tier, score, max: 9 };
}

const label = (group, value) => OPTIONS[group][value] || '';
const labels = (group, list) => (list || []).map((v) => label(group, v)).filter(Boolean).join(', ');

export function leadRows(lead) {
  return [
    ['업체 정보', [
      ['업체명', lead.company],
      ['대표자', lead.owner],
      ['지역', lead.region],
      ['전화번호', lead.phone],
      ['이메일', lead.email],
      ['온라인 주소', lead.links],
    ]],
    ['현재 상황', [
      ['주력 분야', label('field', lead.field)],
      ['온라인 채널', labels('channels', lead.channels)],
      ['가장 아쉬운 점', label('painPoint', lead.painPoint)],
    ]],
    ['프로젝트', [
      ['보유 프로젝트 수', label('projectCount', lead.projectCount)],
      ['먼저 보여주고 싶은 것', labels('showFirst', lead.showFirst)],
      ['3D 렌더링', label('threeD', lead.threeD)],
    ]],
    ['상담', [
      ['예상 예산', label('budget', lead.budget)],
      ['시작 희망 시점', label('startTiming', lead.startTiming)],
      ['제작 의향', label('intent', lead.intent)],
      ['추가 요청', lead.notes],
    ]],
  ];
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
}

function kst(date) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function renderEmail(lead, quality, receivedAt = new Date()) {
  const subject = `[WeThru Interior] 신규 상담 — ${lead.company}`.slice(0, 180);
  const rows = leadRows(lead);
  const meta = [
    ['접수 시각', `${kst(receivedAt)} (KST)`],
    ['리드 판단', `${quality.tier} · ${quality.score}/${quality.max}`],
    ['개인정보 수집·이용', lead.consentPrivacy ? '동의 (필수)' : '미동의'],
    ['마케팅 정보 수신', lead.consentMarketing ? '동의' : '동의하지 않음'],
    ['신청 페이지', lead.page],
    ['유입 경로', lead.referrer || '직접 방문'],
  ];

  const cell = 'padding:8px 12px;border-bottom:1px solid #e3e1da;vertical-align:top;font-size:14px;line-height:1.6';
  const table = (title, items) =>
    `<h3 style="margin:28px 0 8px;font-size:13px;color:#676862;font-weight:600">${escapeHtml(title)}</h3>` +
    `<table role="presentation" style="width:100%;border-collapse:collapse;border-top:1px solid #151714">` +
    items.map(([k, v]) => `<tr><th align="left" style="${cell};width:150px;color:#4e504a;font-weight:500">${escapeHtml(k)}</th><td style="${cell};color:#151714;white-space:pre-wrap">${escapeHtml(v || '—')}</td></tr>`).join('') +
    `</table>`;

  const tierColor = { HIGH: '#9c6a3b', MEDIUM: '#4e504a', LOW: '#8a8b85' }[quality.tier];
  const html =
    `<div style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:640px;color:#151714">` +
    `<p style="margin:0 0 4px;font-size:12px;color:#676862">WeThru Interior · 상담 신청</p>` +
    `<h2 style="margin:0;font-size:22px;font-weight:600">${escapeHtml(lead.company)}</h2>` +
    `<p style="margin:8px 0 0;font-size:13px;color:${tierColor};font-weight:600">${escapeHtml(quality.tier)} INTENT · ${quality.score}/${quality.max}</p>` +
    `<p style="margin:16px 0 0;font-size:14px"><a href="tel:${escapeHtml(phoneDigits(lead.phone))}">${escapeHtml(lead.phone)}</a> · <a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a></p>` +
    rows.map(([title, items]) => table(title, items)).join('') +
    table('접수 정보', meta) +
    `<p style="margin:28px 0 0;font-size:12px;color:#676862">리드 판단은 내부 참고용이며 신청자에게 표시되지 않습니다.</p></div>`;

  const text = [
    `[WeThru Interior] 신규 상담 — ${lead.company}`,
    `리드 판단: ${quality.tier} (${quality.score}/${quality.max})`,
    '',
    ...rows.flatMap(([title, items]) => [`■ ${title}`, ...items.map(([k, v]) => `${k}: ${v || '—'}`), '']),
    '■ 접수 정보',
    ...meta.map(([k, v]) => `${k}: ${v || '—'}`),
  ].join('\n');

  return { subject, html, text };
}
