/* データの保存・読み込み
   - このページ内のメモリ + この端末 (localStorage)
   - claude.ai 上で開いたときはクラウド (db) にも保存し、PC とスマホで同じデータを使う */
var RBStore = (function () {
  'use strict';
  const KEY = 'rouletteBattle.data.v1';
  const DOC_MAIN = 'gamedata/main';
  const IMG_COL = 'charimg';
  const ARRAYS = ['elements', 'types', 'statuses', 'moves', 'abilities', 'chars', 'gears', 'items'];

  let memJson = null;
  const listeners = [];
  const cloud = {
    state: 'local',      // local | connecting | synced | saving | readonly | error
    message: '',
    db: null,
    imgKnown: new Map(), // charId -> 画像 (クラウドにあるもの)
    lastPushedAt: null,
    timer: null, pushing: false, pending: false,
  };

  function normalize(d) {
    d = d && typeof d === 'object' ? d : {};
    for (const k of ARRAYS) if (!Array.isArray(d[k])) d[k] = [];
    if (!d.chart || typeof d.chart !== 'object') d.chart = {};
    d.rules = Object.assign({}, RB.DEFAULT_RULES, d.rules || {});
    d.meta = d.meta || {};
    d.version = d.version || 1;
    if (d.rules.orderBy === 'dots') d.rules.orderBy = 'speed';
    for (const c of d.chars) {
      if (!Array.isArray(c.moves)) c.moves = [];
      if (!Array.isArray(c.abilities)) c.abilities = [];
      // 旧形式 (●・★ が数値だった頃) からの移行: ●の数 → すばやさ
      if (c.speed == null) c.speed = c.dots != null ? c.dots : 3;
      if (c.mark == null) c.mark = '';
      delete c.dots; delete c.stars;
    }
    for (const m of d.moves) if (!Array.isArray(m.effects)) m.effects = [];
    for (const a of d.abilities) if (!Array.isArray(a.effects)) a.effects = [];
    return d;
  }

  function lsGet() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function lsSet(s) { try { localStorage.setItem(KEY, s); return true; } catch (e) { return false; } }
  function lsDel() { try { localStorage.removeItem(KEY); } catch (e) { /* noop */ } }

  function emit(ev) { for (const fn of listeners) { try { fn(ev); } catch (e) { console.error(e); } } }
  function onChange(fn) { listeners.push(fn); }

  function load() {
    const s = memJson || lsGet();
    if (s) {
      try {
        const d = normalize(JSON.parse(s));
        return { data: d, source: 'custom', savedAt: d.meta.savedAt || null };
      } catch (e) { console.warn('保存データの読み込みに失敗', e); }
    }
    return { data: normalize(RB.clone(RB_DEFAULT_DATA)), source: 'default', savedAt: null };
  }

  // 戻り値: この端末に保存できたか (クラウドは非同期)
  function save(data) {
    data.meta = data.meta || {};
    data.meta.savedAt = new Date().toISOString();
    const s = JSON.stringify(data);
    memJson = s;
    const ok = lsSet(s);
    queueCloud();
    return ok;
  }

  function clearLocal() { memJson = null; lsDel(); }
  // 別タブで保存された時: 次の load() で localStorage から読み直す
  function clearMemory() { memJson = null; }

  // ===================== クラウド (claude.ai の db) =====================
  function setState(state, message) {
    cloud.state = state;
    cloud.message = message || '';
    emit({ type: 'status', state, message: cloud.message });
  }

  function statusLabel() {
    switch (cloud.state) {
      case 'connecting': return '☁ 接続中…';
      case 'synced': return '☁ クラウド保存 (PC・スマホ共通)';
      case 'saving': return '☁ 保存中…';
      case 'readonly': return '☁ 閲覧のみ (変更はこの端末だけに保存)';
      case 'error': return '⚠ クラウドに保存できません' + (cloud.message ? ` (${cloud.message})` : '');
      default: return '💾 この端末に保存';
    }
  }

  const ts = (iso) => { const t = Date.parse(iso || ''); return isNaN(t) ? 0 : t; };

  async function readRemote() {
    const snap = await cloud.db.doc(DOC_MAIN).get();
    if (!snap.exists) return null;
    const body = snap.data() || {};
    let d;
    try { d = normalize(JSON.parse(body.json)); } catch (e) { return null; }
    if (d.chars.some(c => c.image === '@cloud')) {
      const q = await cloud.db.collection(IMG_COL).get();
      const imgs = {};
      for (const doc of q.docs) { const b = doc.data() || {}; if (b.id && b.image) imgs[b.id] = b.image; }
      cloud.imgKnown = new Map(Object.entries(imgs));
      for (const c of d.chars) {
        if (c.image !== '@cloud') continue;
        if (imgs[c.id]) c.image = imgs[c.id]; else delete c.image;
      }
    }
    return d;
  }

  function applyRemote(d, why) {
    memJson = JSON.stringify(d);
    lsSet(memJson);
    emit({ type: 'data', why, data: d });
  }

  async function pushNow() {
    if (!cloud.db || !memJson) return;
    const d = JSON.parse(memJson);
    const imgs = {};
    for (const c of d.chars) {
      if (c.image && String(c.image).startsWith('data:')) { imgs[c.id] = c.image; c.image = '@cloud'; }
    }
    const segId = (id) => String(id).replace(/[^A-Za-z0-9_\-.~:@+]/g, '_');
    for (const [id, img] of Object.entries(imgs)) {
      if (cloud.imgKnown.get(id) === img) continue;
      await cloud.db.doc(IMG_COL + '/' + segId(id)).set({ id, image: img });
      cloud.imgKnown.set(id, img);
    }
    for (const id of [...cloud.imgKnown.keys()]) {
      if (id in imgs) continue;
      await cloud.db.doc(IMG_COL + '/' + segId(id)).delete();
      cloud.imgKnown.delete(id);
    }
    const json = JSON.stringify(d);
    if (json.length > 250000) { const e = new Error('データが大きすぎます'); e.code = 'too_large'; throw e; }
    cloud.lastPushedAt = d.meta.savedAt;
    await cloud.db.doc(DOC_MAIN).set({ json, savedAt: d.meta.savedAt || '' });
  }

  function handleCloudError(e) {
    const code = e && e.code;
    if (code === 'invalid_argument') setState('readonly');
    else if (code === 'too_large') setState('error', 'データが大きすぎます。画像を減らしてください');
    else if (code === 'quota_exceeded') setState('error', '保存できる量の上限です');
    else if (code === 'revoked' || code === 'not_granted' || code === 'capability_disabled' || code === 'capability_removed') { cloud.db = null; setState('local'); }
    else setState('error', '通信エラー');
  }

  function queueCloud() {
    if (!cloud.db || cloud.state === 'readonly') return;
    clearTimeout(cloud.timer);
    setState('saving');
    cloud.timer = setTimeout(runPush, 1200);
  }

  async function runPush() {
    if (cloud.pushing) { cloud.pending = true; return; }
    cloud.pushing = true;
    try {
      await pushNow();
      setState('synced');
    } catch (e) {
      if (e && e.code === 'unavailable') {
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
        try { await pushNow(); setState('synced'); } catch (e2) { handleCloudError(e2); }
      } else handleCloudError(e);
    }
    cloud.pushing = false;
    if (cloud.pending) { cloud.pending = false; runPush(); }
  }

  async function initCloud() {
    const c = typeof window !== 'undefined' ? window.claude : null;
    if (!c || typeof c.use !== 'function') { setState('local'); return; }
    setState('connecting');
    let db = null;
    try { db = await c.use('db'); } catch (e) { db = null; }
    if (!db) { setState('local'); return; }
    cloud.db = db;
    try {
      const remote = await readRemote();
      const local = load();
      if (remote && (local.source === 'default' || ts(remote.meta.savedAt) >= ts(local.savedAt))) {
        applyRemote(remote, 'initial');
        setState('synced');
      } else if (local.source === 'custom') {
        // この端末の方が新しい (またはクラウドが空) → アップロード
        memJson = JSON.stringify(local.data);
        await pushNow();
        setState('synced');
      } else {
        setState('synced');
      }
    } catch (e) { handleCloudError(e); }
    subscribe();
  }

  function subscribe() {
    if (!cloud.db) return;
    try {
      cloud.db.doc(DOC_MAIN).onSnapshot(async (snap) => {
        if (!snap.exists || snap.metadata.hasPendingWrites) return;
        const body = snap.data() || {};
        if (!body.savedAt || body.savedAt === cloud.lastPushedAt) return;
        if (ts(body.savedAt) <= ts(load().savedAt)) return;
        try {
          const d = await readRemote();
          if (d) applyRemote(d, 'remote');
        } catch (e) { /* 次の通知で再挑戦 */ }
      }, (e) => handleCloudError(e));
    } catch (e) { /* noop */ }
  }

  // ===================== ファイル =====================
  async function download(data, filename) {
    filename = filename || 'roulette-battle-data.json';
    const text = JSON.stringify(data, null, 2);
    const c = typeof window !== 'undefined' ? window.claude : null;
    if (c && typeof c.use === 'function') {
      let dl = null;
      try { dl = await c.use('downloads'); } catch (e) { dl = null; }
      if (dl) {
        try { await dl.save({ filename, data: text }); return 'saved'; }
        catch (e) { return e && e.code === 'declined' ? 'declined' : 'failed'; }
      }
      return 'unavailable';
    }
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return 'saved';
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => { try { resolve(normalize(JSON.parse(r.result))); } catch (e) { reject(new Error('JSON として読めません: ' + e.message)); } };
      r.onerror = () => reject(r.error);
      r.readAsText(file, 'utf-8');
    });
  }

  function parseText(text) {
    try { return normalize(JSON.parse(text)); }
    catch (e) { throw new Error('JSON として読めません: ' + e.message); }
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // キャラのアイコン (画像があれば img、なければ絵文字)
  function iconHTML(ch, cls) {
    if (ch && ch.image && ch.image !== '@cloud') return `<img class="${cls || 'ico'}" src="${esc(ch.image)}" alt="">`;
    return `<span class="${cls || 'ico'}">${esc((ch && ch.icon) || '❔')}</span>`;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  return {
    KEY, load, save, clearLocal, clearMemory, download, readFile, parseText, normalize, fmtDate, iconHTML, esc,
    onChange, initCloud, statusLabel, get cloudState() { return cloud.state; },
  };
})();
