/* PC용 실행 모듈
 * claude.ai 아티팩트가 쓰던 window.claude.use("db" | "assets" | "downloads" | "user")를
 * 내 PC 폴더에 파일로 저장하는 방식으로 바꿔 줍니다. (크롬·엣지 전용: File System Access API)
 *  - 데이터: <선택한 폴더>/데이터/<컬렉션>/<문서id>.json
 *  - 사진·파일: <선택한 폴더>/데이터/_assets/<id>.<확장자>
 *  - 사진 읽기(sample) 같은 AI 기능은 없음 → use()가 null을 돌려줌
 */
(function () {
  'use strict';
  if (window.__pcRuntime) return;
  window.__pcRuntime = true;

  /* ---------- 앱 이름(폴더 이름) ---------- */
  const parts = decodeURIComponent(location.pathname).split(/[\\/]/).filter(Boolean);
  const APP = window.PC_APP || (parts.length >= 2 ? parts[parts.length - 2] : 'app'); // 웹(클라우드)판은 PC_APP으로 폴더 이름을 알려 줌
  const DATA_DIR = '데이터';
  const POLL_MS = 4000;

  /* ---------- IndexedDB: 폴더 핸들 기억 ---------- */
  function idb() {
    return new Promise((ok, no) => {
      const r = indexedDB.open('pc-runtime', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('handles');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
  }
  async function idbGet(k) {
    try { const d = await idb(); return await new Promise((ok) => { const q = d.transaction('handles').objectStore('handles').get(k); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); }); } catch (e) { return null; }
  }
  async function idbSet(k, v) {
    try { const d = await idb(); await new Promise((ok) => { const t = d.transaction('handles', 'readwrite'); t.objectStore('handles').put(v, k); t.oncomplete = ok; t.onerror = ok; }); } catch (e) {}
  }

  /* ---------- 서버 모드: 참드레 프로그램 서버(_pc/server.py)로 열었을 때 ----------
   * PC 폴더 대신 서버에 파일을 읽고 씀. 폴더 핸들과 똑같이 생긴 객체를 만들어서
   * 아래 코드와 학습 모듈은 그대로 동작함. (폰에서도 됨, 폴더 고르기 창 없음) */
  let serverMode = false;
  function nfErr() { const e = new Error('없음'); e.name = 'NotFoundError'; return e; }
  function goLogin() { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); }
  async function api(segsArr, op, opt) {
    if (window.__pcCloud) return window.__pcCloud.api([APP].concat(segsArr), op, opt); // 클라우드(수파베이스) 모드
    const url = '/_api/fs/' + [APP].concat(segsArr).map(encodeURIComponent).join('/') + (op ? '?op=' + op : '');
    const r = await fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opt || {}));
    if (r.status === 401) { goLogin(); throw new Error('로그인이 필요합니다'); }
    if (r.status === 404 || r.headers.get('X-Notfound')) throw nfErr();
    if (!r.ok) { let m = r.status + ''; try { m = (await r.json()).error || m; } catch (e) {} throw new Error('서버 오류: ' + m); }
    return r;
  }
  const fileCache = new Map(); // 경로 -> {size, mtime, file}
  function mkFile(name, buf, mtime, type) { return new File([buf], name, { lastModified: mtime || Date.now(), type: type || '' }); }
  function RemoteFile(path, name, meta, created) {
    const key = path.concat(name).join('/');
    return {
      kind: 'file', name,
      async getFile() {
        const c = fileCache.get(key);
        if (meta && c && c.size === meta.size && c.mtime === meta.mtime) return c.file;
        let r;
        try { r = await api(path.concat(name), 'read'); } catch (e) { if (created && e.name === 'NotFoundError') return mkFile(name, new Uint8Array(0), 0); throw e; } // 새로 만든 파일은 빈 파일로 (진짜 폴더와 같게)
        const buf = await r.arrayBuffer(); const mt = +r.headers.get('X-Mtime') || Date.now();
        const f = mkFile(name, buf, mt, (r.headers.get('Content-Type') || '').split(';')[0]);
        fileCache.set(key, { size: f.size, mtime: mt, file: f });
        return f;
      },
      async createWritable(o) {
        const keep = !!(o && o.keepExistingData);
        let base = new Uint8Array(0), loaded = !keep, pos = 0, appendOnly = keep, wrote = false;
        const parts = [];
        const toBytes = async (d) => d instanceof Blob ? new Uint8Array(await d.arrayBuffer()) : typeof d === 'string' ? new TextEncoder().encode(d) : d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new TextEncoder().encode(String(d));
        async function load() { if (loaded) return; loaded = true; try { base = new Uint8Array(await (await this_.getFile()).arrayBuffer()); } catch (e) { if (e.name !== 'NotFoundError') throw e; } }
        const this_ = this;
        return {
          async seek(p) { pos = p; if (p === 0) appendOnly = false; },
          async truncate(n) { appendOnly = false; await load(); base = base.slice(0, n); if (pos > n) pos = n; },
          async write(d) {
            if (d && typeof d === 'object' && !(d instanceof Blob) && !ArrayBuffer.isView(d) && !(d instanceof ArrayBuffer) && d.type) {
              if (d.type === 'seek') return this.seek(d.position);
              if (d.type === 'truncate') return this.truncate(d.size);
              if (d.position != null) pos = d.position; d = d.data;
            }
            const b = await toBytes(d); wrote = true;
            if (appendOnly && pos > 0) { parts.push(b); pos += b.length; return; } // 기록 덧붙이기(학습 모듈) → 서버에서 끝에 붙임
            if (appendOnly) { appendOnly = false; }
            await load();
            if (parts.length) { const cat = new Uint8Array(base.length + parts.reduce((a, x) => a + x.length, 0)); cat.set(base); let o2 = base.length; for (const x of parts) { cat.set(x, o2); o2 += x.length; } base = cat; parts.length = 0; }
            const end = Math.max(base.length, pos + b.length); const nb = new Uint8Array(end); nb.set(base); nb.set(b, pos); base = nb; pos += b.length;
          },
          async close() {
            if (keep && appendOnly) { if (parts.length) await api(path.concat(name), 'append', { method: 'PUT', body: new Blob(parts) }); }
            else if (wrote || !keep) await api(path.concat(name), 'write', { method: 'PUT', body: new Blob([base]) });
            fileCache.delete(key);
          },
          async abort() {},
        };
      },
    };
  }
  function RemoteDir(path, created) {
    const dir = {
      kind: 'directory', name: path.length ? path[path.length - 1] : DATA_DIR,
      async getDirectoryHandle(n, o) { return RemoteDir(path.concat(n), !!(o && o.create)); },
      async getFileHandle(n, o) {
        if (!(o && o.create)) { await api(path.concat(n), 'read', { method: 'HEAD' }); }
        return RemoteFile(path, n, null, !!(o && o.create));
      },
      async removeEntry(n) { await api(path.concat(n), '', { method: 'DELETE' }); fileCache.delete(path.concat(n).join('/')); },
      async list() {
        try { return await (await api(path, 'list')).json(); } catch (e) { if (e.name === 'NotFoundError' && created) return []; throw e; }
      },
      async *entries() { for (const [n, k, size, mtime] of await dir.list()) yield [n, k === 'directory' ? RemoteDir(path.concat(n)) : RemoteFile(path, n, { size, mtime })]; },
      async *keys() { for await (const [n] of dir.entries()) yield n; },
      async *values() { for await (const [, h] of dir.entries()) yield h; },
      [Symbol.asyncIterator]() { return dir.entries(); },
      // 컬렉션 한꺼번에 읽기: 바뀐 파일 내용만 받아 옴
      async readAll() {
        const k = path.join('/'); const c = readAllCache.get(k) || { since: 0, files: new Map() };
        let arr;
        try { arr = await (await api(path, 'readall&since=' + c.since)).json(); } catch (e) { if (e.name === 'NotFoundError') return []; throw e; }
        const files = new Map(); let mx = 0;
        for (const [n, size, mtime, txt] of arr) {
          const old = c.files.get(n);
          let t = txt;
          if (t == null) t = old && old.size === size && old.mtime === mtime ? old.text : await (await RemoteFile(path, n).getFile()).text();
          files.set(n, { size, mtime, text: t }); if (mtime > mx) mx = mtime;
        }
        readAllCache.set(k, { since: mx ? mx - 2000 : 0, files });
        return [...files.entries()].map(([n, v]) => ({ name: n, mtime: v.mtime, size: v.size, text: v.text }));
      },
    };
    return dir;
  }
  const readAllCache = new Map();
  async function detectServer() {
    if (!/^https?:$/.test(location.protocol)) return false;
    try { const r = await fetch('/_api/ping', { credentials: 'same-origin', cache: 'no-store' }); if (r.status === 401) { goLogin(); return 'wait'; } if (!r.ok) return false; return (await r.json()).server === 'chamdre-pc'; } catch (e) { return false; }
  }

  /* ---------- 연결 상태 ---------- */
  let dataDir = null, pickedName = '';
  let readyResolve; const ready = new Promise((r) => (readyResolve = r));

  async function connect(handle) {
    pickedName = serverMode ? APP : handle.name;
    dataDir = serverMode ? handle : handle.name === DATA_DIR ? handle : await handle.getDirectoryHandle(DATA_DIR, { create: true });
    if (!serverMode) await idbSet(APP, handle);
    hideBanner(); showBadge();
    readyResolve();
    startPolling();
  }

  async function init() {
    // 개발 확인용: 주소 끝에 ?pctest 를 붙이면 브라우저 내부 저장소를 씀 (실제 사용과 무관)
    if (/[?&]pctest\b/.test(location.search) && navigator.storage && navigator.storage.getDirectory) {
      const root = await navigator.storage.getDirectory();
      await connect(await root.getDirectoryHandle('pctest-' + APP, { create: true }));
      return;
    }
    // 클라우드(수파베이스) 판: 로그인 후 바로 연결
    if (window.__pcCloud) { await window.__pcCloud.start(); serverMode = true; pickedName = APP; await connect(RemoteDir([], true)); return; }
    // 참드레 프로그램 서버로 열었으면 폴더 고르기 없이 바로 연결
    const sv = await detectServer();
    if (sv === 'wait') return;
    if (sv) { serverMode = true; pickedName = APP; await connect(RemoteDir([], true)); return; }
    if (!window.showDirectoryPicker) { showBanner(null, true); return; }
    const h = await idbGet(APP);
    if (h) {
      try { if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') { await connect(h); return; } } catch (e) {}
    }
    showBanner(h, false);
  }

  /* ---------- 화면: 연결 안내 배너 ---------- */
  let banner = null, badge = null;
  const CSS = `
  .pcrt-banner{position:fixed;inset:0;z-index:2147483000;background:rgba(15,20,18,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif}
  .pcrt-box{background:#fff;color:#1a2420;border-radius:12px;max-width:460px;width:100%;padding:22px 22px 18px;box-shadow:0 10px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:12px}
  .pcrt-box h2{margin:0;font-size:19px}
  .pcrt-box p{margin:0;font-size:14px;line-height:1.6;color:#44514b}
  .pcrt-box b{color:#1a2420}
  .pcrt-btns{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:4px}
  .pcrt-btns button{font:inherit;font-size:14px;font-weight:700;border-radius:8px;padding:10px 16px;cursor:pointer;border:1px solid #c9d0c8;background:#fff;color:#1a2420}
  .pcrt-btns button.pri{background:#2c6a4f;border-color:#2c6a4f;color:#fff}
  .pcrt-badge{position:fixed;left:10px;bottom:10px;z-index:2147482999;font:12px "Malgun Gothic",sans-serif;background:rgba(26,36,32,.82);color:#fff;border-radius:999px;padding:5px 10px;display:flex;gap:8px;align-items:center}
  .pcrt-badge button{font:inherit;border:0;background:transparent;color:#9fe0bf;cursor:pointer;padding:0;text-decoration:underline}
  @media print{.pcrt-badge,.pcrt-banner{display:none!important}}`;
  function addCss() { if (document.getElementById('pcrt-css')) return; const s = document.createElement('style'); s.id = 'pcrt-css'; s.textContent = CSS; document.head.appendChild(s); }
  function whenBody(fn) { if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn); }

  async function pickFolder() {
    try {
      const h = await window.showDirectoryPicker({ id: 'pcrt', mode: 'readwrite', startIn: 'desktop' });
      await connect(h);
    } catch (e) { if (e && e.name !== 'AbortError') alert('폴더를 연결하지 못했습니다: ' + (e.message || e)); }
  }
  function showBanner(prev, unsupported) {
    whenBody(() => {
      addCss();
      if (banner) banner.remove();
      banner = document.createElement('div');
      banner.className = 'pcrt-banner';
      if (unsupported) {
        banner.innerHTML = `<div class="pcrt-box" role="dialog" aria-label="브라우저 안내"><h2>크롬이나 엣지에서 열어 주세요</h2><p>이 PC용 프로그램은 데이터를 PC 폴더에 저장하기 때문에 <b>크롬(Chrome)</b> 또는 <b>엣지(Edge)</b>에서만 동작합니다.</p></div>`;
      } else {
        banner.innerHTML = `<div class="pcrt-box" role="dialog" aria-label="데이터 폴더 연결"><h2>데이터 폴더 연결</h2>
          <p>이 프로그램의 데이터를 저장할 폴더를 골라 주세요. 고른 폴더 안에 <b>'${DATA_DIR}'</b> 폴더가 만들어지고 거기에 저장됩니다.</p>
          <p>보통은 이 프로그램이 들어 있는 폴더 <b>(${esc(APP)})</b>를 고르면 됩니다.${prev ? `<br>지난번 연결: <b>${esc(prev.name)}</b>` : ''}</p>
          <div class="pcrt-btns">${prev ? '<button type="button" data-a="pick">다른 폴더 고르기</button><button type="button" class="pri" data-a="re">지난 폴더 다시 연결</button>' : '<button type="button" class="pri" data-a="pick">폴더 고르기</button>'}</div></div>`;
        banner.addEventListener('click', async (e) => {
          const a = e.target.closest('button') && e.target.closest('button').dataset.a;
          if (a === 'pick') pickFolder();
          if (a === 're') {
            try { if ((await prev.requestPermission({ mode: 'readwrite' })) === 'granted') await connect(prev); } catch (err) { pickFolder(); }
          }
        });
      }
      document.body.appendChild(banner);
    });
  }
  function hideBanner() { if (banner) { banner.remove(); banner = null; } }
  function showBadge() {
    whenBody(() => {
      addCss();
      if (!badge) { badge = document.createElement('div'); badge.className = 'pcrt-badge'; document.body.appendChild(badge); }
      if (window.__pcCloud) { badge.innerHTML = `<span>☁️ 클라우드 저장</span><button type="button">목록</button>`; badge.querySelector('button').onclick = () => { location.href = window.__pcCloud.home; }; return; }
      if (serverMode) { badge.innerHTML = `<span>💾 PC 저장: ${esc(pickedName)}\\${DATA_DIR}</span><button type="button">목록</button>`; badge.querySelector('button').onclick = () => { location.href = '/'; }; return; }
      badge.innerHTML = `<span>💾 PC 저장: ${esc(pickedName)}${pickedName === DATA_DIR ? '' : '\\' + DATA_DIR}</span><button type="button">폴더 변경</button>`;
      badge.querySelector('button').onclick = () => { if (confirm('데이터 폴더를 바꾸면 화면을 새로 불러옵니다. 바꿀까요?')) window.showDirectoryPicker({ id: 'pcrt', mode: 'readwrite' }).then(async (h) => { await idbSet(APP, h); location.reload(); }).catch(() => {}); };
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* ---------- 파일 이름 ---------- */
  function enc(s) { return String(s).replace(/[\\/:*?"<>|%\u0000-\u001f]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()).replace(/^\.|\.$|^ | $/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }
  function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function newId() { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let s = ''; const r = crypto.getRandomValues(new Uint8Array(20)); for (const x of r) s += a[x % a.length]; return s; }
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const segs = (p) => String(p).split('/').filter(Boolean);

  async function dirAt(colSegs, create) {
    let d = dataDir;
    for (const s of colSegs) d = await d.getDirectoryHandle(enc(s), { create });
    return d;
  }

  /* ---------- 읽기 캐시 ---------- */
  const cache = new Map(); // key "col/path|file" -> {mtime, data}
  async function readFileJson(fh, key) {
    const f = await fh.getFile();
    const c = cache.get(key);
    if (c && c.mtime === f.lastModified && c.size === f.size) return c.data;
    let data = null;
    try { data = JSON.parse(await f.text()); } catch (e) { data = null; }
    cache.set(key, { mtime: f.lastModified, size: f.size, data });
    return data;
  }
  async function readDoc(colSegs, id) {
    await ready;
    try {
      const d = await dirAt(colSegs, false);
      const fh = await d.getFileHandle(enc(id) + '.json');
      return await readFileJson(fh, colSegs.join('/') + '|' + id);
    } catch (e) { return null; }
  }
  async function listCol(colSegs) {
    await ready;
    let d;
    try { d = await dirAt(colSegs, false); } catch (e) { return []; }
    const out = [];
    if (d.readAll) {
      for (const f of await d.readAll()) {
        if (!f.name.endsWith('.json')) continue;
        const id = dec(f.name.slice(0, -5)); const key = colSegs.join('/') + '|' + id;
        const c = cache.get(key); let data;
        if (c && c.mtime === f.mtime && c.size === f.size) data = c.data;
        else { try { data = JSON.parse(f.text); } catch (e) { data = null; } cache.set(key, { mtime: f.mtime, size: f.size, data }); }
        if (data != null) out.push({ id, data });
      }
      return out;
    }
    for await (const [name, h] of d.entries()) {
      if (h.kind !== 'file' || !name.endsWith('.json')) continue;
      const id = dec(name.slice(0, -5));
      try { const data = await readFileJson(h, colSegs.join('/') + '|' + id); if (data != null) out.push({ id, data }); } catch (e) {}
    }
    return out;
  }

  /* ---------- 쓰기 (순서대로) ---------- */
  let chain = Promise.resolve();
  function queue(fn) { const p = chain.then(fn); chain = p.catch(() => {}); return p; }
  const hooks = { write: [], del: [], asset: [], download: [], error: [] };
  function fire(kind, ...a) { for (const f of hooks[kind]) { try { f(...a); } catch (e) {} } }
  async function writeDoc(colSegs, id, data) {
    await ready;
    const old = hooks.write.length ? await readDoc(colSegs, id) : null;
    return queue(async () => {
      const d = await dirAt(colSegs, true);
      const fh = await d.getFileHandle(enc(id) + '.json', { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(data));
      await w.close();
      cache.delete(colSegs.join('/') + '|' + id);
    }).then(() => { notify(); fire('write', colSegs, id, old, data); },
      (e) => { fire('error', { 내용: '저장 실패: ' + (e && (e.message || e.name) || e), 경로: colSegs.concat(id).join('/') }); throw e; });
  }
  async function deleteDoc(colSegs, id) {
    await ready;
    const old = hooks.del.length ? await readDoc(colSegs, id) : null;
    return queue(async () => {
      try { const d = await dirAt(colSegs, false); await d.removeEntry(enc(id) + '.json'); } catch (e) { if (e && e.name !== 'NotFoundError') throw e; }
      cache.delete(colSegs.join('/') + '|' + id);
    }).then(() => { notify(); fire('del', colSegs, id, old); },
      (e) => { fire('error', { 내용: '삭제 실패: ' + (e && (e.message || e.name) || e), 경로: colSegs.concat(id).join('/') }); throw e; });
  }

  /* ---------- 스냅샷 ---------- */
  const META = { hasPendingWrites: false, fromCache: false };
  function getField(o, f) { return String(f).split('.').reduce((a, k) => (a == null ? undefined : a[k]), o); }
  function docSnap(ref, data) {
    return { id: ref.id, ref, exists: data != null, metadata: META, data: () => (data == null ? undefined : clone(data)), get: (f) => clone(getField(data, f)) };
  }
  function querySnap(items, colSegs) {
    const docs = items.map((x) => docSnap(docRef(colSegs.concat(x.id)), x.data));
    return { docs, size: docs.length, empty: docs.length === 0, metadata: META, forEach: (fn) => docs.forEach(fn), docChanges: () => [] };
  }

  /* ---------- 질의 ---------- */
  function cmp(a, b) {
    if (a === b) return 0;
    if (a === undefined || a === null) return -1;
    if (b === undefined || b === null) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  }
  function test(v, op, x) {
    switch (op) {
      case '==': return cmp(v, x) === 0 && v !== undefined;
      case '!=': return cmp(v, x) !== 0;
      case '<': return v != null && cmp(v, x) < 0;
      case '<=': return v != null && cmp(v, x) <= 0;
      case '>': return v != null && cmp(v, x) > 0;
      case '>=': return v != null && cmp(v, x) >= 0;
      case 'in': return Array.isArray(x) && x.some((y) => cmp(v, y) === 0);
      case 'not-in': return Array.isArray(x) && !x.some((y) => cmp(v, y) === 0);
      case 'array-contains': return Array.isArray(v) && v.some((y) => cmp(y, x) === 0);
      case 'array-contains-any': return Array.isArray(v) && Array.isArray(x) && v.some((y) => x.some((z) => cmp(y, z) === 0));
      default: return true;
    }
  }
  function applyQuery(items, q) {
    let r = items.filter((it) => q.where.every(([f, op, x]) => test(f === '__name__' ? it.id : getField(it.data, f), op, x)));
    if (q.order.length) r.sort((a, b) => { for (const [f, dir] of q.order) { const c = cmp(getField(a.data, f), getField(b.data, f)); if (c) return dir === 'desc' ? -c : c; } return 0; });
    else r.sort((a, b) => cmp(a.id, b.id));
    if (q.limit != null) r = r.slice(0, q.limit);
    return r;
  }

  /* ---------- 실시간 반영 ---------- */
  const listeners = new Set();
  async function runListener(L) {
    try {
      let sig, snap;
      if (L.kind === 'doc') {
        const data = await readDoc(L.colSegs, L.id);
        sig = JSON.stringify(data);
        if (sig !== L.last) snap = docSnap(docRef(L.colSegs.concat(L.id)), data);
      } else {
        const items = applyQuery(await listCol(L.colSegs), L.q);
        sig = JSON.stringify(items);
        if (sig !== L.last) snap = querySnap(items, L.colSegs);
      }
      if (snap && L.active) { L.last = sig; L.cb(snap); }
    } catch (e) { if (L.err) try { L.err(e); } catch (x) {} }
  }
  let notifyT = null;
  function notify() { clearTimeout(notifyT); notifyT = setTimeout(() => listeners.forEach(runListener), 30); }
  let polling = false;
  function startPolling() {
    if (polling) return; polling = true;
    setInterval(() => { if (document.visibilityState === 'visible') listeners.forEach(runListener); }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') listeners.forEach(runListener); });
  }
  function listen(L) {
    L.active = true; listeners.add(L);
    ready.then(() => runListener(L));
    return () => { L.active = false; listeners.delete(L); };
  }

  /* ---------- Firestore 비슷한 API ---------- */
  function docRef(all) {
    const id = all[all.length - 1], colSegs = all.slice(0, -1);
    const ref = {
      id, path: all.join('/'),
      parent: null,
      collection: (p) => colRef(all.concat(segs(p))),
      get: async () => docSnap(ref, await readDoc(colSegs, id)),
      set: async (data, opt) => {
        let v = clone(data);
        if (opt && opt.merge) v = Object.assign({}, (await readDoc(colSegs, id)) || {}, v);
        await writeDoc(colSegs, id, v);
      },
      update: async (data) => {
        const cur = await readDoc(colSegs, id);
        if (cur == null) { const e = new Error('문서가 없습니다'); e.code = 'not-found'; throw e; }
        const v = clone(cur);
        for (const [k, x] of Object.entries(data)) {
          const ks = k.split('.'); let o = v;
          for (let i = 0; i < ks.length - 1; i++) { if (typeof o[ks[i]] !== 'object' || o[ks[i]] === null) o[ks[i]] = {}; o = o[ks[i]]; }
          if (x && x.__delete__) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = clone(x);
        }
        await writeDoc(colSegs, id, v);
      },
      delete: () => deleteDoc(colSegs, id),
      onSnapshot: (a, b) => {
        const cb = typeof a === 'function' ? a : (a && a.next) || (() => {});
        const err = typeof a === 'function' ? b : a && a.error;
        return listen({ kind: 'doc', colSegs, id, cb, err });
      },
    };
    return ref;
  }
  function query(colSegs, q) {
    const api = {
      where: (f, op, x) => query(colSegs, { ...q, where: q.where.concat([[f, op, x]]) }),
      orderBy: (f, dir) => query(colSegs, { ...q, order: q.order.concat([[f, dir || 'asc']]) }),
      limit: (n) => query(colSegs, { ...q, limit: n }),
      startAfter: () => api, startAt: () => api, endBefore: () => api, endAt: () => api,
      get: async () => querySnap(applyQuery(await listCol(colSegs), q), colSegs),
      onSnapshot: (a, b) => {
        const cb = typeof a === 'function' ? a : (a && a.next) || (() => {});
        const err = typeof a === 'function' ? b : a && a.error;
        return listen({ kind: 'query', colSegs, q, cb, err });
      },
    };
    return api;
  }
  function colRef(colSegs) {
    const q = query(colSegs, { where: [], order: [], limit: null });
    return Object.assign(q, {
      id: colSegs[colSegs.length - 1], path: colSegs.join('/'),
      doc: (id) => docRef(colSegs.concat(id == null ? newId() : segs(id))),
      add: async (data) => { const r = docRef(colSegs.concat(newId())); await r.set(data); return r; },
    });
  }
  function pathRef(p) { const s = segs(p); return s.length % 2 === 0 ? docRef(s) : colRef(s); }
  const db = {
    doc: (p) => { const s = segs(p); return s.length % 2 === 0 ? docRef(s) : colRef(s); },
    collection: (p) => pathRef(p),
    batch: () => { const ops = []; const b = { set: (r, d, o) => (ops.push(() => r.set(d, o)), b), update: (r, d) => (ops.push(() => r.update(d)), b), delete: (r) => (ops.push(() => r.delete()), b), commit: async () => { for (const f of ops) await f(); } }; return b; },
    runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o), update: (r, d) => r.update(d), delete: (r) => r.delete() }),
  };

  /* ---------- 사진·파일 (assets) ---------- */
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'text/csv': 'csv', 'application/json': 'json', 'text/plain': 'txt' };
  const urlCache = new Map();
  async function assetFile(id) {
    await ready;
    const d = await dirAt(['_assets'], true);
    for await (const [name, h] of d.entries()) {
      if (h.kind === 'file' && (name === id || name.startsWith(id + '.'))) return h.getFile();
    }
    return null;
  }
  async function assetUrl(id) {
    if (urlCache.has(id)) return urlCache.get(id);
    const p = assetFile(id).then((f) => (f ? URL.createObjectURL(f) : ''));
    urlCache.set(id, p);
    return p;
  }
  const assets = {
    upload: async (blob, opt) => {
      await ready;
      const type = (opt && opt.type) || blob.type || 'application/octet-stream';
      const id = newId(); const ext = EXT[type] || (blob.name && blob.name.includes('.') ? blob.name.split('.').pop() : 'bin');
      await queue(async () => {
        const d = await dirAt(['_assets'], true);
        const fh = await d.getFileHandle(id + '.' + ext, { create: true });
        const w = await fh.createWritable(); await w.write(blob); await w.close();
      });
      fire('asset', 'upload', id, type, blob.size);
      return { id, url: '/_blob/' + id, type, size: blob.size };
    },
    delete: async (id) => {
      await ready;
      await queue(async () => {
        const d = await dirAt(['_assets'], true);
        for await (const [name, h] of d.entries()) if (h.kind === 'file' && (name === id || name.startsWith(id + '.'))) await d.removeEntry(name);
      });
      urlCache.delete(id);
      fire('asset', 'delete', id);
    },
    url: (id) => assetUrl(id),
  };

  // fetch("/_blob/<id>") → PC 파일
  const blobRe = /(?:^|\/)_blob\/([A-Za-z0-9_-]+)/;
  const origFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const u = typeof input === 'string' ? input : input && input.url;
    const m = u && (u.startsWith('/_blob/') || /^file:.*\/_blob\//.test(u)) && u.match(blobRe);
    if (m) {
      const f = await assetFile(m[1]);
      return f ? new Response(f, { status: 200, headers: { 'Content-Type': f.type || 'application/octet-stream' } }) : new Response('', { status: 404 });
    }
    return origFetch(input, init);
  };
  // <img src="/_blob/..">, <a href="/_blob/.."> → PC 파일 주소로 바꾸기
  function fixEl(el) {
    for (const attr of ['src', 'href']) {
      const v = el.getAttribute && el.getAttribute(attr);
      if (v && v.startsWith('/_blob/')) {
        const m = v.match(blobRe); if (!m) continue;
        el.setAttribute('data-pcrt-' + attr, v);
        el.setAttribute(attr, 'data:,');
        assetUrl(m[1]).then((url) => { if (el.getAttribute('data-pcrt-' + attr) === v) el.setAttribute(attr, url || ''); });
      }
    }
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    fixEl(root);
    root.querySelectorAll && root.querySelectorAll('[src^="/_blob/"],[href^="/_blob/"]').forEach(fixEl);
  }
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'attributes') fixEl(m.target);
      else m.addedNodes.forEach(scan);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href'] });

  /* ---------- 내려받기 ---------- */
  const downloads = {
    save: async ({ filename, data, type }) => {
      const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename || 'download';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      fire('download', filename || 'download', blob.size);
      return 'saved';
    },
  };

  /* ---------- 사용자 ---------- */
  const user = {
    id: async () => 'pc-local',
    me: async () => ({ id: 'pc-local', name: '' }),
    can: async () => true,
    profiles: async () => ({}),
  };

  /* ---------- window.claude ---------- */
  const apis = { db, assets, downloads, user };
  window.claude = window.claude || {};
  window.claude.use = async function (name) { return apis[name] || null; };
  window.claude.isPc = true;

  // 학습 모듈(pc-learn.js)이 쓰는 연결점
  window.__pcrt = {
    APP, ready, hooks, queue, dirAt, listCol, readDoc, enc, dec, esc,
    get dataDir() { return dataDir; },
    get badge() { return badge; },
  };

  init();
})();
