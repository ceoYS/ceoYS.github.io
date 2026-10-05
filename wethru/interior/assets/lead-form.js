/* WeThru Interior — qualification form (4 steps).
   Posts JSON to the endpoint in form[data-endpoint]. No secrets live here:
   the endpoint holds the email provider key server-side. If delivery fails,
   the visitor keeps their answers and gets email / copy / Kakao fallbacks. */
(() => {
  'use strict';
  const form = document.getElementById('lead');
  if (!form) return;
  const panel = document.getElementById('lead-panel');
  const steps = [...form.querySelectorAll('.lead__step')];
  const marks = [...form.querySelectorAll('.lead__progress li')];
  const stepLabel = form.querySelector('[data-step-label]');
  const btnPrev = form.querySelector('[data-prev]');
  const btnNext = form.querySelector('[data-next]');
  const btnSubmit = form.querySelector('[data-submit]');
  const status = form.querySelector('[data-status]');
  const done = panel.querySelector('[data-done]');
  const fallback = panel.querySelector('[data-fallback]');
  const ENDPOINT = form.dataset.endpoint || '';
  const MAILTO = form.dataset.mailto || '';
  const DRAFT_KEY = 'wethru-interior-lead-draft-v1';
  const TOTAL = steps.length;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/;
  const TEXT = ['company', 'owner', 'region', 'phone', 'email', 'links', 'notes'];
  const REQUIRED_TEXT = ['company', 'region', 'phone', 'email'];
  const GROUPS = ['field', 'channels', 'painPoint', 'projectCount', 'showFirst', 'threeD', 'budget', 'startTiming', 'intent'];
  const MULTI = ['channels', 'showFirst'];
  const STEP_OF = { company: 1, owner: 1, region: 1, phone: 1, email: 1, links: 1, field: 2, channels: 2, painPoint: 2, projectCount: 3, showFirst: 3, threeD: 3, budget: 4, startTiming: 4, intent: 4, notes: 4, consentPrivacy: 4 };

  let current = 1;
  let reached = 1;
  let startedAt = 0;
  let sending = false;
  let sent = false;

  const el = (name) => form.elements.namedItem(name);
  const pad = (n) => String(n).padStart(2, '0');
  const firstText = (node) => (node ? [...node.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() : '');

  /* ---------- step navigation ---------- */
  function show(n, { focus = true } = {}) {
    current = Math.min(Math.max(n, 1), TOTAL);
    steps.forEach((s, i) => s.classList.toggle('is-current', i + 1 === current));
    marks.forEach((li, i) => {
      const k = i + 1;
      const b = li.querySelector('button');
      li.classList.toggle('is-current', k === current);
      li.classList.toggle('is-done', k <= reached && k !== current);
      b.disabled = k > reached;
      if (k === current) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    stepLabel.textContent = `STEP ${pad(current)} / ${pad(TOTAL)}`;
    btnPrev.hidden = current === 1;
    btnNext.hidden = current === TOTAL;
    btnSubmit.hidden = current !== TOTAL;
    status.textContent = '';
    if (focus) {
      const top = panel.getBoundingClientRect().top;
      if (top < 0 || top > innerHeight * 0.6) panel.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
      steps[current - 1].querySelector('.lead__title').focus({ preventScroll: true });
    }
  }

  function next() {
    if (!validateStep(current)) return;
    reached = Math.max(reached, current + 1);
    show(current + 1);
  }

  /* ---------- validation ---------- */
  function setError(name, message) {
    const box = document.getElementById(`e-${name}`);
    if (box) box.textContent = message || '';
    if (TEXT.includes(name)) {
      const input = el(name);
      if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    } else if (name === 'consentPrivacy') {
      document.getElementById('c-privacy').classList.toggle('is-invalid', !!message);
    } else {
      const group = form.querySelector(`.q[data-name="${name}"]`);
      if (group) group.classList.toggle('is-invalid', !!message);
    }
  }

  function checkField(name) {
    if (TEXT.includes(name)) {
      const v = el(name).value.trim();
      if (REQUIRED_TEXT.includes(name) && !v) return '필수 항목입니다.';
      if (name === 'phone' && v) { const d = v.replace(/\D/g, ''); if (d.length < 9 || d.length > 12) return '연락 가능한 번호인지 확인해주세요.'; }
      if (name === 'email' && v && !EMAIL_RE.test(v)) return '이메일 주소 형식을 확인해주세요.';
      return '';
    }
    if (name === 'consentPrivacy') return el('consentPrivacy').checked ? '' : '상담을 위해 개인정보 수집·이용 동의가 필요합니다.';
    const group = form.querySelector(`.q[data-name="${name}"]`);
    if (group && group.hasAttribute('data-required') && !form.querySelector(`input[name="${name}"]:checked`)) {
      return MULTI.includes(name) ? '하나 이상 골라주세요.' : '하나를 골라주세요.';
    }
    return '';
  }

  function namesInStep(n) {
    return Object.keys(STEP_OF).filter((k) => STEP_OF[k] === n);
  }

  function validateStep(n) {
    let firstBad = null;
    let count = 0;
    for (const name of namesInStep(n)) {
      const msg = checkField(name);
      setError(name, msg);
      if (msg) {
        count++;
        if (!firstBad) firstBad = TEXT.includes(name) || name === 'consentPrivacy' ? el(name) : form.querySelector(`input[name="${name}"]`);
      }
    }
    if (firstBad) {
      status.textContent = `확인이 필요한 항목이 ${count}개 있습니다.`;
      firstBad.focus();
      return false;
    }
    status.textContent = '';
    return true;
  }

  /* ---------- data ---------- */
  function collect() {
    const data = {};
    TEXT.forEach((k) => { data[k] = el(k).value.trim(); });
    GROUPS.forEach((k) => {
      const checked = [...form.querySelectorAll(`input[name="${k}"]:checked`)].map((i) => i.value);
      data[k] = MULTI.includes(k) ? checked : checked[0] || '';
    });
    data.consentPrivacy = el('consentPrivacy').checked === true;
    data.consentMarketing = false;
    data.website = el('website').value;
    data.elapsedMs = startedAt ? Math.round(performance.now() - startedAt) : 0;
    data.page = location.href.split('#')[0];
    data.referrer = document.referrer || '';
    return data;
  }

  function summary() {
    const lines = ['[WeThru Interior] 상담 신청', ''];
    TEXT.forEach((k) => {
      const v = el(k).value.trim();
      const label = firstText(form.querySelector(`label[for="f-${k}"]`));
      if (v) lines.push(`${label}: ${v}`);
    });
    GROUPS.forEach((k) => {
      const picked = [...form.querySelectorAll(`input[name="${k}"]:checked`)].map((i) => i.nextElementSibling.textContent.trim());
      const legend = firstText(form.querySelector(`.q[data-name="${k}"] legend`));
      if (picked.length) lines.push(`${legend}: ${picked.join(', ')}`);
    });
    lines.push('', `개인정보 수집·이용 동의: ${el('consentPrivacy').checked ? '동의' : '미동의'}`);
    return lines.join('\n');
  }

  /* ---------- draft (this tab only) ---------- */
  function saveDraft() {
    if (sent) return;
    const d = collect();
    delete d.website; delete d.elapsedMs; delete d.page; delete d.referrer; delete d.consentPrivacy; delete d.consentMarketing;
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* storage unavailable */ }
  }
  function restoreDraft() {
    let d;
    try { d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { d = null; }
    if (!d) return;
    TEXT.forEach((k) => { if (typeof d[k] === 'string') el(k).value = d[k]; });
    GROUPS.forEach((k) => {
      const vals = [].concat(d[k] || []);
      form.querySelectorAll(`input[name="${k}"]`).forEach((i) => { i.checked = vals.includes(i.value); });
    });
  }
  function clearDraft() { try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }

  /* ---------- submit ---------- */
  function setSending(on) {
    sending = on;
    btnSubmit.disabled = on;
    btnPrev.disabled = on;
    form.toggleAttribute('aria-busy', on);
    btnSubmit.firstChild.textContent = on ? '보내는 중… ' : '상담 신청 보내기 ';
  }

  function showResult(box) {
    form.hidden = true;
    done.hidden = box !== done;
    fallback.hidden = box !== fallback;
    if (box === fallback) {
      const subject = `[WeThru Interior] 신규 상담 — ${el('company').value.trim()}`;
      fallback.querySelector('[data-mailto-link]').href = `mailto:${MAILTO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(summary())}`;
    }
    panel.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    box.focus({ preventScroll: true });
  }

  async function submitLead() {
    if (sending || sent) return;
    for (let n = 1; n <= TOTAL; n++) {
      if (!validateStep(n)) { if (n !== current) { show(n); validateStep(n); } return; }
    }
    if (!ENDPOINT) return showResult(fallback);
    setSending(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collect()),
        signal: ctrl.signal,
      });
      let body = {};
      try { body = await res.json(); } catch { /* non-JSON */ }
      if (res.ok && body.ok) {
        sent = true;
        clearDraft();
        showResult(done);
        return;
      }
      if (res.status === 400 && body.fields) {
        const names = Object.keys(body.fields);
        names.forEach((k) => setError(k, body.fields[k] === 'required' ? '필수 항목입니다.' : '입력 내용을 확인해주세요.'));
        const firstStep = Math.min(...names.map((k) => STEP_OF[k] || TOTAL));
        show(firstStep);
        status.textContent = '입력 내용을 확인해주세요.';
        return;
      }
      showResult(fallback);
    } catch {
      showResult(fallback);
    } finally {
      clearTimeout(timer);
      setSending(false);
    }
  }

  /* ---------- events ---------- */
  form.addEventListener('focusin', () => { if (!startedAt) startedAt = performance.now(); }, { once: false });
  btnNext.addEventListener('click', next);
  btnPrev.addEventListener('click', () => show(current - 1));
  marks.forEach((li, i) => li.querySelector('button').addEventListener('click', () => {
    const target = i + 1;
    if (target > reached || target === current) return;
    if (target > current) { for (let n = current; n < target; n++) if (!validateStep(n)) return show(n); }
    show(target);
  }));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (current < TOTAL) next(); else submitLead();
  });

  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.target.tagName !== 'INPUT' || e.target.type === 'checkbox' || e.target.type === 'radio') return;
    e.preventDefault();
    const fields = [...steps[current - 1].querySelectorAll('input[type=text],input[type=tel],input[type=email]')];
    const idx = fields.indexOf(e.target);
    if (idx > -1 && idx < fields.length - 1) fields[idx + 1].focus();
    else if (current < TOTAL) next();
  });

  let saveTimer;
  form.addEventListener('input', (e) => {
    const name = e.target.name;
    if (name && (TEXT.includes(name))) { if (e.target.hasAttribute('aria-invalid')) setError(name, checkField(name)); }
    clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 300);
  });
  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'channels' && t.checked) {
      form.querySelectorAll('input[name="channels"]').forEach((i) => {
        if (i !== t && (t.hasAttribute('data-exclusive') || i.hasAttribute('data-exclusive'))) i.checked = false;
      });
    }
    if (GROUPS.includes(t.name) || t.name === 'consentPrivacy') setError(t.name, '');
    if (TEXT.includes(t.name) && t.value.trim()) setError(t.name, checkField(t.name));
    saveDraft();
  });

  fallback.querySelector('[data-retry]').addEventListener('click', () => {
    fallback.hidden = true;
    form.hidden = false;
    show(TOTAL, { focus: false });
    submitLead();
  });
  fallback.querySelector('[data-copy]').addEventListener('click', async () => {
    const out = fallback.querySelector('[data-copy-status]');
    const text = summary();
    try { await navigator.clipboard.writeText(text); out.textContent = '복사했습니다. 카카오톡이나 메일에 붙여넣어 보내주세요.'; }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); out.textContent = '복사했습니다. 카카오톡이나 메일에 붙여넣어 보내주세요.'; } catch { out.textContent = '복사하지 못했습니다. 이메일로 보내기를 이용해주세요.'; }
      ta.remove();
    }
  });

  addEventListener('pagehide', saveDraft);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveDraft(); });

  restoreDraft();
  show(1, { focus: false });
})();
