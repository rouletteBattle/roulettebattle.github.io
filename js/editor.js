/* ルーレットバトル エディタ (つくる): キャラ・技・特性・状態異常・属性・タイプ・ルールの編集 */
var RBEditor = (function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = RBStore.esc;
  const num = RB.num, has = RB.has;

  let D, IDX;
  let inited = false;
  let tab = 'chars';
  const sel = {};
  let filter = '';
  let saveTimer = null;
  let lastEdit = 0;

  // ===================== DOM ヘルパ =====================
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el[k] = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    return el;
  }
  function field(label, input, opts) {
    opts = opts || {};
    return h('label', { class: 'f' + (opts.wide ? ' wide' : '') + (opts.inline ? ' inline' : ''), title: opts.title || null },
      opts.inline ? input : h('span', {}, label), opts.inline ? h('span', {}, label) : input, opts.hint ? h('div', { class: 'hint' }, opts.hint) : null);
  }
  function setVal(obj, key, v, keepEmpty) {
    if ((v === '' || v == null) && !keepEmpty) delete obj[key]; else obj[key] = v;
  }
  function fText(obj, key, label, opts) {
    opts = opts || {};
    const i = h('input', { type: 'text', value: obj[key] == null ? '' : obj[key], placeholder: opts.placeholder || null });
    i.oninput = () => { setVal(obj, key, i.value, opts.keepEmpty); changed(opts); };
    return field(label, i, opts);
  }
  function fArea(obj, key, label, opts) {
    opts = opts || {};
    const i = h('textarea', { rows: opts.rows || 2, placeholder: opts.placeholder || null });
    i.value = obj[key] || '';
    i.oninput = () => { setVal(obj, key, i.value); changed(opts); };
    return field(label, i, Object.assign({ wide: true }, opts));
  }
  function fNum(obj, key, label, opts) {
    opts = opts || {};
    const i = h('input', { type: 'number', inputmode: 'decimal', value: has(obj[key]) ? obj[key] : '', placeholder: opts.placeholder != null ? opts.placeholder : '', step: opts.step || 'any', min: opts.min != null ? opts.min : null });
    i.oninput = () => { if (i.value === '') { if (opts.keepEmpty) obj[key] = 0; else delete obj[key]; } else obj[key] = +i.value; changed(opts); };
    return field(label, i, opts);
  }
  function fSel(obj, key, label, options, opts) {
    opts = opts || {};
    const s = h('select', {});
    if (opts.blank != null) s.appendChild(h('option', { value: '' }, opts.blank));
    for (const [v, l] of options) s.appendChild(h('option', { value: v, selected: String(obj[key] == null ? '' : obj[key]) === String(v) }, l));
    if (opts.blank == null && !has(obj[key]) && options.length && !opts.noDefault) obj[key] = options[0][0];
    s.onchange = () => { setVal(obj, key, s.value); changed(opts); };
    return field(label, s, opts);
  }
  function fBool(obj, key, label, opts) {
    opts = opts || {};
    const i = h('input', { type: 'checkbox', checked: !!obj[key] });
    i.onchange = () => { if (i.checked) obj[key] = true; else delete obj[key]; changed(opts); };
    return field(label, i, Object.assign({ inline: true }, opts));
  }
  function fColor(obj, key, label, opts) {
    opts = opts || {};
    const c = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(obj[key] || '') ? obj[key] : (opts.fallback || '#888888'), class: 'colorpick' });
    const t = h('input', { type: 'text', value: obj[key] || '', placeholder: opts.placeholder || '#rrggbb', style: 'flex:1;min-width:0' });
    c.oninput = () => { obj[key] = c.value; t.value = c.value; changed(opts); };
    t.oninput = () => { setVal(obj, key, t.value.trim()); if (/^#[0-9a-f]{6}$/i.test(t.value.trim())) c.value = t.value.trim(); changed(opts); };
    return field(label, h('div', { class: 'row', style: 'gap:4px;flex-wrap:nowrap' }, c, t), opts);
  }
  // { 属性ID: 追加威力 } のような表を編集する
  function fBonus(obj, key, label, items, opts) {
    opts = opts || {};
    const map = Object.assign({}, obj[key] || {});
    const sync = () => {
      for (const k of Object.keys(map)) if (!has(map[k]) || num(map[k]) === 0) delete map[k];
      if (Object.keys(map).length) obj[key] = Object.assign({}, map); else delete obj[key];
    };
    const grid = h('div', { class: 'bonus-grid' }, items.map(([id, lbl]) => {
      const i = h('input', { type: 'number', inputmode: 'decimal', value: has(map[id]) ? map[id] : '', placeholder: '0', step: 'any' });
      i.oninput = () => { if (i.value === '') delete map[id]; else map[id] = +i.value; sync(); changed(opts); };
      return h('label', { class: 'bonus-cell' }, h('span', {}, lbl), i);
    }));
    return h('div', { class: 'f wide' }, h('span', {}, label), grid, opts.hint ? h('div', { class: 'hint' }, opts.hint) : null);
  }

  const markItems = () => [['dot', D.rules.dotLabel || '●'], ['star', D.rules.starLabel || '★']];
  const opts = {
    elements: () => D.elements.map(e => [e.id, `${e.icon || ''} ${e.name}`]),
    types: () => D.types.map(t => [t.id, t.name]),
    statuses: () => D.statuses.map(s => [s.id, `${s.icon || ''} ${s.name}`]),
    chars: () => D.chars.map(c => [c.id, `${c.icon || ''} ${c.name}${c.hidden ? ' (選べない)' : ''}`]),
    gears: () => (D.gears || []).map(x => [x.id, `${x.icon || ''} ${x.name}${x.kind === 'bad' ? ' (悪)' : ''}`]),
    moves: () => D.moves.map(m => [m.id, `${m.name} (${(RB.MOVE_KINDS[m.kind || 'attack'] || {}).name}${(m.kind || 'attack') === 'attack' ? ' ' + num(m.power) : ''})`]),
    kinds: () => Object.entries(RB.MOVE_KINDS).map(([k, v]) => [k, v.name]),
    targets: () => Object.entries(RB.MOVE_TARGETS),
    to: () => Object.entries(RB.EFFECT_TO),
    stats: () => Object.entries(RB.MOD_STATS).map(([k, v]) => [k, v.name]),
    triggers: () => Object.entries(RB.TRIGGERS),
    marks: markItems,
  };

  // ===================== 保存 =====================
  function changed(o) {
    IDX = RB.index(D);
    lastEdit = Date.now();
    clearTimeout(saveTimer);
    $('#edSavedInd').textContent = '編集中…';
    saveTimer = setTimeout(doSave, 350);
    if (o && o.list) renderList();
    if (o && o.rerender) renderForm();
    if (o && o.after) o.after();
  }
  function doSave() {
    saveTimer = null;
    const ok = RBStore.save(D);
    $('#edSavedInd').textContent = ok ? '✔ 保存しました ' + RBStore.fmtDate(D.meta.savedAt).slice(11) : '✔ 保存しました (このページを閉じると消える可能性があります)';
    updateWarn();
  }
  function updateWarn() {
    const w = RB.validate(D);
    const b = $('#edWarnBtn');
    b.hidden = !w.length;
    b.textContent = `⚠ 問題 ${w.length}件`;
    b.onclick = () => showModal('データの問題', h('ul', {}, w.map(x => h('li', {}, x))));
  }
  function showModal(title, content) {
    const m = $('#edModal');
    m.innerHTML = '';
    const close = h('button', { type: 'button', class: 'close icon', 'aria-label': '閉じる', onclick: () => { m.hidden = true; } }, '✕');
    m.appendChild(h('div', { class: 'panel modal' }, close, h('h3', { style: 'margin-top:0' }, title), content));
    m.hidden = false;
    m.onclick = (e) => { if (e.target === m) m.hidden = true; };
  }

  // ===================== ID の変更・参照の追従 =====================
  function eachEffectHolder(fn) {
    for (const m of D.moves) { fn(m); for (const e of (m.effects || [])) fn(e); }
    for (const a of D.abilities) { for (const e of (a.effects || [])) fn(e); fn(a); }
  }
  function renameKey(o, key, oldId, newId) {
    if (o && o[key] && oldId in o[key]) { o[key][newId] = o[key][oldId]; delete o[key][oldId]; }
  }
  function renameId(kind, oldId, newId) {
    if (oldId === newId) return;
    const swap = (v) => (v === oldId ? newId : v);
    const swapCond = (e, k) => { if (e.cond && e.cond[k] === oldId) e.cond[k] = newId; };
    if (kind === 'moves') for (const c of D.chars.concat(D.gears || [], D.items || [])) for (const e of (c.moves || [])) e.move = swap(e.move);
    if (kind === 'gears') eachEffectHolder(e => { if (e.type === 'attachGear' && e.gear === oldId) e.gear = newId; });
    if (kind === 'abilities') for (const c of D.chars) c.abilities = c.abilities.map(swap);
    if (kind === 'chars') eachEffectHolder(e => { if (e.type === 'transform' && e.char === oldId) e.char = newId; });
    if (kind === 'types') {
      for (const c of D.chars) if (c.type === oldId) c.type = newId;
      eachEffectHolder(e => { swapCond(e, 'targetType'); renameKey(e, 'typeBonus', oldId, newId); if (e.groupType === oldId) e.groupType = newId; });
    }
    if (kind === 'statuses') {
      eachEffectHolder(e => { if (e.status === oldId) e.status = newId; swapCond(e, 'targetStatus'); swapCond(e, 'selfStatus'); });
      for (const a of D.abilities) if (a.passive && a.passive.immune) a.passive.immune = a.passive.immune.map(swap);
    }
    if (kind === 'elements') {
      for (const c of D.chars) if (c.element === oldId) c.element = newId;
      eachEffectHolder(e => {
        if (e.element === oldId) e.element = newId;
        if (e.groupElement === oldId) e.groupElement = newId;
        swapCond(e, 'targetElement');
        renameKey(e, 'elemBonus', oldId, newId);
      });
      if (D.chart[oldId]) { D.chart[newId] = D.chart[oldId]; delete D.chart[oldId]; }
      for (const row of Object.values(D.chart)) renameKey({ r: row }, 'r', oldId, newId);
      for (const a of D.abilities) if (a.passive) renameKey(a.passive, 'resist', oldId, newId);
    }
  }
  function fId(kind, obj) {
    const i = h('input', { type: 'text', value: obj.id, autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' });
    i.onchange = async () => {
      const v = i.value.trim();
      if (!v || !/^[\w\-]+$/.test(v)) { await RBUI.alert('IDは半角英数字と _ - で入力してください'); i.value = obj.id; return; }
      if (D[kind].some(x => x !== obj && x.id === v)) { await RBUI.alert('そのIDは既に使われています'); i.value = obj.id; return; }
      renameId(kind, obj.id, v);
      obj.id = v; sel[kind] = v;
      changed({ list: true });
    };
    return field('ID (内部用・半角)', i, { hint: '変更すると参照先も自動で書き換わります' });
  }

  // ===================== タブ定義 =====================
  const TABS = {
    chars:     { label: '👤 キャラ', list: true, prefix: 'c', create: () => ({ name: '新しいキャラ', icon: '🙂', element: (D.elements[0] || {}).id, type: (D.types[0] || {}).id, mark: 'dot', speed: 3, baseHp: 100, abilities: [], moves: [{ move: 'miss', weight: 4 }], desc: '' }), form: formChar, row: c => [RBStore.iconHTML(c), c.name + (c.hidden ? ' (進化後)' : ''), `${RB.markLabel(D, c.mark)}${(IDX.elements[c.element] || {}).icon || ''}`] },
    moves:     { label: '🎯 技', list: true, prefix: 'm', create: () => ({ name: '新しい技', kind: 'attack', power: 30, target: 'single', effects: [] }), form: formMove, row: m => [`<span class="sw" style="background:${esc(m.color || (RB.MOVE_KINDS[m.kind || 'attack'] || {}).color)}"></span>`, m.name, ((m.kind || 'attack') === 'attack' ? String(num(m.power)) : (RB.MOVE_KINDS[m.kind] || {}).name) + (['allEnemies', 'group', 'everyone'].includes(m.target) ? ' 全' : '')] },
    abilities: { label: '✨ 特性', list: true, prefix: 'a', create: () => ({ name: '新しい特性', trigger: 'turnStart', effects: [], desc: '' }), form: formAbility, row: a => ['✨', a.name, (RB.TRIGGERS[a.trigger] || '').replace(/時$/, '')] },
    statuses:  { label: '💫 状態異常', list: true, prefix: 's', create: () => ({ name: '新しい状態異常', icon: '❓', color: '#cccccc', turns: 2 }), form: formStatus, row: s => [`<span class="sw" style="background:${esc(s.color || '#ccc')}"></span>`, `${s.icon || ''} ${s.name}`, ''] },
    gears:     { label: '⚙ ギア', list: true, prefix: 'g', create: () => ({ name: '新しいギア', icon: '⚙', color: '#9fb4c8', kind: 'good', turns: 0, moves: [{ move: 'miss', weight: 2 }], desc: '' }), form: formGear, row: x => [x.icon || '⚙', x.name, x.kind === 'bad' ? '悪' : '良'] },
    items:     { label: '🃏 きりふだ', list: true, prefix: 'k', create: () => ({ name: '新しいきりふだ', icon: '🃏', color: '#ffcf3a', moves: [], desc: '' }), form: formItem, row: x => [x.icon || '🃏', x.name, ''] },
    elements:  { label: '🔥 属性', list: true, prefix: 'e', create: () => ({ name: '新属性', icon: '⭐', color: '#aaaaaa' }), form: formElement, row: e => [`<span class="sw" style="background:${esc(e.color || '#ccc')}"></span>`, `${e.icon || ''} ${e.name}`, ''] },
    types:     { label: '🏷 タイプ', list: true, prefix: 't', create: () => ({ name: '新しいタイプ', desc: '' }), form: formType, row: t => ['🏷', t.name, ''] },
    rules:     { label: '📜 ルール', list: false, form: formRules },
    data:      { label: '💾 データ', list: false, form: formData },
  };

  function showDetail(on) { $('#edBody').classList.toggle('m-detail', !!on); if (on) window.scrollTo(0, 0); }

  function renderTabs() {
    const box = $('#edTabs');
    box.innerHTML = '';
    for (const [k, t] of Object.entries(TABS)) {
      box.appendChild(h('button', { type: 'button', class: tab === k ? 'on' : '', onclick: () => { tab = k; filter = ''; showDetail(false); renderAll(); try { localStorage.setItem('rouletteBattle.edTab', k); } catch (e) { /* noop */ } } }, t.label + (t.list ? ` (${D[k].length})` : '')));
    }
    const on = box.querySelector('.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function current() {
    const arr = D[tab];
    if (!arr || !TABS[tab].list) return null;
    let it = arr.find(x => x.id === sel[tab]);
    if (!it && arr.length) { it = arr[0]; sel[tab] = it.id; }
    return it || null;
  }

  function renderList() {
    const t = TABS[tab];
    const box = $('#edList');
    $('#edBody').classList.toggle('full', !t.list);
    box.hidden = !t.list;
    renderTabs();
    if (!t.list) return;
    const arr = D[tab];
    const cur = current();
    box.innerHTML = '';
    const search = h('input', { type: 'text', placeholder: '🔍 名前で絞り込み', value: filter, style: 'width:100%;margin-bottom:8px', 'aria-label': '名前で絞り込み' });
    search.oninput = () => { filter = search.value; renderItems(); };
    box.appendChild(search);
    box.appendChild(h('div', { class: 'row list-tools' },
      h('button', { type: 'button', class: 'small primary', onclick: () => addItem() }, '＋ 新規'),
      h('button', { type: 'button', class: 'small', onclick: () => dupItem(), disabled: !cur }, '複製'),
      h('button', { type: 'button', class: 'small danger', onclick: () => delItem(), disabled: !cur }, '削除'),
      h('div', { class: 'grow' }),
      h('button', { type: 'button', class: 'small icon', title: '上へ', 'aria-label': '上へ', onclick: () => moveItem(-1), disabled: !cur }, '↑'),
      h('button', { type: 'button', class: 'small icon', title: '下へ', 'aria-label': '下へ', onclick: () => moveItem(1), disabled: !cur }, '↓')));
    const items = h('div', {});
    box.appendChild(items);
    function renderItems() {
      items.innerHTML = '';
      for (const x of arr) {
        if (filter && !String(x.name || '').includes(filter) && !String(x.id).includes(filter)) continue;
        const [ic, name, extra] = t.row(x);
        const it = h('button', { type: 'button', class: 'item' + (cur && x.id === cur.id ? ' on' : ''), html: `${ic.startsWith('<') ? ic : `<span class="ico">${esc(ic)}</span>`}<span class="nm">${esc(name)}</span><span class="dim ex">${esc(extra || '')}</span><span class="chev">›</span>` });
        it.onclick = () => { sel[tab] = x.id; showDetail(true); renderList(); renderForm(); };
        items.appendChild(it);
      }
    }
    renderItems();
  }

  function newId(prefix) {
    let id;
    do { id = prefix + '_' + Math.random().toString(36).slice(2, 7); } while (D[tab].some(x => x.id === id));
    return id;
  }
  function addItem(obj) {
    const t = TABS[tab];
    const x = obj || t.create();
    x.id = newId(t.prefix);
    const cur = current();
    const at = cur ? D[tab].indexOf(cur) + 1 : D[tab].length;
    D[tab].splice(at, 0, x);
    sel[tab] = x.id;
    changed({ list: true });
    showDetail(true);
    renderForm();
    return x;
  }
  function dupItem() {
    const cur = current(); if (!cur) return;
    const x = RB.clone(cur);
    x.name = (x.name || '') + ' のコピー';
    addItem(x);
  }
  async function delItem() {
    const cur = current(); if (!cur) return;
    const refs = RB.references(D, tab, cur.id);
    const msg = refs.length ? `「${cur.name}」は次の場所で使われています:\n${refs.slice(0, 12).join('\n')}${refs.length > 12 ? '\n…' : ''}\n\n削除すると参照が外れます。` : `「${cur.name}」を削除します。`;
    if (!(await RBUI.confirm(msg, { ok: '削除する', danger: true }))) return;
    const i = D[tab].indexOf(cur);
    if (i < 0) return;
    D[tab].splice(i, 1);
    if (tab === 'moves') for (const c of D.chars.concat(D.gears || [], D.items || [])) c.moves = (c.moves || []).filter(e => e.move !== cur.id);
    if (tab === 'abilities') for (const c of D.chars) c.abilities = c.abilities.filter(a => a !== cur.id);
    if (tab === 'elements') { delete D.chart[cur.id]; for (const r of Object.values(D.chart)) delete r[cur.id]; }
    const nx = D[tab][Math.min(i, D[tab].length - 1)];
    sel[tab] = nx ? nx.id : null;
    changed({ list: true });
    showDetail(false);
    renderForm();
    RBUI.toast('削除しました');
  }
  function moveItem(d) {
    const cur = current(); if (!cur) return;
    const arr = D[tab], i = arr.indexOf(cur), j = i + d;
    if (j < 0 || j >= arr.length) return;
    arr.splice(i, 1); arr.splice(j, 0, cur);
    changed({ list: true });
  }
  function jump(t, id) { tab = t; if (id) sel[t] = id; showDetail(true); renderAll(); }

  function renderForm() {
    const box = $('#edForm');
    box.innerHTML = '';
    const t = TABS[tab];
    if (t.list) {
      box.appendChild(h('button', { type: 'button', class: 'm-back', onclick: () => { showDetail(false); renderList(); } }, '‹ ' + t.label.replace(/^\S+ /, '') + 'の一覧'));
      const cur = current();
      if (!cur) { box.appendChild(h('div', { class: 'dim' }, 'まだありません。「＋ 新規」で作成してください。')); return; }
      t.form(box, cur);
    } else t.form(box);
  }
  function renderAll() { renderList(); renderForm(); }

  // ===================== 効果エディタ =====================
  function condEditor(holder) {
    const c = holder.cond || {};
    const wrap = h('div', { class: 'eparams' });
    const sync = () => { if (Object.keys(c).length) holder.cond = c; else delete holder.cond; };
    for (const [key, label, kind] of RB.CONDS) {
      let el;
      if (kind === 'num') el = fNum(c, key, label, { after: sync });
      else if (kind === 'bool') el = fBool(c, key, label, { after: sync });
      else if (kind === 'element') el = fSel(c, key, label, opts.elements(), { blank: '(指定なし)', after: sync });
      else if (kind === 'type') el = fSel(c, key, label, opts.types(), { blank: '(指定なし)', after: sync });
      else if (kind === 'mark') el = fSel(c, key, label, opts.marks(), { blank: '(指定なし)', after: sync });
      else if (kind === 'statusAny') el = fSel(c, key, label, [['any', '何かの状態異常'], ['none', '状態異常なし']].concat(opts.statuses()), { blank: '(指定なし)', after: sync });
      else if (kind === 'moveKind') el = fSel(c, key, label, opts.kinds(), { blank: '(指定なし)', after: sync });
      if (el) wrap.appendChild(el);
    }
    return wrap;
  }

  function paramField(e, key, label, kind, o) {
    switch (kind) {
      case 'num': return fNum(e, key, label, o);
      case 'bool': return fBool(e, key, label, o);
      case 'element': return fSel(e, key, label, opts.elements(), Object.assign({ blank: '(キャラの属性)' }, o));
      case 'status': return fSel(e, key, label, opts.statuses(), Object.assign(e.type === 'status' ? {} : { blank: '(すべて)' }, o));
      case 'stat': return fSel(e, key, label, opts.stats(), o);
      case 'clearWhich': return fSel(e, key, label, Object.entries(RB.CLEAR_WHICH), o);
      case 'hpChaos': return fSel(e, key, label, Object.entries(RB.HP_CHAOS), o);
      case 'randomPool': return fSel(e, key, label, Object.entries(RB.RANDOM_POOL), o);
      case 'scaleBy': return fSel(e, key, label, Object.entries(RB.SCALE_BY), Object.assign({ blank: '(増えない)' }, o));
      case 'char': return fSel(e, key, label, opts.chars(), o);
      case 'gear': return fSel(e, key, label, opts.gears(), Object.assign({ blank: '(候補からランダム)' }, o));
      case 'gearPool': return fSel(e, key, label, Object.entries(RB.GEAR_POOL), o);
      case 'markBonus': return fBonus(e, key, label, opts.marks(), o);
      case 'elemBonus': return fBonus(e, key, label, opts.elements(), o);
      case 'typeBonus': return fBonus(e, key, label, opts.types(), o);
    }
    return null;
  }

  function effectsEditor(arr, onChange, ctx) {
    ctx = ctx || {};
    const box = h('div', {});
    const notify = () => { if (onChange) onChange(); };
    function render() {
      box.innerHTML = '';
      arr.forEach((e, i) => {
        const summary = h('div', { class: 'summary' });
        const upd = () => { summary.textContent = '→ ' + RB.describeEffect(e, D); notify(); };
        const typeSel = h('select', { 'aria-label': '効果の種類' }, Object.entries(RB.EFFECTS).map(([k, v]) => h('option', { value: k, selected: e.type === k }, v.name)));
        typeSel.onchange = () => {
          const keep = { type: typeSel.value, to: e.to, chance: e.chance, cond: e.cond, link: e.link };
          for (const k of Object.keys(e)) delete e[k];
          Object.assign(e, keep);
          for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
          if (e.type === 'mod' && !e.stat) { e.stat = 'atkFlat'; e.value = 10; e.turns = 2; }
          if (e.type === 'damage' && !has(e.power)) e.power = 20;
          if (e.type === 'heal' && !has(e.amount)) e.amount = 20;
          if (e.type === 'status' && !e.status && D.statuses[0]) e.status = D.statuses[0].id;
          if (e.type === 'transform' && !e.char && D.chars[0]) { e.char = D.chars[0].id; e.to = 'self'; }
          changed({}); render(); notify();
        };
        const toSel = h('select', { title: '対象', 'aria-label': '対象' }, opts.to().map(([k, v]) => h('option', { value: k, selected: (e.to || 'target') === k }, v)));
        toSel.onchange = () => { if (toSel.value === 'target') delete e.to; else e.to = toSel.value; changed({}); upd(); };
        const chance = h('input', { type: 'number', inputmode: 'decimal', min: 0, max: 100, value: has(e.chance) ? e.chance : '', placeholder: '100', class: 'chance', title: '発動確率%', 'aria-label': '発動確率%' });
        chance.oninput = () => { if (chance.value === '') delete e.chance; else e.chance = +chance.value; changed({}); upd(); };
        const linkSel = h('select', { title: '直前の効果との関係', 'aria-label': '直前の効果との関係' }, Object.entries(RB.EFFECT_LINK).map(([k, v]) => h('option', { value: k, selected: (e.link || '') === k }, v)));
        linkSel.onchange = () => { if (!linkSel.value) delete e.link; else e.link = linkSel.value; changed({}); upd(); };
        const btn = (lbl, fn, title) => h('button', { type: 'button', class: 'small icon', title, 'aria-label': title, onclick: fn }, lbl);
        const spec = RB.EFFECTS[e.type] || { params: [] };
        const head = h('div', { class: 'ehead' },
          h('b', { class: 'dim' }, `#${i + 1}`), typeSel,
          !spec.once ? h('span', { class: 'dim' }, '対象') : null, !spec.once ? toSel : null,
          h('span', { class: 'dim' }, '確率%'), chance,
          h('div', { class: 'grow' }),
          btn('↑', () => { if (i > 0) { arr.splice(i - 1, 0, arr.splice(i, 1)[0]); changed({}); render(); notify(); } }, '上へ'),
          btn('↓', () => { if (i < arr.length - 1) { arr.splice(i + 1, 0, arr.splice(i, 1)[0]); changed({}); render(); notify(); } }, '下へ'),
          btn('✕', () => { arr.splice(i, 1); changed({}); render(); notify(); }, '削除'));
        const params = h('div', { class: 'eparams' });
        for (const [key, label, kind] of spec.params) { const el = paramField(e, key, label, kind, { after: upd }); if (el) params.appendChild(el); }
        const nCond = e.cond ? Object.keys(e.cond).length : 0;
        const det = h('details', { open: nCond > 0 || e.link ? true : null }, h('summary', {}, `条件 ${nCond ? `(${nCond})` : '(なし = 常に発動)'}${e.link ? ' ・ ' + RB.EFFECT_LINK[e.link] : ''}`));
        const fillDet = () => {
          if (det.querySelector('.eparams')) return;
          det.appendChild(h('div', { class: 'f', style: 'margin:6px 0' }, h('span', {}, '直前の効果との関係 (ギャンブル技などに)'), linkSel));
          const ce = condEditor(e);
          ce.addEventListener('input', () => setTimeout(upd));
          ce.addEventListener('change', () => setTimeout(upd));
          det.appendChild(ce);
        };
        det.addEventListener('toggle', () => { if (det.open) fillDet(); });
        if (det.open) fillDet();
        box.appendChild(h('div', { class: 'eff' }, head, spec.params.length ? params : null, det, summary));
        summary.textContent = '→ ' + RB.describeEffect(e, D);
      });
      const presets = h('select', { class: 'preset-sel', 'aria-label': '効果を追加' }, h('option', { value: '' }, '＋ 効果を追加…'),
        Object.entries(EFFECT_PRESETS).map(([k, p]) => h('option', { value: k }, p.label)));
      presets.onchange = () => {
        const p = EFFECT_PRESETS[presets.value]; if (!p) return;
        const es = RB.clone(Array.isArray(p.e) ? p.e : [p.e]);
        for (const e of es) {
          if (e.type === 'status' && !e.status && D.statuses[0]) e.status = D.statuses[0].id;
          if (e.type === 'transform' && !e.char && D.chars[0]) e.char = D.chars[0].id;
          if (ctx.defaultTo && !e.to && !(RB.EFFECTS[e.type] || {}).once) e.to = ctx.defaultTo;
          arr.push(e);
        }
        changed({}); render(); notify();
      };
      box.appendChild(h('div', { class: 'row' }, presets, h('span', { class: 'dim', style: 'font-size:12px' }, '効果は上から順に処理されます')));
    }
    render();
    return box;
  }

  const EFFECT_PRESETS = {
    dmg:       { label: 'ダメージ (相手)', e: { type: 'damage', power: 20 } },
    selfdmg:   { label: '自分にダメージ (代償)', e: { type: 'damage', to: 'self', power: 10 } },
    heal:      { label: 'HP回復 (自分)', e: { type: 'heal', to: 'self', amount: 20 } },
    status:    { label: '状態異常にする (相手)', e: { type: 'status' } },
    cure:      { label: '状態異常を治す (自分)', e: { type: 'cure', to: 'self' } },
    atkup:     { label: '攻撃力アップ (自分)', e: { type: 'mod', to: 'self', stat: 'atkFlat', value: 10, turns: 2 } },
    gearGood:  { label: '良いギアをつける (自分)', e: { type: 'attachGear', to: 'self', pool: 'good' } },
    gearBad:   { label: '悪いギアをつける (相手)', e: { type: 'attachGear', pool: 'bad' } },
    gearOff:   { label: 'ギアを外す (相手)', e: { type: 'removeGear' } },
    charge:    { label: 'ためる: 次の攻撃の威力+40 (自分)', e: { type: 'mod', to: 'self', stat: 'nextPower', value: 40, turns: 0 } },
    atkdown:   { label: '攻撃力ダウン (相手)', e: { type: 'mod', stat: 'atkPct', value: -30, turns: 2 } },
    barrier:   { label: 'バリア (自分)', e: { type: 'mod', to: 'self', stat: 'barrier', value: 30, turns: 3 } },
    nullify:   { label: '一定以下のダメージ無効 (自分)', e: { type: 'mod', to: 'self', stat: 'nullifyBelow', value: 20, turns: 2 } },
    guard:     { label: '攻撃を1回無効 (自分)', e: { type: 'mod', to: 'self', stat: 'guard', value: 1, turns: 2 } },
    reflect:   { label: '反射 (自分)', e: { type: 'mod', to: 'self', stat: 'reflectPct', value: 50, turns: 2 } },
    twice:     { label: '2回行動 (自分・次のターンから)', e: { type: 'mod', to: 'self', stat: 'extraSpins', value: 1, turns: 2 } },
    luck:      { label: 'ミス回避🍀 (自分)', e: { type: 'mod', to: 'self', stat: 'luck', value: 1, turns: 0 } },
    vuln:      { label: '被ダメージ増加 (相手)', e: { type: 'mod', stat: 'dmgTakenPct', value: 30, turns: 2 } },
    clear:     { label: 'バフ解除 (相手)', e: { type: 'clearMods', which: 'buffs' } },
    invert:    { label: 'あべこべ (相手のバフ⇔デバフ)', e: { type: 'invertMods' } },
    steal:     { label: 'バフを奪う (相手から)', e: { type: 'stealMods' } },
    pass:      { label: '状態異常を押し付ける (相手へ)', e: { type: 'transferStatus' } },
    swap:      { label: 'HP割合を入れ替える (相手と)', e: { type: 'hpSwap' } },
    chaos:     { label: '大波乱: 全員のHPシャッフル', e: { type: 'hpChaos', mode: 'shuffle' } },
    random:    { label: 'ランダムな技を使う (何が出るかお楽しみ)', e: { type: 'randomMove', pool: 'all' } },
    mimic:     { label: 'まねる (相手が最後に使った技)', e: { type: 'mimic' } },
    evolve:    { label: '進化する (キャラが変わる)', e: { type: 'transform', to: 'self' } },
    gamble:    { label: 'ギャンブル: 50%で大ダメージ / 外れたら自分に', e: [{ type: 'damage', power: 80, chance: 50 }, { type: 'damage', to: 'self', power: 30, link: 'else' }] },
    again:     { label: 'もう一回ルーレット', e: { type: 'spinAgain' } },
  };

  // ===================== キャラ =====================
  function formChar(box, c) {
    const head = h('h2', { html: `${RBStore.iconHTML(c)} ${esc(c.name)}` });
    box.appendChild(head);
    const upHead = () => { head.innerHTML = `${RBStore.iconHTML(c)} ${esc(c.name)}`; };
    box.appendChild(h('div', { class: 'fgrid' },
      fText(c, 'name', '名前', { list: true, after: upHead, keepEmpty: true }),
      fId('chars', c),
      fText(c, 'icon', 'アイコン (絵文字)', { list: true, after: upHead }),
      imageField(c, upHead),
      fColor(c, 'color', 'テーマ色', {}),
      fSel(c, 'element', '属性', opts.elements(), { list: true, after: () => updPrev() }),
      fSel(c, 'type', 'タイプ', opts.types(), { blank: '(なし)', after: () => updPrev() }),
      fSel(c, 'mark', '● / ★', opts.marks(), { blank: '(なし)', list: true, hint: '「●の敵全員に30」などで狙われる印' }),
      fNum(c, 'speed', 'すばやさ', { hint: '大きいほど先に行動 (同じならランダム)', keepEmpty: true }),
      fNum(c, 'baseHp', '基本HP (2人対戦時)', { min: 1, keepEmpty: true, after: () => updPrev() }),
      fBool(c, 'hidden', 'セットアップで選べない (進化後の姿など)', { list: true }),
      fArea(c, 'desc', '説明', {})));

    // 特性
    const abSec = h('div', { class: 'sec' }, h('h3', {}, '特性', h('button', { type: 'button', class: 'small', onclick: () => { tab = 'abilities'; const a = addItem(); c.abilities.push(a.id); changed({}); renderAll(); } }, '＋ 新しい特性を作ってつける')));
    const checks = h('div', { class: 'checks' });
    for (const a of D.abilities) {
      const cb = h('input', { type: 'checkbox', checked: c.abilities.includes(a.id) });
      cb.onchange = () => { if (cb.checked) c.abilities.push(a.id); else c.abilities = c.abilities.filter(x => x !== a.id); changed({}); updPrev(); };
      checks.appendChild(h('label', { title: a.desc || RB.describeAbility(a, D) }, cb, a.name));
    }
    abSec.appendChild(checks);
    const abDesc = h('div', { class: 'auto-desc', style: 'margin-top:6px' });
    abSec.appendChild(abDesc);
    box.appendChild(abSec);

    // ルーレット
    rouletteSection(box, c, (segs) => {
      const st = RB.wheelStats(D, c);
      const type = IDX.types[c.type];
      const passive = RB.passiveOf(IDX, c);
      const hpAt = (n) => Math.round(num(c.baseHp, 100) * RB.hpMultiplier(D.rules, n) * (1 + passive.hpPct / 100));
      const aoe = segs.some(s => ['allEnemies', 'group', 'everyone'].includes(s.move.target));
      abDesc.innerHTML = c.abilities.map(a => IDX.abilities[a]).filter(Boolean).map(a => `<div><b>${esc(a.name)}</b>: ${esc(RB.describeAbility(a, D))}</div>`).join('');
      return `期待ダメージ/回 <b>${st.expected.toFixed(1)}</b> (補正前) ・ ミス率 <b>${(st.missRate * 100).toFixed(0)}%</b><br>全体攻撃: ${aoe ? 'あり' : '<b style="color:var(--bad)">なし</b>'}<br>HP: 2人 ${hpAt(2)} / 4人 ${hpAt(4)} / 10人 ${hpAt(10)}${type ? `<br>タイプ補正: ${esc(type.desc || type.name)}` : ''}`;
    });
    function updPrev() { if (box._rouletteUpd) box._rouletteUpd(); }
  }

  // ルーレットの表 + プレビュー (キャラ・ギア・きりふだ共通)。holder.moves を編集する
  function rouletteSection(box, holder, statsFn, title) {
    if (!Array.isArray(holder.moves)) holder.moves = [];
    const wSec = h('div', { class: 'sec' }, h('h3', {}, title || 'ルーレット (技と区画の大きさ)'));
    const prevBox = h('div', { class: 'char-preview' });
    const cv = h('canvas', {});
    const stats = h('div', { class: 'dim', style: 'font-size:12px;text-align:center;margin-top:4px' });
    const tableBox = h('div', { style: 'min-width:0' });
    prevBox.appendChild(h('div', { class: 'prev-wheel' }, cv, stats));
    prevBox.appendChild(tableBox);
    wSec.appendChild(prevBox);
    box.appendChild(wSec);
    const wheel = new RBWheel(cv);
    const list = () => holder.moves;
    const totalW = () => list().reduce((a, x) => a + Math.max(0, num(x.weight)), 0) || 1;

    function renderTable() {
      tableBox.innerHTML = '';
      const rows = h('div', { class: 'mrows' }, h('div', { class: 'mrow mhead' }, h('span', { class: 'c-sw' }), h('span', { class: 'c-sel' }, '技'), h('span', { class: 'c-w' }, '大きさ'), h('span', { class: 'c-p' }, '威力(上書き)'), h('span', { class: 'c-pct' }, '確率'), h('span', { class: 'c-btn' })));
      list().forEach((e, i) => {
        const mv = IDX.moves[e.move];
        const color = mv ? (mv.color || (RB.MOVE_KINDS[mv.kind || 'attack'] || {}).color) : '#555';
        const ms = h('select', { 'aria-label': `${i + 1}番目の技` }, opts.moves().map(([v, l]) => h('option', { value: v, selected: v === e.move }, l)));
        if (!mv) ms.prepend(h('option', { value: e.move, selected: true }, `(存在しない技: ${e.move})`));
        ms.onchange = () => { e.move = ms.value; changed({}); renderTable(); upd(); };
        const pctCell = h('span', { class: 'c-pct' }, (Math.max(0, num(e.weight)) / totalW() * 100).toFixed(1) + '%');
        const w = h('input', { type: 'number', inputmode: 'numeric', min: 0, step: 1, value: num(e.weight), 'aria-label': '大きさ' });
        w.oninput = () => { e.weight = +w.value || 0; changed({}); upd(); pctCell.textContent = (Math.max(0, num(e.weight)) / totalW() * 100).toFixed(1) + '%'; };
        const isAtk = mv && (mv.kind || 'attack') === 'attack';
        const pw = h('input', { type: 'number', inputmode: 'decimal', value: has(e.power) ? e.power : '', placeholder: isAtk ? String(num(mv.power)) : '-', disabled: !isAtk, 'aria-label': '威力' });
        pw.oninput = () => { if (pw.value === '') delete e.power; else e.power = +pw.value; changed({}); upd(); };
        const move = (d) => { const j = i + d; if (j < 0 || j >= list().length) return; list().splice(j, 0, list().splice(i, 1)[0]); changed({}); renderTable(); upd(); };
        rows.appendChild(h('div', { class: 'mrow', style: `--sw:${color}` },
          h('span', { class: 'c-sw' }, h('i', { style: `background:${color}` })),
          h('span', { class: 'c-sel' }, ms),
          h('label', { class: 'c-w' }, h('small', { class: 'mlbl' }, '大きさ'), w),
          h('label', { class: 'c-p' }, h('small', { class: 'mlbl' }, '威力'), pw),
          pctCell,
          h('span', { class: 'c-btn' },
            h('button', { type: 'button', class: 'small icon', 'aria-label': '上へ', onclick: () => move(-1) }, '↑'),
            h('button', { type: 'button', class: 'small icon', 'aria-label': '下へ', onclick: () => move(1) }, '↓'),
            h('button', { type: 'button', class: 'small', onclick: () => { if (mv) jump('moves', mv.id); } }, '編集'),
            h('button', { type: 'button', class: 'small icon', 'aria-label': '外す', onclick: () => { list().splice(i, 1); changed({}); renderTable(); upd(); } }, '✕'))));
      });
      tableBox.appendChild(rows);
      tableBox.appendChild(h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { type: 'button', class: 'small', onclick: () => { list().push({ move: (D.moves.find(m => m.kind !== 'miss') || D.moves[0] || {}).id, weight: 4 }); changed({}); renderTable(); upd(); } }, '＋ 技を追加'),
        h('button', { type: 'button', class: 'small', onclick: () => { const back = tab; tab = 'moves'; const m = addItem(); list().push({ move: m.id, weight: 4 }); changed({}); renderAll(); if (back !== 'moves') RBUI.toast('新しい技を作りました。編集が終わったら元のタブに戻ってください'); } }, '＋ 新しい技を作って追加'),
        h('span', { class: 'dim', style: 'font-size:12px' }, `合計 ${list().reduce((a, x) => a + Math.max(0, num(x.weight)), 0)} (大きさの比率で確率が決まります)`)));
    }
    function upd() {
      const segs = RB.buildWheel(IDX, list());
      wheel.setSegments(rbWheelSegments(segs));
      stats.innerHTML = statsFn ? statsFn(segs) : '';
    }
    box._rouletteUpd = upd;
    renderTable();
    requestAnimationFrame(() => { wheel.resize(); upd(); });
  }

  // ===================== ギア =====================
  function formGear(box, gd) {
    box.appendChild(h('h2', {}, `⚙ ${gd.icon || ''} ${gd.name}`));
    box.appendChild(h('div', { class: 'dim', style: 'font-size:13px;margin-bottom:10px' }, 'ギアをつけた人は、キャラのルーレットの後にギアのルーレットも毎ターン自動で回します。1人1つまで。技の効果「ギアをつける」で付けます。'));
    box.appendChild(h('div', { class: 'fgrid' },
      fText(gd, 'name', '名前', { list: true, keepEmpty: true }),
      fId('gears', gd),
      fText(gd, 'icon', 'アイコン (絵文字)', { list: true }),
      fColor(gd, 'color', '色', {}),
      fSel(gd, 'kind', '種類', [['good', '良いギア (自分につける)'], ['bad', '悪いギア (相手につける)']], { list: true }),
      fNum(gd, 'turns', 'つけていられるターン数', { hint: '0 = 外されるまでずっと', keepEmpty: true }),
      fArea(gd, 'desc', '説明', {})));
    rouletteSection(box, gd, () => '毎ターン自動で1回まわる', 'ギアのルーレット');
    const users = D.moves.filter(m => (m.effects || []).some(e => e.type === 'attachGear' && (e.gear === gd.id || (!e.gear && (!e.pool || e.pool === 'any' || e.pool === (gd.kind || 'good'))))));
    box.appendChild(h('div', { class: 'sec' }, h('h3', {}, `このギアをつける技 (${users.length})`),
      h('div', { class: 'row' }, users.map(m => h('button', { type: 'button', class: 'small', onclick: () => jump('moves', m.id) }, m.name)))));
  }

  // ===================== きりふだ =====================
  function formItem(box, it) {
    box.appendChild(h('h2', {}, `🃏 ${it.icon || ''} ${it.name}`));
    box.appendChild(h('div', { class: 'dim', style: 'font-size:13px;margin-bottom:10px' }, '1試合に1回だけ、キャラのルーレットの代わりに回せる切り札です。配り方は「ルール」で変えられます (ランダム / セットアップで選ぶ / 使わない)。'));
    box.appendChild(h('div', { class: 'fgrid' },
      fText(it, 'name', '名前', { list: true, keepEmpty: true }),
      fId('items', it),
      fText(it, 'icon', 'アイコン (絵文字)', { list: true }),
      fColor(it, 'color', '色', {}),
      fArea(it, 'desc', '説明', {})));
    rouletteSection(box, it, () => '1試合に1回だけ使える', 'きりふだのルーレット');
  }

  function imageField(c, after) {
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const prev = h('span', {});
    const up = () => { prev.innerHTML = c.image && c.image !== '@cloud' ? `<img src="${esc(c.image)}" class="img-prev" alt="">` : ''; };
    up();
    file.onchange = () => {
      const f = file.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = () => {
          const S = 128, cv = document.createElement('canvas');
          cv.width = S; cv.height = S;
          const g = cv.getContext('2d');
          const s = Math.max(S / img.width, S / img.height);
          g.drawImage(img, (S - img.width * s) / 2, (S - img.height * s) / 2, img.width * s, img.height * s);
          c.image = cv.toDataURL('image/png');
          up(); changed({ list: true, after });
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(f);
    };
    return field('画像 (任意・絵文字より優先)', h('div', { class: 'row', style: 'gap:4px' }, prev,
      h('button', { type: 'button', class: 'small', onclick: () => file.click() }, '選ぶ'),
      h('button', { type: 'button', class: 'small', onclick: () => { delete c.image; up(); changed({ list: true, after }); } }, '消す'), file), { hint: '128px に縮小して保存します' });
  }

  // ===================== 技 =====================
  function formMove(box, m) {
    const kind = m.kind || 'attack';
    box.appendChild(h('h2', {}, m.name));
    const desc = h('div', { class: 'auto-desc', style: 'margin-bottom:10px' });
    const upd = () => { desc.textContent = '自動説明: ' + RB.describeMove(m, D); };
    box.appendChild(h('div', { class: 'fgrid' },
      fText(m, 'name', '名前', { list: true, keepEmpty: true }),
      fId('moves', m),
      fSel(m, 'kind', '種類 (色・CPU判断に使う)', opts.kinds(), { rerender: true, list: true }),
      fSel(m, 'target', '対象', opts.targets(), { rerender: true, list: true }),
      kind === 'attack' ? fNum(m, 'power', '威力', { list: true, after: upd, keepEmpty: true }) : null,
      fColor(m, 'color', '色 (空=種類の色)', { list: true, fallback: (RB.MOVE_KINDS[kind] || {}).color, placeholder: (RB.MOVE_KINDS[kind] || {}).color })));
    if (m.target === 'group') {
      box.appendChild(h('div', { class: 'sec' }, h('h3', {}, '狙う敵の条件 (すべて満たす敵全員)'), h('div', { class: 'fgrid' },
        fSel(m, 'groupMark', '● / ★', opts.marks(), { blank: '(指定なし)', after: upd }),
        fSel(m, 'groupElement', '属性', opts.elements(), { blank: '(指定なし)', after: upd }),
        fSel(m, 'groupType', 'タイプ', opts.types(), { blank: '(指定なし)', after: upd }))));
    }
    if (kind === 'attack') {
      box.appendChild(h('div', { class: 'sec' }, h('h3', {}, '相手によって威力が上がる'), h('div', { class: 'fgrid' },
        fBonus(m, 'markBonus', '相手が ● / ★ なら +', opts.marks(), { after: upd }),
        fBonus(m, 'elemBonus', '相手の属性が 〇 なら +', opts.elements(), { after: upd }),
        fBonus(m, 'typeBonus', '相手のタイプが 〇 なら +', opts.types(), { after: upd }))));
      box.appendChild(h('div', { class: 'sec' }, h('h3', {}, 'だんだん強くなる'), h('div', { class: 'fgrid' },
        fSel(m, 'scaleBy', '威力が増える条件', Object.entries(RB.SCALE_BY), { blank: '(増えない)', after: upd }),
        fNum(m, 'scalePer', '1あたりの威力+', { after: upd, hint: '例: ミス1回につき +10' }),
        fNum(m, 'scaleMax', '増える威力の上限', { after: upd, placeholder: '上限なし' }))));
      box.appendChild(h('div', { class: 'sec' }, h('h3', {}, 'その他の攻撃オプション'), h('div', { class: 'fgrid' },
        fNum(m, 'hits', '攻撃回数', { placeholder: '1', after: upd }),
        fNum(m, 'drainPct', '与ダメの%を回復', { after: upd }),
        fNum(m, 'recoilPct', '与ダメの%を反動で受ける', { after: upd }),
        fNum(m, 'pctHp', '相手の現在HPの%を追加', { after: upd }),
        fBool(m, 'ignoreDef', '防御(被ダメ−)を無視', { after: upd }),
        fBool(m, 'pierce', 'バリア・無効・ガードを貫通', { after: upd }),
        fSel(m, 'element', '技の属性 (相性表・耐性用。通常は空欄)', opts.elements(), { blank: '(キャラの属性)', after: upd }))));
    }
    if (kind !== 'miss') {
      const sec = h('div', { class: 'sec' }, h('h3', {}, kind === 'attack' ? '追加効果 (ダメージの後に発動)' : '効果'));
      sec.appendChild(effectsEditor(m.effects, upd, { defaultTo: m.target === 'self' ? 'self' : null }));
      box.appendChild(sec);
    }
    box.appendChild(h('div', { class: 'sec' }, fArea(m, 'desc', '説明文 (空なら自動説明を表示)', { placeholder: RB.describeMove(m, D) }), desc));
    upd();
    const users = D.chars.filter(c => c.moves.some(e => e.move === m.id));
    box.appendChild(h('div', { class: 'sec' }, h('h3', {}, `使っているキャラ (${users.length})`),
      h('div', { class: 'row' }, users.map(c => h('button', { type: 'button', class: 'small', onclick: () => jump('chars', c.id) }, `${c.icon || ''} ${c.name}`)))));
  }

  // ===================== 特性 =====================
  function formAbility(box, a) {
    box.appendChild(h('h2', {}, '✨ ' + a.name));
    const desc = h('div', { class: 'auto-desc', style: 'margin:6px 0 10px' });
    const upd = () => { desc.textContent = '自動説明: ' + (RB.describeAbility(a, D) || '(効果なし)'); };
    const trig = a.trigger || 'passive';
    box.appendChild(h('div', { class: 'fgrid' },
      fText(a, 'name', '名前', { list: true, keepEmpty: true }),
      fId('abilities', a),
      fSel(a, 'trigger', '発動タイミング', opts.triggers(), { rerender: true, list: true }),
      trig === 'onLowHp' ? fNum(a, 'lowHpPct', 'HPが何%以下で', { placeholder: '50', after: upd }) : null,
      trig !== 'passive' ? fNum(a, 'chance', '発動確率%', { placeholder: '100', after: upd }) : null,
      trig !== 'passive' ? fBool(a, 'once', '1バトルに1回だけ', { after: upd }) : null,
      fArea(a, 'desc', '説明文', {})));
    box.appendChild(desc);
    if (trig !== 'passive') {
      const nc = a.cond ? Object.keys(a.cond).length : 0;
      const det = h('details', { class: 'sec', open: nc > 0 ? true : null }, h('summary', {}, `発動条件 ${nc ? `(${nc})` : '(なし)'}`));
      const ce = condEditor(a);
      ce.addEventListener('change', () => setTimeout(upd)); ce.addEventListener('input', () => setTimeout(upd));
      det.appendChild(ce);
      box.appendChild(det);
      const hint = {
        onHit: '「攻撃してきた相手」を対象にすると反撃・状態異常返しが作れます',
        onAttack: '「技の対象」= 攻撃した相手。条件「与えた/受けたダメージがN以上」で当たった時だけにできます',
        onSpin: '条件「引いた技の種類が: ミス」で「ミスを引いたら〜」が作れます',
        onKO: '「技の対象」= 倒した相手',
        onDowned: 'たおれかけた時 (最後の行動の前) に発動',
      }[trig];
      const sec = h('div', { class: 'sec' }, h('h3', {}, '効果'), hint ? h('div', { class: 'dim', style: 'font-size:12px;margin-bottom:6px' }, hint) : null);
      sec.appendChild(effectsEditor(a.effects, upd, { defaultTo: 'self' }));
      box.appendChild(sec);
    }
    a.passive = a.passive || {};
    const ps = a.passive;
    const resist = ps.resist || {};
    const clean = () => {
      if (ps.immune && !ps.immune.length) delete ps.immune;
      for (const k of Object.keys(resist)) if (!has(resist[k])) delete resist[k];
      if (Object.keys(resist).length) ps.resist = resist; else delete ps.resist;
      if (!Object.keys(ps).length) delete a.passive; else a.passive = ps;
      upd();
    };
    const pSec = h('details', { class: 'sec', open: Object.keys(ps).length || trig === 'passive' ? true : null }, h('summary', {}, '常時効果 (パッシブ) — どのタイミングの特性にもつけられます'));
    pSec.appendChild(h('div', { class: 'fgrid', style: 'margin-top:8px' },
      fNum(ps, 'atkFlat', '攻撃力 +', { after: clean }),
      fNum(ps, 'atkPct', '攻撃力 %', { after: clean }),
      fNum(ps, 'defFlat', '防御 (被ダメ −)', { after: clean }),
      fNum(ps, 'dmgTakenPct', '被ダメージ % (−で軽減)', { after: clean }),
      fNum(ps, 'hpPct', '最大HP %', { after: clean }),
      fNum(ps, 'nullifyBelow', 'N以下のダメージ無効', { after: clean }),
      fNum(ps, 'statusChanceBonus', '状態異常付与率 +%', { after: clean }),
      fNum(ps, 'healPct', '回復量 +%', { after: clean })));
    const imm = h('div', { class: 'checks' });
    for (const s of D.statuses) {
      const cb = h('input', { type: 'checkbox', checked: (ps.immune || []).includes(s.id) });
      cb.onchange = () => { ps.immune = (ps.immune || []).filter(x => x !== s.id); if (cb.checked) ps.immune.push(s.id); clean(); changed({}); };
      imm.appendChild(h('label', {}, cb, `${s.icon || ''}${s.name}`));
    }
    pSec.appendChild(h('div', { class: 'f wide' }, h('span', {}, 'かからない状態異常'), imm));
    pSec.appendChild(h('div', { class: 'f wide', style: 'margin-top:8px' }, h('span', {}, '属性ごとの受けるダメージ倍率 (例: 0.5 で半減)'),
      h('div', { class: 'bonus-grid' }, D.elements.map(e => { const f = fNum(resist, e.id, `${e.icon || ''}${e.name}`, { placeholder: '1', step: 0.1, after: clean }); f.classList.add('bonus-cell'); return f; }))));
    clean();
    box.appendChild(pSec);
    upd();
    const users = D.chars.filter(c => c.abilities.includes(a.id));
    box.appendChild(h('div', { class: 'sec' }, h('h3', {}, `持っているキャラ (${users.length})`),
      h('div', { class: 'row' }, users.map(c => h('button', { type: 'button', class: 'small', onclick: () => jump('chars', c.id) }, `${c.icon || ''} ${c.name}`)))));
  }

  // ===================== 状態異常 =====================
  function formStatus(box, s) {
    box.appendChild(h('h2', {}, `${s.icon || ''} ${s.name}`));
    box.appendChild(h('div', { class: 'fgrid' },
      fText(s, 'name', '名前', { list: true, keepEmpty: true }),
      fId('statuses', s),
      fText(s, 'icon', 'アイコン (絵文字)', { list: true }),
      fColor(s, 'color', '色', { list: true }),
      fNum(s, 'turns', '既定のターン数', { hint: 'かかった本人のターン終了ごとに1減る。0=治るまで永続', keepEmpty: true }),
      fArea(s, 'desc', '説明', {})));
    box.appendChild(h('div', { class: 'sec' }, h('h3', {}, '行動を封じる (ねむり・こおり型)'), h('div', { class: 'fgrid' },
      fNum(s, 'skipWake', '目覚める確率% (空欄=封じない)', { hint: 'ターン開始時に目覚めルーレット。起きればそのターン行動できる' }),
      fBool(s, 'cureOnHit', '攻撃を受けると治る'))));
    box.appendChild(h('div', { class: 'sec' }, h('h3', {}, 'ルーレットを壊す (まひ型)'), h('div', { class: 'fgrid' },
      fNum(s, 'disableCount', '使えなくなる区画の数', { hint: '選ばれた区画に止まると不発 (ミス扱い)' }),
      fSel(s, 'disableMode', 'どの区画が', Object.entries(RB.DISABLE_MODES), {}))));
    box.appendChild(h('div', { class: 'sec' }, h('h3', {}, '継続ダメージ・能力変化 (どく・やけど型)'), h('div', { class: 'fgrid' },
      fNum(s, 'dotAmount', 'ターン終了時ダメージ'),
      fNum(s, 'dotPct', 'ターン終了時 最大HPの%ダメージ'),
      fNum(s, 'atkPct', '攻撃力 % (−で低下)'),
      fNum(s, 'defFlat', '防御 (+で被ダメ減 / −で増)'),
      fNum(s, 'dmgTakenPct', '被ダメージ %'),
      fNum(s, 'confuseChance', 'こんらん: 狙いがランダムになる確率%'))));
    box.appendChild(h('div', { class: 'sec' }, h('h3', {}, '時限爆弾 (ばくだん型)'), h('div', { class: 'fgrid' },
      fNum(s, 'expireDamage', 'ターン数が切れた時の爆発ダメージ', { hint: '「押し付ける」効果で他の人に渡せます' }),
      fNum(s, 'expirePct', '爆発: 最大HPの%ダメージ'))));
  }

  // ===================== 属性 =====================
  function formElement(box, e) {
    box.appendChild(h('h2', {}, `${e.icon || ''} ${e.name}`));
    box.appendChild(h('div', { class: 'fgrid' },
      fText(e, 'name', '名前', { list: true, keepEmpty: true, after: () => renderChart() }),
      fId('elements', e),
      fText(e, 'icon', 'アイコン', { list: true, after: () => renderChart() }),
      fColor(e, 'color', '色', { list: true })));
    const using = D.moves.filter(m => (m.elemBonus && has(m.elemBonus[e.id])) || m.groupElement === e.id);
    box.appendChild(h('div', { class: 'sec' }, h('h3', {}, `この属性に強い技 (${using.length})`),
      h('div', { class: 'dim', style: 'font-size:12px;margin-bottom:6px' }, '技の「相手の属性が 〇 なら +」で設定します。'),
      h('div', { class: 'row' }, using.map(m => h('button', { type: 'button', class: 'small', onclick: () => jump('moves', m.id) }, `${m.name} ${m.groupElement === e.id ? '(全員)' : '+' + m.elemBonus[e.id]}`)))));
    const sec = h('details', { class: 'sec', open: Object.keys(D.chart || {}).length ? true : null }, h('summary', {}, '(任意) 相性倍率表 — 使わないなら空欄のまま'));
    const tbox = h('div', { class: 'scroll-x' });
    sec.appendChild(h('div', { class: 'dim', style: 'font-size:12px;margin:6px 0' }, '攻撃側(行) → 防御側(列) の倍率。空欄 = ×1。初期データでは使っていません。'));
    sec.appendChild(tbox);
    box.appendChild(sec);
    function renderChart() {
      tbox.innerHTML = '';
      const els = D.elements;
      const t = h('table', { class: 'chart-table' });
      t.appendChild(h('tr', {}, h('th', {}, '攻\\防'), els.map(x => h('th', {}, `${x.icon || ''}${x.name}`))));
      for (const a of els) {
        const tr = h('tr', {}, h('th', {}, `${a.icon || ''}${a.name}`));
        for (const d of els) {
          const v = (D.chart[a.id] || {})[d.id];
          const td = h('td', { class: has(v) ? (v > 1 ? 'hi' : v < 1 ? 'lo' : '') : '' });
          const i = h('input', { type: 'number', inputmode: 'decimal', step: 0.1, min: 0, value: has(v) ? v : '', placeholder: '1' });
          i.oninput = () => {
            D.chart[a.id] = D.chart[a.id] || {};
            if (i.value === '' || +i.value === 1) delete D.chart[a.id][d.id]; else D.chart[a.id][d.id] = +i.value;
            if (!Object.keys(D.chart[a.id]).length) delete D.chart[a.id];
            td.className = i.value === '' ? '' : (+i.value > 1 ? 'hi' : +i.value < 1 ? 'lo' : '');
            changed({});
          };
          td.appendChild(i);
          tr.appendChild(td);
        }
        t.appendChild(tr);
      }
      tbox.appendChild(t);
    }
    renderChart();
  }

  // ===================== タイプ =====================
  function formType(box, t) {
    box.appendChild(h('h2', {}, '🏷 ' + t.name));
    box.appendChild(h('div', { class: 'fgrid' },
      fText(t, 'name', '名前', { list: true, keepEmpty: true }),
      fId('types', t),
      fArea(t, 'desc', '説明', {}),
      fNum(t, 'hpPct', '最大HP %'),
      fNum(t, 'atkPct', '攻撃力 %'),
      fNum(t, 'atkFlat', '攻撃力 +'),
      fNum(t, 'defFlat', '防御 (被ダメ −)'),
      fNum(t, 'statusChanceBonus', '状態異常付与率 +%'),
      fNum(t, 'healPct', '回復量 +%')));
    const using = D.moves.filter(m => (m.typeBonus && has(m.typeBonus[t.id])) || m.groupType === t.id);
    box.appendChild(h('div', { class: 'sec' }, h('h3', {}, `このタイプに強い技 (${using.length})`),
      h('div', { class: 'row' }, using.map(m => h('button', { type: 'button', class: 'small', onclick: () => jump('moves', m.id) }, `${m.name} ${m.groupType === t.id ? '(全員)' : '+' + m.typeBonus[t.id]}`)))));
    const users = D.chars.filter(c => c.type === t.id);
    box.appendChild(h('div', { class: 'sec' }, h('h3', {}, `このタイプのキャラ (${users.length})`),
      h('div', { class: 'row' }, users.map(c => h('button', { type: 'button', class: 'small', onclick: () => jump('chars', c.id) }, `${c.icon || ''} ${c.name}`)))));
  }

  // ===================== ルール =====================
  function formRules(box) {
    const r = D.rules;
    box.appendChild(h('h2', {}, '📜 ルール'));
    const hpTable = h('div', { class: 'scroll-x' });
    const NS = [2, 3, 4, 5, 6, 8, 10, 12];
    const updHp = () => {
      hpTable.innerHTML = '';
      hpTable.appendChild(h('table', { class: 'mtable' },
        h('tr', {}, h('th', {}, '人数'), NS.map(n => h('th', {}, n + '人'))),
        h('tr', {}, h('td', {}, 'HP倍率'), NS.map(n => h('td', {}, '×' + RB.hpMultiplier(r, n).toFixed(2)))),
        h('tr', {}, h('td', {}, '基本HP100'), NS.map(n => h('td', {}, String(Math.round(100 * RB.hpMultiplier(r, n))))))));
    };
    box.appendChild(h('div', { class: 'sec' }, h('h3', {}, '人数とHP'),
      h('div', { class: 'fgrid' },
        fNum(r, 'hpScalePerPlayer', '3人目から1人増えるごとのHP +%', { keepEmpty: true, after: updHp }),
        fSel(r, 'protect', '倒れた時の扱い', Object.entries(RB.PROTECT_MODES), { wide: true })),
      hpTable,
      h('div', { class: 'dim', style: 'font-size:12px;margin-top:6px' }, '「最後の行動保証」では、自分のターンが回ってくる前にHPが0になっても、自分のターンで最後の行動ができます (技の回復・吸収でHPが戻れば復活)。そのターンの終わりにHP0なら脱落します。')));
    updHp();
    box.appendChild(h('div', { class: 'sec' }, h('h3', {}, '進行'), h('div', { class: 'fgrid' },
      fSel(r, 'orderBy', '行動順', Object.entries(RB.ORDER_MODES), {}),
      fSel(r, 'itemMode', 'きりふだの配り方', Object.entries(RB.ITEM_MODES), {}),
      fNum(r, 'maxSpinChain', '「もう一回」の最大回数/ターン', { keepEmpty: true }),
      fNum(r, 'maxExtraSpins', '2回行動系で増える行動回数の上限', { keepEmpty: true }),
      fNum(r, 'aoeFalloff', '全体技: 対象1人増えるごとの威力 −%', { keepEmpty: true }),
      fNum(r, 'aoeFloor', '全体技: 威力の下限%', { keepEmpty: true }),
      fNum(r, 'suddenDeathRound', 'サドンデス開始ラウンド (0=なし)', { keepEmpty: true }),
      fNum(r, 'suddenDeathPct', 'サドンデス: 1ラウンドごとの与ダメ +%', { keepEmpty: true }),
      fNum(r, 'maxRounds', '打ち切りラウンド (残りHP割合で判定)', { keepEmpty: true }))));
    box.appendChild(h('div', { class: 'sec' }, h('h3', {}, '● と ★ の記号'), h('div', { class: 'fgrid' },
      fText(r, 'dotLabel', '1つ目の印', { keepEmpty: true }),
      fText(r, 'starLabel', '2つ目の印', { keepEmpty: true })),
      h('div', { class: 'dim', style: 'font-size:12px' }, 'キャラはどちらかの印を持ち、「●の敵全員に30」「★に+15」のように印で狙う技や条件があります。記号は好きなものに変えられます。')));
  }

  // ===================== データ =====================
  function formData(box) {
    box.appendChild(h('h2', {}, '💾 データ'));
    box.appendChild(h('div', { class: 'sync-box' }, h('b', {}, RBStore.statusLabel()),
      h('div', { class: 'dim', style: 'font-size:13px;margin-top:4px' }, RBStore.cloudState === 'local'
        ? 'このブラウザに保存しています。別の端末に移すときは下の「書き出し」→ 向こうで「読み込み」をしてください。'
        : 'claude.ai 上で開いている間は、保存した内容が PC とスマホで共通になります。')));
    const w = RB.validate(D);
    box.appendChild(h('div', { class: w.length ? 'warn-box' : 'dim', style: 'margin:12px 0' }, w.length ? [h('b', {}, `⚠ 問題 ${w.length}件`), h('ul', {}, w.map(x => h('li', {}, x)))] : '✔ データに問題はありません'));
    const ta = h('textarea', { class: 'json', spellcheck: 'false', 'aria-label': 'データのJSON' });
    ta.value = JSON.stringify(D, null, 2);
    box.appendChild(h('div', { class: 'row', style: 'margin-bottom:12px' },
      h('button', { type: 'button', class: 'primary', onclick: exportData }, '💾 ファイルに書き出し'),
      h('button', { type: 'button', onclick: async () => { const ok = await RBUI.copyText(JSON.stringify(D), ta); RBUI.toast(ok ? 'コピーしました。メモ帳などに貼り付けて保存できます' : '下の欄を選択しました。コピーしてください'); } }, '📋 コピー'),
      h('button', { type: 'button', onclick: () => $('#edImportFile').click() }, '📂 ファイルから読み込み'),
      h('button', { type: 'button', class: 'danger', onclick: resetDefault }, '↺ 初期データに戻す')));
    box.appendChild(h('div', { class: 'sec' }, h('h3', {}, 'JSON を貼り付けて読み込む / 直接編集'),
      h('div', { class: 'dim', style: 'font-size:12px;margin-bottom:6px' }, 'コピーしたデータを LINE やメモで送り、ここに貼り付けて「この内容を適用」すると他の端末に移せます。'),
      ta,
      h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { type: 'button', class: 'primary', onclick: async () => {
        let nd;
        try { nd = RBStore.parseText(ta.value); } catch (e) { await RBUI.alert(e.message); return; }
        if (!(await RBUI.confirm('貼り付けた内容で、今のデータを置き換えます。', { ok: '適用する' }))) return;
        D = nd; IDX = RB.index(D); doSave(); renderAll(); RBUI.toast('適用しました');
      } }, 'この内容を適用'))));
  }

  async function exportData() {
    const name = `roulette-battle-${new Date().toISOString().slice(0, 10)}.json`;
    const r = await RBStore.download(D, name);
    if (r === 'saved') RBUI.toast('書き出しました');
    else if (r === 'declined') RBUI.toast('キャンセルしました');
    else { tab = 'data'; showDetail(false); renderAll(); RBUI.alert('この画面ではファイル保存ができません。「📋 コピー」でデータをコピーして保存してください。'); }
  }

  async function resetDefault() {
    if (!(await RBUI.confirm('すべての編集を捨てて初期データに戻します。先に「書き出し」や「コピー」で保存しておくと安心です。', { ok: '初期データに戻す', danger: true }))) return;
    D = RBStore.normalize(RB.clone(RB_DEFAULT_DATA)); IDX = RB.index(D);
    doSave(); renderAll(); RBUI.toast('初期データに戻しました');
  }

  // ===================== 外部 (app.js) から =====================
  function reload() { D = RBStore.load().data; IDX = RB.index(D); }

  function init() {
    inited = true;
    reload();
    try { const t = localStorage.getItem('rouletteBattle.edTab'); if (t && TABS[t]) tab = t; } catch (e) { /* noop */ }
    const r = RBStore.load();
    $('#edSavedInd').textContent = r.source === 'custom' ? `保存データ (${RBStore.fmtDate(r.savedAt)})` : '初期データ (編集すると自動保存)';
    $('#edExportBtn').onclick = exportData;
    $('#edImportBtn').onclick = () => $('#edImportFile').click();
    $('#edImportFile').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const d = await RBStore.readFile(f);
        if (!(await RBUI.confirm(`「${f.name}」を読み込み、今のデータを置き換えます。`, { ok: '読み込む' }))) return;
        D = d; IDX = RB.index(D); doSave(); renderAll(); RBUI.toast('読み込みました');
      } catch (err) { RBUI.alert(err.message); }
    };
  }

  function onShow() {
    if (!inited) init();
    else if (!saveTimer) reload();
    renderAll();
    updateWarn();
  }

  function onData(ev) {
    if (!inited || ev.why === 'self') return;
    if (saveTimer || Date.now() - lastEdit < 3000) {
      if (ev.why === 'remote') RBUI.toast('別の端末でも変更がありました。こちらの編集で上書きされます');
      return;
    }
    reload();
    if (RBApp.mode === 'edit') { renderAll(); updateWarn(); if (ev.why === 'remote') RBUI.toast('別の端末での変更を読み込みました'); }
  }

  return { onShow, onData };
})();
