/* 클라우드(수파베이스) 저장 모듈
 * pc-runtime.js보다 먼저 불러오면, 데이터를 PC 폴더 대신 수파베이스에 저장합니다.
 * 폴더와 똑같은 모양(경로/파일)으로 pc_files 표 한 개에 저장 → 프로그램·학습 모듈은 그대로 동작.
 * 설정: _pc/cloud-config.js 의 window.PC_CLOUD = { url, key }  (key = Publishable/anon 키, 공개돼도 되는 키)
 * 로그인: 수파베이스 Authentication에 등록한 이메일·비밀번호
 */
(function () {
  'use strict';
  const C = window.PC_CLOUD || {};
  if (!(C.url && C.key) && !window.__pcCloudMock) return;

  let sb = null;
  function client() {
    if (sb) return sb;
    if (window.__pcCloudMock) return (sb = window.__pcCloudMock);
    if (!window.supabase || !window.supabase.createClient) throw new Error('수파베이스 도구를 불러오지 못함 (인터넷 연결 확인)');
    sb = window.supabase.createClient(C.url, C.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'chamdre-cloud' } });
    return sb;
  }

  function nf() { const e = new Error('없음'); e.name = 'NotFoundError'; return e; }
  async function rpc(name, args) {
    const { data, error } = await client().rpc(name, args);
    if (error) {
      if (/jwt|auth|permission|401|42501/i.test((error.message || '') + (error.code || ''))) { showLogin('로그인이 끝났습니다. 다시 로그인해 주세요.'); }
      throw new Error('클라우드 오류: ' + (error.message || error.code));
    }
    return data;
  }

  const TEXT = /\.(json|jsonl|txt|csv|md|html?)$/i;
  const MIME = { json: 'application/json', jsonl: 'application/x-ndjson', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel' };
  const mimeOf = (p) => MIME[(p.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
  function b64enc(u8) { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
  function b64dec(s) { const b = atob(s || ''); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  const jres = (o) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
  async function bodyBytes(b) { if (b == null) return new Uint8Array(0); if (b instanceof Blob) return new Uint8Array(await b.arrayBuffer()); if (typeof b === 'string') return new TextEncoder().encode(b); return new Uint8Array(b); }

  // pc-runtime.js의 서버 API(/_api/fs/...)와 같은 약속으로 동작
  async function api(segs, op, opt) {
    const p = segs.join('/');
    const method = (opt && opt.method) || 'GET';
    op = op || '';
    if (method === 'DELETE') {
      const r = await rpc('pc_delete', { p_path: p });
      if (r === 'notfound') throw nf();
      if (r === 'notempty') throw new Error('클라우드 오류: 폴더가 비어 있지 않음');
      return jres({ ok: true });
    }
    if (method === 'PUT') {
      const u8 = await bodyBytes(opt.body);
      const isText = TEXT.test(p);
      const body = isText ? new TextDecoder().decode(u8) : b64enc(u8);
      const r = op === 'append' ? await rpc('pc_append', { p_path: p, p_body: body }) : await rpc('pc_write', { p_path: p, p_body: body, p_is_text: isText, p_size: u8.length });
      return jres(r);
    }
    if (op === 'list') { const r = await rpc('pc_list', { p_path: p }); if (r == null) throw nf(); return jres(r); }
    if (op.indexOf('readall') === 0) {
      const m = /since=(\d+)/.exec(op); const r = await rpc('pc_readall', { p_path: p, p_since: m ? +m[1] : 0 });
      if (r == null) throw nf(); return jres(r);
    }
    if (op === 'read') {
      const head = method === 'HEAD';
      const r = await rpc('pc_read', { p_path: p, p_head: head });
      if (!r) throw nf();
      const hd = { 'X-Mtime': String(r.mtime), 'Content-Type': mimeOf(p) };
      if (head) return new Response(null, { headers: hd });
      return new Response(r.is_text ? new TextEncoder().encode(r.body || '') : b64dec(r.body), { headers: hd });
    }
    throw new Error('클라우드 오류: 알 수 없는 요청 ' + op);
  }

  /* ---------- 로그인 화면 ---------- */
  let box = null, loginDone = null;
  const CSS = `.pccl-wrap{position:fixed;inset:0;z-index:2147483001;background:#eef3ef;display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif}
  .pccl-box{background:#fff;color:#1a2420;border-radius:14px;max-width:380px;width:100%;padding:24px 20px;box-shadow:0 8px 30px rgba(0,0,0,.12);display:flex;flex-direction:column;gap:12px}
  .pccl-box h2{margin:0;font-size:20px}.pccl-box p{margin:0;font-size:14px;color:#44514b;line-height:1.5}
  .pccl-box input{font:inherit;font-size:16px;padding:12px;border:1px solid #c9d0c8;border-radius:8px;width:100%;box-sizing:border-box}
  .pccl-box button{font:inherit;font-size:16px;font-weight:700;padding:12px;border:0;border-radius:8px;background:#2c6a4f;color:#fff;cursor:pointer}
  .pccl-err{color:#b3261e!important;min-height:1em}`;
  function showLogin(msg) {
    const mount = () => {
      if (box) { box.querySelector('.pccl-err').textContent = msg || ''; return; }
      if (!document.getElementById('pccl-css')) { const s = document.createElement('style'); s.id = 'pccl-css'; s.textContent = CSS; document.head.appendChild(s); }
      box = document.createElement('div'); box.className = 'pccl-wrap';
      box.innerHTML = `<form class="pccl-box" aria-label="로그인"><h2>참드레 프로그램 로그인</h2><p>등록된 이메일과 비밀번호를 넣어 주세요. 한 번 로그인하면 이 기기에서는 계속 유지됩니다.</p>
        <input type="email" name="e" placeholder="이메일" autocomplete="username" required><input type="password" name="p" placeholder="비밀번호" autocomplete="current-password" required>
        <p class="pccl-err">${msg || ''}</p><button type="submit">로그인</button></form>`;
      box.querySelector('form').addEventListener('submit', async (ev) => {
        ev.preventDefault(); const f = ev.target; const err = f.querySelector('.pccl-err'); err.textContent = '확인 중…';
        try {
          const { error } = await client().auth.signInWithPassword({ email: f.e.value.trim(), password: f.p.value });
          if (error) { err.textContent = /invalid/i.test(error.message) ? '이메일 또는 비밀번호가 맞지 않습니다.' : '로그인 실패: ' + error.message; return; }
          box.remove(); box = null; if (loginDone) { const d = loginDone; loginDone = null; d(); }
        } catch (e) { err.textContent = '로그인 실패: ' + (e.message || e); }
      });
      document.body.appendChild(box);
    };
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  }

  async function start() {
    try {
      const { data } = await client().auth.getSession();
      if (data && data.session) return true;
    } catch (e) { showLogin(e.message); }
    await new Promise((ok) => { loginDone = ok; showLogin(''); });
    return true;
  }
  async function logout() { try { await client().auth.signOut(); } catch (e) {} }

  window.__pcCloud = { on: true, api, start, logout, rpc, client, b64enc, b64dec, TEXT, home: C.home || '../index.html' };
})();