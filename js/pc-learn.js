/* PC용 학습 모듈 — pc-runtime.js 다음에 불러옵니다.
 * 1) 입력 기억·자동 채움: 칸마다 자주 쓰는 값을 목록으로 보여 주고, 함께 입력되는 값(예: 품목→단가)을 배워
 *    비어 있는 칸을 채웁니다. (3번 이상, 70% 이상 같은 값일 때만)
 * 2) 작업 기록: 저장·수정·삭제·사진·내려받기·자동 채움·주의를 데이터\_학습\작업기록\날짜.jsonl 에 남깁니다.
 * 3) 패턴 분석·예측: 평소보다 30% 넘게 다른 숫자를 넣으면 알려 주고, '🧠 학습' 창에서 패턴을 보여 줍니다.
 * 학습 내용: 데이터\_학습\기억.json
 */
(function () {
  'use strict';
  const R = window.__pcrt;
  if (!R || window.__pcLearn) return;
  window.__pcLearn = true;

  const DIR = ['_학습'];
  const LOGDIR = ['_학습', '작업기록'];
  const SEP = '\u0001';
  const MIN_N = 3, DOMINANT = 0.7, WARN_RATIO = 0.3;
  const LABEL = { item: '품목', price: '단가', site: '사업장', seller: '매출처', unit: '단위', owner: '담당자', category: '분류', action: '조치', qty: '수량', vendor: '거래처', name: '이름', loss: '손실액', checker: '확인자', spec: '규격', corp: '청과', supplier: '공급처', inspector: '검수자', writer: '작성자', store: '매장', grade: '등급', amount: '금액', total: '합계',
    issue: '클레임사항', source: '출처', costgoods: '물품비', costlogistics: '물류비', costqty: '물품량', costtotal: '처리비용', returnqty: '반품량', orderqty: '발주량', caption: '사진 설명', filename: '파일명', note: '메모', memo: '메모', type: '구분', reasons: '사유', badqty: '불량 수량', status: '상태' };
  const label = (s) => LABEL[s] || s;
  const esc = R.esc;

  let mem = { v: 1, seeded: false, settings: { autofill: true, warn: true }, fields: {}, pairs: {} };
  let loaded = false;

  /* ---------- 저장 ---------- */
  async function fileIn(segs, name, create) { const d = await R.dirAt(segs, create); return d.getFileHandle(name, { create }); }
  async function loadMem() {
    try { const f = await (await fileIn(DIR, '기억.json', false)).getFile(); const m = JSON.parse(await f.text()); mem = Object.assign(mem, m); mem.settings = Object.assign({ autofill: true, warn: true }, m.settings || {}); } catch (e) {}
    loaded = true;
  }
  let saveT = null;
  function saveMem() {
    clearTimeout(saveT);
    saveT = setTimeout(() => R.queue(async () => {
      prune();
      const w = await (await fileIn(DIR, '기억.json', true)).createWritable();
      await w.write(JSON.stringify(mem)); await w.close();
    }).catch(() => {}), 1500);
  }
  function prune() {
    for (const s of Object.keys(mem.fields)) {
      const e = Object.entries(mem.fields[s]);
      if (e.length > 300) mem.fields[s] = Object.fromEntries(e.sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]).slice(0, 300));
    }
    for (const k of Object.keys(mem.pairs)) {
      const e = Object.entries(mem.pairs[k]);
      if (e.length > 500) mem.pairs[k] = Object.fromEntries(e.sort((a, b) => tot(b[1]) - tot(a[1])).slice(0, 500));
      for (const [av, m] of Object.entries(mem.pairs[k])) {
        const ee = Object.entries(m); if (ee.length > 20) mem.pairs[k][av] = Object.fromEntries(ee.sort((a, b) => b[1] - a[1]).slice(0, 20));
      }
    }
  }

  /* ---------- 작업 기록 ---------- */
  function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function log(kind, info) {
    const line = JSON.stringify(Object.assign({ t: new Date().toISOString(), 종류: kind }, info)) + '\n';
    R.queue(async () => {
      const fh = await fileIn(LOGDIR, today() + '.jsonl', true);
      const f = await fh.getFile();
      const w = await fh.createWritable({ keepExistingData: true });
      await w.seek(f.size); await w.write(line); await w.close();
    }).catch(() => {});
  }
  async function readLogs(days) {
    const out = [];
    try {
      const d = await R.dirAt(LOGDIR, true);
      const names = [];
      for await (const [n, h] of d.entries()) if (h.kind === 'file' && n.endsWith('.jsonl')) names.push(n);
      names.sort().reverse();
      for (const n of names.slice(0, days)) {
        const txt = await (await (await d.getFileHandle(n)).getFile()).text();
        for (const l of txt.split('\n')) if (l.trim()) { try { out.push(JSON.parse(l)); } catch (e) {} }
      }
    } catch (e) {}
    return out.sort((a, b) => (a.t < b.t ? 1 : -1));
  }
  const short = (v) => (v == null ? '' : typeof v === 'object' ? (Array.isArray(v) ? `[${v.length}개]` : '{…}') : String(v).slice(0, 40));
  function diff(a, b) {
    const out = {}; let n = 0;
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) {
      if (JSON.stringify((a || {})[k]) === JSON.stringify((b || {})[k])) continue;
      if (++n > 8) { out['…'] = '그 밖에 더 있음'; break; }
      out[k] = [short((a || {})[k]), short((b || {})[k])];
    }
    return out;
  }

  /* ---------- 기억 ---------- */
  const tot = (m) => Object.values(m).reduce((a, b) => a + b, 0);
  const isNum = (v) => /^-?[\d,]+(\.\d+)?$/.test(String(v).trim());
  const toNum = (v) => Number(String(v).replace(/,/g, ''));
  function remember(s, v) {
    if (isNum(v)) return;
    const f = (mem.fields[s] = mem.fields[s] || {});
    const e = (f[v] = f[v] || [0, 0]); e[0]++; e[1] = Date.now();
  }
  function pair(ks, kv, ts, tv) {
    const k = ks + SEP + ts;
    const m = ((mem.pairs[k] = mem.pairs[k] || {})[kv] = (mem.pairs[k][kv] || {}));
    m[tv] = (m[tv] || 0) + 1;
  }
  // 기준 칸이 될 만큼 값 종류가 다양한가 (단위·매출처·분류처럼 몇 가지뿐인 칸은 기준으로 쓰지 않음)
  const MIN_KINDS = 8;
  function specificKey(ks, ts) { const p = mem.pairs[ks + SEP + ts]; return !!p && Object.keys(p).length >= MIN_KINDS; }
  function predict(ks, kv, ts) {
    if (!specificKey(ks, ts)) return null;
    const m = mem.pairs[ks + SEP + ts][kv];
    if (!m) return null;
    const t = tot(m); if (t < MIN_N) return null;
    const [bv, bn] = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
    if (bv === '' || (isNum(bv) && toNum(bv) === 0)) return null;
    return bn / t >= DOMINANT ? { v: bv, n: bn, t } : null;
  }
  function median(arr) { const a = arr.slice().sort((x, y) => x - y); const i = Math.floor(a.length / 2); return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2; }
  function numHistory(ks, kv, ts) {
    const m = mem.pairs[ks + SEP + ts] && mem.pairs[ks + SEP + ts][kv];
    if (!m) return [];
    const out = [];
    for (const [v, n] of Object.entries(m)) if (isNum(v)) for (let i = 0; i < Math.min(n, 50); i++) out.push(toNum(v));
    return out;
  }

  /* ---------- 저장된 문서에서 배우기 ---------- */
  const SKIP_KEY = /(^id$|^_|Id$|At$|_at$|^at$|^t$|url|asset|uid|^v$|version|^part$)/i;
  const okStr = (v) => typeof v === 'string' && v.trim() && v.length <= 40 && !/^\d{4}-\d{2}-\d{2}T/.test(v) && !/^\d{4}-\d{2}-\d{2}$/.test(v);
  const okNum = (v) => typeof v === 'number' && isFinite(v) || (typeof v === 'string' && isNum(v) && v.trim() !== '');
  function recordsOf(doc) {
    const recs = [doc];
    for (const [k, v] of Object.entries(doc || {})) {
      if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) recs.push(...v.slice(0, 300));
    }
    return recs;
  }
  function learnRecord(r) {
    if (!r || typeof r !== 'object') return;
    const strs = [], nums = [];
    for (const [k, v] of Object.entries(r)) {
      if (SKIP_KEY.test(k)) continue;
      const s = norm(k);
      if (okStr(v)) strs.push([s, v.trim()]);
      else if (okNum(v)) nums.push([s, String(v)]);
    }
    for (const [s, v] of strs) remember(s, v);
    for (const [ks, kv] of strs) {
      for (const [ts, tv] of strs) if (ts !== ks) pair(ks, kv, ts, tv);
      for (const [ts, tv] of nums) pair(ks, kv, ts, tv);
    }
  }
  async function collections() {
    const out = [];
    for await (const [n, h] of R.dataDir.entries()) if (h.kind === 'directory' && !n.startsWith('_')) out.push(R.dec(n));
    return out;
  }
  async function seed() {
    let docs = 0;
    for (const c of await collections()) {
      const items = await R.listCol([c]);
      for (const it of items.slice(0, 3000)) { for (const r of recordsOf(it.data)) learnRecord(r); docs++; }
    }
    mem.seeded = true; saveMem();
    log('처음 학습', { 내용: `저장된 자료 ${docs}건에서 배웠습니다` });
    return docs;
  }

  /* ---------- 화면 입력 칸 ---------- */
  function norm(s) {
    return String(s || '').trim().toLowerCase()
      .replace(/[-_]\d+$/, '').replace(/[-_]\d+(?=[-_])/g, '')
      .replace(/^(f|m|l|e|ent|in|inp|fld|field)[-_]/, '')
      .slice(0, 60);
  }
  const BAD_TYPES = /^(password|file|hidden|checkbox|radio|date|datetime-local|time|month|week|color|range|submit|button|reset|image)$/i;
  function learnable(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
    if (tag === 'INPUT' && BAD_TYPES.test(el.type || 'text')) return false;
    if (el.readOnly || el.disabled) return false;
    if (el.closest('.pcrt-learn, .pcrt-banner, .pcrt-badge')) return false;
    return true;
  }
  const gridCache = new WeakMap();
  function headerGrid(tbl) {
    const key = tbl.tHead.innerHTML; const c = gridCache.get(tbl); if (c && c.key === key) return c.grid;
    const grid = [];
    [...tbl.tHead.rows].forEach((r, ri) => {
      grid[ri] = grid[ri] || []; let x = 0;
      for (const cell of r.cells) {
        while (grid[ri][x]) x++;
        for (let i = 0; i < (cell.rowSpan || 1); i++) for (let j = 0; j < (cell.colSpan || 1); j++) (grid[ri + i] = grid[ri + i] || [])[x + j] = cell;
        x += cell.colSpan || 1;
      }
    });
    gridCache.set(tbl, { key, grid }); return grid;
  }
  function headerText(el) {
    const td = el.closest('td'); const tbl = td && td.closest('table');
    if (!tbl || !tbl.tHead || !tbl.tHead.rows.length) return '';
    let col = 0; for (const c of td.parentElement.cells) { if (c === td) break; col += c.colSpan || 1; }
    const g = headerGrid(tbl); const top = g[0] && g[0][col], bot = g[g.length - 1] && g[g.length - 1][col];
    const t = (c) => (c ? c.textContent.replace(/[▲▼↑↓⇅]/g, '').trim() : '');
    return top && bot && top !== bot ? t(top) + ' ' + t(bot) : t(bot || top);
  }
  function sigOf(el) {
    let s = el.id || el.name || '';
    if (/^[a-z0-9]{14,}$/i.test(s) || /^\d/.test(s)) s = '';
    if (!s) s = el.getAttribute('aria-label') || headerText(el) || el.placeholder || '';
    return norm(s);
  }
  const valOf = (el) => String(el.value == null ? '' : el.value).trim();
  function container(el) { return el.closest('tr') || el.closest('form') || el.closest('[role="dialog"]') || el.closest('section') || null; }
  function siblings(cont, el) { return cont ? [...cont.querySelectorAll('input,textarea,select')].filter((x) => x !== el && learnable(x)).slice(0, 40) : []; }
  function isEmpty(el) { const v = valOf(el); return v === '' || (el.type === 'number' && Number(v) === 0); }

  // 칸 묶음(행·폼)을 한 번에 기록
  const snapTimers = new WeakMap(); const seen = new Set();
  function scheduleSnapshot(cont) {
    if (!cont) return;
    clearTimeout(snapTimers.get(cont));
    snapTimers.set(cont, setTimeout(() => {
      const fs = [...cont.querySelectorAll('input,textarea,select')].filter(learnable).slice(0, 40)
        .map((x) => [sigOf(x), valOf(x)]).filter(([s, v]) => s && v && v.length <= 40);
      const key = JSON.stringify(fs); if (fs.length < 2 || seen.has(key)) return; seen.add(key);
      for (const [ks, kv] of fs) { if (isNum(kv)) continue; for (const [ts, tv] of fs) if (ts !== ks) pair(ks, kv, ts, tv); }
      saveMem();
    }, 1500));
  }

  // 자동 채움
  function autofill(el, s, v) {
    if (!mem.settings.autofill || isNum(v)) return;
    const filled = [];
    for (const t of siblings(container(el), el)) {
      if (!isEmpty(t)) continue;
      const ts = sigOf(t); if (!ts || ts === s) continue;
      const p = predict(s, v, ts); if (!p) continue;
      if (t.tagName === 'SELECT' && ![...t.options].some((o) => o.value === p.v)) continue;
      t.__pcrtAuto = true;
      t.value = p.v;
      t.dispatchEvent(new Event('input', { bubbles: true }));
      t.dispatchEvent(new Event('change', { bubbles: true }));
      t.classList.add('pcrt-auto'); t.title = `학습한 값 (${p.t}번 중 ${p.n}번) — 다르면 고쳐 주세요`;
      filled.push(`${label(ts)} ${p.v}`);
    }
    if (filled.length) { toast(`🧠 '${v}' 기준으로 채웠어요: ${filled.join(', ')}`); log('자동 채움', { 기준: `${label(s)}=${v}`, 채운값: filled }); }
  }

  // 평소와 다른 숫자 경고
  const warned = new Set();
  function checkAnomaly(el, s, v) {
    if (!mem.settings.warn || !isNum(v)) return;
    const num = toNum(v); if (!num) return;
    // 같은 줄의 기준 칸 중 값이 가장 일정한(=가장 믿을 만한) 기준을 고름. 예: 매출처보다 품목
    let best = null;
    for (const k of siblings(container(el), el)) {
      const kv = valOf(k); if (!kv || isNum(kv)) continue;
      const ks = sigOf(k); if (!ks || !specificKey(ks, s)) continue;
      const h = numHistory(ks, kv, s); if (h.length < MIN_N) continue;
      const med = median(h); if (!med) continue;
      const spread = median(h.map((x) => Math.abs(x - med))) / Math.abs(med);
      if (!best || spread < best.spread || (spread === best.spread && h.length > best.n)) best = { kv, med, n: h.length, spread };
    }
    if (!best || best.spread > 0.5) return; // 기준값 자체가 들쭉날쭉하면 경고하지 않음
    const r = (num - best.med) / Math.abs(best.med);
    if (Math.abs(r) <= WARN_RATIO) return;
    const key = [s, best.kv, v].join('|'); if (warned.has(key)) return; warned.add(key);
    const msg = `⚠ ${label(s)} ${num.toLocaleString('ko-KR')} — '${best.kv}' 평소 값(${best.n}번 기준 ${best.med.toLocaleString('ko-KR')})보다 ${Math.round(Math.abs(r) * 100)}% ${r > 0 ? '높아요' : '낮아요'}`;
    toast(msg, 6000); el.classList.add('pcrt-warn'); el.title = msg.slice(2);
    log('주의', { 내용: msg.slice(2) });
  }

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!loaded || !learnable(el)) return;
    if (el.__pcrtAuto) { el.__pcrtAuto = false; return; }
    const s = sigOf(el), v = valOf(el);
    if (el.classList.contains('pcrt-auto')) log('자동 채움 고침', { 칸: label(s), 고친값: v.slice(0, 40) }); // 학습이 틀렸던 경우
    el.classList.remove('pcrt-auto', 'pcrt-warn');
    if (!s || !v || v.length > 120) return;
    remember(s, v); saveMem();
    scheduleSnapshot(container(el));
    setTimeout(() => { autofill(el, s, v); checkAnomaly(el, s, v); }, 0);
  }, true);

  // 자주 쓰는 값 목록
  let dlN = 0;
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!loaded || !learnable(el) || el.tagName !== 'INPUT' || !/^(text|search|)$/i.test(el.type || 'text')) return;
    const cur = el.getAttribute('list'); if (cur && !cur.startsWith('pcrt-dl-')) return;
    const s = sigOf(el); const f = s && mem.fields[s]; if (!f) return;
    const top = Object.entries(f).sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]).slice(0, 15);
    if (!top.length) return;
    let dl = cur && document.getElementById(cur);
    if (!dl) { dl = document.createElement('datalist'); dl.id = 'pcrt-dl-' + (++dlN); document.body.appendChild(dl); el.setAttribute('list', dl.id); }
    dl.innerHTML = top.map(([v]) => `<option value="${esc(v)}"></option>`).join('');
  }, true);

  /* ---------- 저장소 기록 연결 ---------- */
  R.hooks.write.push((colSegs, id, old, data) => {
    const path = colSegs.concat(id).join('/');
    log(old == null ? '새로 만듦' : '수정', { 경로: path, 바뀐것: diff(old, data) });
    if (!colSegs[0] || !colSegs[0].startsWith('_')) {
      // 새로 생기거나 바뀐 항목만 배움 (같은 문서를 여러 번 저장해도 횟수가 부풀지 않게)
      const before = new Set(old ? recordsOf(old).map((r) => JSON.stringify(r)) : []);
      for (const r of recordsOf(data)) if (!before.has(JSON.stringify(r))) learnRecord(r);
      saveMem();
    }
  });
  R.hooks.del.push((colSegs, id, old) => log('삭제', { 경로: colSegs.concat(id).join('/'), 지운것: diff(old, null) }));

  /* ---------- 오류 감시 (점검 보고서에 쓰임) ---------- */
  const errSeen = new Map(); const errPending = [];
  function logError(info) {
    const k = info.내용 + '|' + (info.위치 || '');
    const n = (errSeen.get(k) || 0) + 1; errSeen.set(k, n);
    if (n > 3) return; // 같은 오류는 한 번 열 때 3번까지만 기록
    if (loaded) log('오류', info); else errPending.push(info);
  }
  R.hooks.error.push(logError);
  window.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t !== window && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) {
      const src = t.src || t.href || '';
      if (!/\/_pc\//.test(src)) logError({ 내용: '외부 도구를 불러오지 못함 (인터넷 연결 확인)', 위치: src.split('?')[0] });
      return;
    }
    if (t && t !== window) return; // 사진 등 리소스 오류는 무시
    logError({ 내용: String(e.message || '알 수 없는 오류'), 위치: String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0) });
  }, true);
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason; const msg = r && (r.message || r.name) || String(r);
    if (/AbortError/.test(msg)) return;
    logError({ 내용: '처리되지 않은 오류: ' + msg });
  });
  R.hooks.asset.push((op, id, type, size) => log(op === 'upload' ? '사진·파일 저장' : '사진·파일 삭제', { id, type, size }));
  R.hooks.download.push((name, size) => log('내려받기', { 파일: name, size }));

  /* ---------- 화면 ---------- */
  const CSS = `
  .pcrt-auto{outline:2px dashed #3b8f63!important;outline-offset:-2px;background-color:rgba(59,143,99,.08)!important}
  .pcrt-warn{outline:2px solid #c2410c!important;outline-offset:-2px}
  .pcrt-ltoast{position:fixed;right:12px;bottom:12px;z-index:2147483001;max-width:min(460px,calc(100vw - 24px));background:#1a2420;color:#fff;font:13px/1.5 "Malgun Gothic",sans-serif;padding:9px 13px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25)}
  .pcrt-learn{position:fixed;inset:0;z-index:2147483000;background:rgba(15,20,18,.5);display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif}
  .pcrt-learn .bx{background:#fff;color:#1a2420;border-radius:12px;width:min(860px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.3)}
  .pcrt-learn .hd{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 18px;border-bottom:1px solid #d9e0dc}
  .pcrt-learn .hd h2{margin:0;font-size:18px}
  .pcrt-learn .bd{overflow:auto;padding:14px 18px 20px;display:flex;flex-direction:column;gap:18px;font-size:13.5px;line-height:1.55}
  .pcrt-learn h3{margin:0 0 6px;font-size:14.5px;color:#2c6a4f}
  .pcrt-learn table{width:100%;border-collapse:collapse;font-size:13px}
  .pcrt-learn th,.pcrt-learn td{border-bottom:1px solid #e6ebe8;padding:5px 6px;text-align:left;vertical-align:top}
  .pcrt-learn th{color:#5d6b65;font-weight:600;font-size:12px}
  .pcrt-learn td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .pcrt-learn .muted{color:#5d6b65}
  .pcrt-learn .warn{color:#b4372a}
  .pcrt-learn button{font:inherit;font-weight:700;border:1px solid #c9d0c8;background:#fff;color:#1a2420;border-radius:7px;padding:6px 12px;cursor:pointer}
  .pcrt-learn .row{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}
  .pcrt-learn .chips span{display:inline-block;background:#eef3f0;border-radius:999px;padding:1px 9px;margin:2px 4px 2px 0}
  .pcrt-learn .scroll{overflow-x:auto}
  .pcrt-badge .pcrt-lbtn{color:#ffe08a}`;
  function addCss() { if (document.getElementById('pcrt-lcss')) return; const s = document.createElement('style'); s.id = 'pcrt-lcss'; s.textContent = CSS; document.head.appendChild(s); }
  let toastEl = null, toastT = null;
  function toast(msg, ms) {
    addCss();
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'pcrt-ltoast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (toastEl.hidden = true), ms || 4000);
  }

  function addButton() {
    const b = R.badge; if (!b) return false;
    if (b.querySelector('.pcrt-lbtn')) return true;
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'pcrt-lbtn'; btn.textContent = '🧠 학습';
    btn.onclick = openPanel; b.appendChild(btn); return true;
  }

  /* ---------- 데이터 패턴 분석 ---------- */
  async function analyze() {
    const out = [];
    for (const c of await collections()) {
      const items = await R.listCol([c]);
      if (!items.length) continue;
      const recs = []; for (const it of items.slice(0, 3000)) for (const r of recordsOf(it.data)) recs.push(r);
      const strF = {}, numF = {};
      for (const r of recs) for (const [k, v] of Object.entries(r || {})) {
        if (SKIP_KEY.test(k)) continue;
        if (okStr(v)) (strF[k] = strF[k] || new Map()).set(v, ((strF[k].get(v)) || 0) + 1);
        else if (okNum(v)) (numF[k] = numF[k] || []).push(Number(String(v).replace(/,/g, '')));
      }
      const keyCands = Object.entries(strF).filter(([k, m]) => m.size >= 2 && m.size <= 300 && [...m.values()].reduce((a, b) => a + b, 0) >= recs.length * 0.5)
        .sort((a, b) => b[1].size - a[1].size);
      const nums = Object.entries(numF).filter(([k, a]) => a.length >= recs.length * 0.5 && new Set(a).size > 1).map(([k]) => k).slice(0, 3);
      const sec = { name: c, docs: items.length, recs: recs.length, tops: [], groups: null, outliers: [] };
      for (const [k, m] of keyCands.slice(0, 4)) sec.tops.push([k, [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)]);
      if (keyCands.length && nums.length) {
        // 묶을 기준: 3건 이상 반복되는 값이 가장 많은 칸 (예: 품목)
        const kf = keyCands.map(([k, m]) => [k, [...m.values()].filter((n) => n >= MIN_N).length]).sort((a, b) => b[1] - a[1])[0][0];
        const g = new Map();
        for (const r of recs) { const kv = r && r[kf]; if (!okStr(kv)) continue; const e = g.get(kv) || { n: 0, vals: {}, recs: [] }; e.n++; e.recs.push(r); for (const nf of nums) if (okNum(r[nf])) (e.vals[nf] = e.vals[nf] || []).push(Number(String(r[nf]).replace(/,/g, ''))); g.set(kv, e); }
        const rows = [...g.entries()].sort((a, b) => b[1].n - a[1].n);
        sec.groups = { key: kf, nums, rows: rows.slice(0, 10).map(([kv, e]) => [kv, e.n, nums.map((nf) => (e.vals[nf] && e.vals[nf].length ? median(e.vals[nf]) : null))]) };
        for (const [kv, e] of rows) for (const nf of nums) {
          const a = e.vals[nf]; if (!a || a.length < MIN_N) continue; const med = median(a); if (!med) continue;
          for (const r of e.recs) { const x = Number(String(r[nf]).replace(/,/g, '')); if (!isFinite(x) || !x) continue; const d = (x - med) / Math.abs(med); if (Math.abs(d) > 0.5) sec.outliers.push([kf, kv, nf, x, med, d]); }
        }
        const uniq = new Map();
        for (const o of sec.outliers) { const k = o.slice(0, 4).join('|'); const u = uniq.get(k); if (u) u[6]++; else uniq.set(k, o.concat(1)); }
        sec.outliers = [...uniq.values()].sort((a, b) => Math.abs(b[5]) - Math.abs(a[5])).slice(0, 8);
      }
      out.push(sec);
    }
    return out;
  }

  const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 1 }));
  async function openPanel() {
    addCss();
    const wrap = document.createElement('div'); wrap.className = 'pcrt-learn';
    wrap.innerHTML = `<div class="bx" role="dialog" aria-label="학습 현황"><div class="hd"><h2>🧠 학습 현황 · ${esc(R.APP)}</h2><button type="button" data-a="close">닫기</button></div><div class="bd"><p class="muted">분석하는 중…</p></div></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', async (e) => {
      if (e.target === wrap) return close();
      const a = e.target.closest('button') && e.target.closest('button').dataset.a;
      if (a === 'close') close();
      if (a === 'relearn') { if (!confirm('지금까지 배운 내용을 지우고 저장된 자료로 다시 배울까요?')) return; const s = mem.settings; mem = { v: 1, seeded: false, settings: s, fields: {}, pairs: {} }; const n = await seed(); toast(`저장된 자료 ${n}건으로 다시 배웠어요`); close(); openPanel(); }
      if (a === 'forget') { if (!confirm('배운 내용(자주 쓰는 값·연결)을 모두 지울까요? 작업 기록은 남습니다.')) return; const s = mem.settings; mem = { v: 1, seeded: true, settings: s, fields: {}, pairs: {} }; saveMem(); log('학습 지움', {}); close(); openPanel(); }
    });
    wrap.addEventListener('change', (e) => { const k = e.target.dataset.set; if (k) { mem.settings[k] = e.target.checked; saveMem(); } });
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } });

    const [logs, pats] = await Promise.all([readLogs(30), analyze()]);
    const H = [];
    // 설정
    H.push(`<section><h3>설정</h3><div class="row">
      <label><input type="checkbox" data-set="autofill" ${mem.settings.autofill ? 'checked' : ''}> 배운 값으로 빈칸 자동 채움</label>
      <label><input type="checkbox" data-set="warn" ${mem.settings.warn ? 'checked' : ''}> 평소와 30% 넘게 다른 숫자 알림</label>
      <span style="flex:1"></span><button type="button" data-a="relearn">저장된 자료로 다시 배우기</button><button type="button" data-a="forget">배운 내용 지우기</button></div>
      <p class="muted" style="margin:6px 0 0">학습 파일: 데이터\\_학습\\기억.json · 작업 기록: 데이터\\_학습\\작업기록\\날짜.jsonl</p></section>`);
    // 최근 작업
    const week = logs.filter((l) => Date.now() - new Date(l.t) < 7 * 864e5);
    const byKind = {}; week.forEach((l) => (byKind[l.종류] = (byKind[l.종류] || 0) + 1));
    const byDay = {}; logs.forEach((l) => { const d = l.t.slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; });
    H.push(`<section><h3>최근 작업 기록</h3>${logs.length ? `<p>최근 7일: ${Object.entries(byKind).map(([k, n]) => `${esc(k)} <b>${n}</b>`).join(' · ') || '없음'}</p>
      <p class="muted">날짜별: ${Object.entries(byDay).slice(0, 10).map(([d, n]) => `${d.slice(5)} ${n}건`).join(' · ')}</p>
      <div class="scroll"><table><thead><tr><th>시각</th><th>종류</th><th>내용</th></tr></thead><tbody>${logs.slice(0, 15).map((l) => `<tr><td class="n">${esc(new Date(l.t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</td><td>${esc(l.종류)}</td><td>${esc(describe(l))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">아직 기록이 없습니다. 저장·수정·삭제하면 여기에 쌓입니다.</p>'}</section>`);
    // 주의
    const warns = logs.filter((l) => l.종류 === '주의').slice(0, 12);
    H.push(`<section><h3>평소와 다른 값 알림 (최근 30일)</h3>${warns.length ? `<ul style="margin:0;padding-left:18px">${warns.map((l) => `<li class="warn">${esc(l.t.slice(5, 10))} ${esc(l.내용)}</li>`).join('')}</ul>` : '<p class="muted">없습니다.</p>'}</section>`);
    // 배운 연결
    const links = [];
    for (const [k, m] of Object.entries(mem.pairs)) {
      const [ks, ts] = k.split(SEP);
      for (const kv of Object.keys(m)) { const p = predict(ks, kv, ts); if (p) links.push([ks, kv, ts, p.v, p.n, p.t]); }
    }
    links.sort((a, b) => b[5] - a[5]);
    H.push(`<section><h3>배운 연결 (자동 채움에 쓰임) <span class="muted" style="font-weight:400">· ${links.length}개</span></h3>${links.length ? `<div class="scroll"><table><thead><tr><th>이 값을 넣으면</th><th>채우는 값</th><th class="n">근거</th></tr></thead><tbody>${links.slice(0, 20).map(([ks, kv, ts, bv, bn, t]) => `<tr><td>${esc(label(ks))} = ${esc(kv)}</td><td>${esc(label(ts))} → <b>${esc(isNum(bv) ? fmt(toNum(bv)) : bv)}</b></td><td class="n">${t}번 중 ${bn}번</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">아직 없습니다. 같은 조합을 3번 이상 입력하면 생깁니다.</p>'}</section>`);
    // 자주 쓰는 입력
    const fs = Object.entries(mem.fields).map(([s, m]) => [s, Object.entries(m).sort((a, b) => b[1][0] - a[1][0]), Object.values(m).reduce((a, b) => a + b[0], 0)]).filter((x) => x[1].length).sort((a, b) => b[2] - a[2]).slice(0, 10);
    H.push(`<section><h3>자주 쓰는 입력 (입력 칸 목록으로 보여 줌)</h3>${fs.length ? fs.map(([s, e]) => `<div class="chips"><b>${esc(label(s))}</b> ${e.slice(0, 6).map(([v, x]) => `<span>${esc(v)} ${x[0]}</span>`).join('')}</div>`).join('') : '<p class="muted">아직 없습니다.</p>'}</section>`);
    // 데이터 패턴
    H.push(`<section><h3>데이터 패턴</h3>${pats.length ? pats.map((p) => `<div style="margin-bottom:14px"><p style="margin:0 0 4px"><b>${esc(p.name)}</b> <span class="muted">· 문서 ${p.docs}건${p.recs !== p.docs ? ` (항목 ${p.recs}줄)` : ''}</span></p>
      ${p.tops.map(([k, t]) => `<div class="chips"><span class="muted">${esc(label(k))} 많은 순:</span> ${t.map(([v, n]) => `<span>${esc(v)} ${n}</span>`).join('')}</div>`).join('')}
      ${p.groups ? `<div class="scroll"><table><thead><tr><th>${esc(label(p.groups.key))}</th><th class="n">건수</th>${p.groups.nums.map((n) => `<th class="n">${esc(label(n))} (중앙값)</th>`).join('')}</tr></thead><tbody>${p.groups.rows.map(([kv, n, meds]) => `<tr><td>${esc(kv)}</td><td class="n">${n}</td>${meds.map((m) => `<td class="n">${fmt(m)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}
      ${p.outliers.length ? `<p class="warn" style="margin:6px 0 2px">평소와 크게 다른 값</p><ul style="margin:0;padding-left:18px">${p.outliers.map(([kf, kv, nf, x, med, d, cnt]) => `<li>${esc(label(kf))} '${esc(kv)}'의 ${esc(label(nf))} ${fmt(x)}${cnt > 1 ? ` (${cnt}건)` : ''} — 중앙값 ${fmt(med)}보다 ${Math.round(Math.abs(d) * 100)}% ${d > 0 ? '높음' : '낮음'}</li>`).join('')}</ul>` : ''}</div>`).join('') : '<p class="muted">저장된 자료가 없습니다.</p>'}
      <p class="muted" style="margin:0">자료 구조가 복잡한 프로그램(예: 표 안에 표가 있는 자료)은 일부 항목만 분석됩니다.</p></section>`);
    wrap.querySelector('.bd').innerHTML = H.join('');
  }
  function describe(l) {
    if (l.경로) return l.경로 + (l.바뀐것 ? ' · ' + Object.entries(l.바뀐것).slice(0, 3).map(([k, v]) => Array.isArray(v) ? `${k}: ${v[0] || '∅'}→${v[1] || '∅'}` : v).join(', ') : '');
    if (l.채운값) return `${l.기준} → ${l.채운값.join(', ')}`;
    if (l.파일) return l.파일;
    return l.내용 || l.id || '';
  }

  /* ---------- 시작 ---------- */
  R.ready.then(async () => {
    await loadMem();
    while (errPending.length) log('오류', errPending.shift());
    log('열림', { 화면: R.dec(location.pathname.split('/').pop()) });
    if (!mem.seeded) { try { await seed(); } catch (e) {} }
    let tries = 0; const t = setInterval(() => { if (addButton() || ++tries > 50) clearInterval(t); }, 200);
  });
  window.__pcLearnApi = { get mem() { return mem; }, seed, analyze, readLogs, openPanel, sigOf };
})();
