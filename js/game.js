/* ルーレットバトル: セットアップ〜対戦〜結果、オンライン (プライベートルーム) */
var RBGame = (function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = RBStore.esc;
  const icon = RBStore.iconHTML;
  const SETUP_KEY = 'rouletteBattle.setup';
  const NAME_KEY = 'rouletteBattle.onlineName';
  const TEAM_COLORS = ['', '#ff6b6b', '#5aa9f0', '#5fd38a', '#ffd84a', '#c89bff', '#7fe3e3'];
  const TEAM_NAMES = ['', 'A', 'B', 'C', 'D', 'E', 'F'];
  const SPEEDS = {
    normal: { spin: 2600, after: 1100, think: 700, banner: 1000 },
    fast:   { spin: 1200, after: 550,  think: 300, banner: 550 },
    turbo:  { spin: 260,  after: 150,  think: 60,  banner: 200 },
  };
  const narrow = () => window.matchMedia('(max-width: 980px)').matches;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  let DATA, IDX;
  let setup = { players: [], teamMode: false };

  // オンライン状態
  let role = 'local';          // local | host | guest
  let roomCode = null;
  let netPlayers = [];         // ホスト: 参加者 [{ id, name, charId, item, team }]
  let guestPid = null;         // 参加者: 自分のプレイヤー番号
  let lobby = null;            // 参加者: ホストから届いたロビー情報
  let myPick = { name: '', charId: '', item: '' };

  // ===================== データ =====================
  function loadData() {
    const r = RBStore.load();
    DATA = r.data;
    IDX = RB.index(DATA);
    $('#dataInfo').textContent = r.source === 'custom' ? `使用データ: 編集済み (${RBStore.fmtDate(r.savedAt)})` : '使用データ: 初期データ';
    const w = RB.validate(DATA);
    const box = $('#dataWarn');
    box.hidden = !w.length;
    if (w.length) box.innerHTML = `⚠ データに問題があります (エディタで修正してください)<ul>${w.slice(0, 8).map(x => `<li>${esc(x)}</li>`).join('')}${w.length > 8 ? `<li>ほか ${w.length - 8} 件</li>` : ''}</ul>`;
  }
  function useData(d) { DATA = RBStore.normalize(d); IDX = RB.index(DATA); }

  function loadSetup() {
    try { const s = JSON.parse(localStorage.getItem(SETUP_KEY) || 'null'); if (s && Array.isArray(s.players)) setup = s; } catch (e) { /* noop */ }
    if (!setup.players.length) {
      setup.players = [
        { name: 'プレイヤー1', charId: '', cpu: false, team: 1 },
        { name: 'CPU 1', charId: '', cpu: true, team: 2 },
        { name: 'CPU 2', charId: '', cpu: true, team: 1 },
        { name: 'CPU 3', charId: '', cpu: true, team: 2 },
      ];
    }
    try { myPick.name = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* noop */ }
  }
  function saveSetup() { try { localStorage.setItem(SETUP_KEY, JSON.stringify(setup)); } catch (e) { /* noop */ } }

  // ===================== 表示の部品 =====================
  const pickable = () => DATA.chars.filter(c => !c.hidden);
  function charOptions(sel) {
    let h = `<option value="">🎲 おまかせ</option>`;
    for (const el of DATA.elements) {
      const cs = pickable().filter(c => c.element === el.id);
      if (!cs.length) continue;
      h += `<optgroup label="${esc(el.icon || '')} ${esc(el.name)}">` + cs.map(c => `<option value="${esc(c.id)}"${c.id === sel ? ' selected' : ''}>${esc(c.icon ? c.icon + ' ' : '')}${esc(c.name)}</option>`).join('') + '</optgroup>';
    }
    const rest = pickable().filter(c => !IDX.elements[c.element]);
    if (rest.length) h += `<optgroup label="その他">` + rest.map(c => `<option value="${esc(c.id)}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}</option>`).join('') + '</optgroup>';
    return h;
  }
  function itemOptions(sel) {
    return `<option value="">🃏 おまかせ</option><option value="none"${sel === 'none' ? ' selected' : ''}>なし</option>` +
      (DATA.items || []).map(it => `<option value="${esc(it.id)}"${it.id === sel ? ' selected' : ''}>${esc(it.icon || '🃏')} ${esc(it.name)}</option>`).join('');
  }
  function elBadge(id) {
    const el = IDX.elements[id];
    if (!el) return '';
    return `<span class="badge" style="background:${esc(el.color)}33;border-color:${esc(el.color)}88">${esc(el.icon || '')}${esc(el.name)}</span>`;
  }
  function typeBadge(id) { const t = IDX.types[id]; return t ? `<span class="badge type">${esc(t.name)}</span>` : ''; }
  function marks(ch) {
    const m = RB.markLabel(DATA, ch.mark);
    return `<span class="marks" title="すばやさ ${RB.num(ch.speed, 3)}">${m ? `<span class="${ch.mark}">${esc(m)}</span> ` : ''}<span class="spd">💨${RB.num(ch.speed, 3)}</span></span>`;
  }
  function charInfo(ch, n) {
    if (!ch) return '<span class="dim">ランダムに選ばれます</span>';
    const passive = RB.passiveOf(IDX, ch);
    const hp = Math.round(RB.num(ch.baseHp, 100) * RB.hpMultiplier(DATA.rules, n) * (1 + passive.hpPct / 100));
    const abs = (ch.abilities || []).map(a => IDX.abilities[a]).filter(Boolean).map(a => a.name).join('・');
    return `${icon(ch)} ${elBadge(ch.element)} ${typeBadge(ch.type)} ${marks(ch)} <span>HP ${hp}</span>${abs ? `<span>特性: ${esc(abs)}</span>` : ''} <button type="button" class="small" data-info="${esc(ch.id)}">詳細</button>`;
  }
  const itemMode = () => (DATA.rules || {}).itemMode || 'random';

  // ===================== セットアップ画面 =====================
  const totalPlayers = () => setup.players.length + (role === 'host' ? netPlayers.length : 0);

  function renderSetup() {
    const n = totalPlayers();
    $('#cntN').textContent = n;
    $('#teamMode').checked = !!setup.teamMode;
    const box = $('#prows');
    box.innerHTML = '';
    const teamSel = (team) => setup.teamMode ? `<select class="team" aria-label="チーム">${[1, 2, 3, 4, 5, 6].map(t => `<option value="${t}"${(team || 1) === t ? ' selected' : ''}>チーム${TEAM_NAMES[t]}</option>`).join('')}</select>` : '<span class="team"></span>';
    const choose = itemMode() === 'choose';
    setup.players.forEach((sp, i) => {
      const row = document.createElement('div');
      row.className = 'prow';
      if (setup.teamMode) row.style.borderColor = TEAM_COLORS[sp.team || 1] + '88';
      row.innerHTML = `
        <div class="num">${i + 1}</div>
        <input type="text" class="pname" id="pname${i}" value="${esc(sp.name)}" maxlength="12" placeholder="名前" aria-label="${i + 1}人目の名前">
        <select class="csel" id="pchar${i}" aria-label="${i + 1}人目のキャラ">${charOptions(sp.charId)}</select>
        <label class="cpuLbl"><input type="checkbox" class="pcpu"${sp.cpu ? ' checked' : ''}>CPU</label>
        ${teamSel(sp.team)}
        <div class="cinfo">${charInfo(IDX.chars[sp.charId], n)}${choose ? ` <select class="isel" aria-label="きりふだ">${itemOptions(sp.item || '')}</select>` : ''}</div>`;
      row.querySelector('.pname').oninput = (e) => { sp.name = e.target.value; saveSetup(); sendLobby(); };
      row.querySelector('.csel').onchange = (e) => { sp.charId = e.target.value; saveSetup(); renderSetup(); };
      row.querySelector('.pcpu').onchange = (e) => { sp.cpu = e.target.checked; saveSetup(); sendLobby(); };
      const ts = row.querySelector('select.team');
      if (ts) ts.onchange = (e) => { sp.team = +e.target.value; saveSetup(); renderSetup(); };
      const is = row.querySelector('.isel');
      if (is) is.onchange = (e) => { sp.item = e.target.value; saveSetup(); sendLobby(); };
      box.appendChild(row);
    });
    if (role === 'host') {
      netPlayers.forEach((np, k) => {
        const row = document.createElement('div');
        row.className = 'prow net';
        if (setup.teamMode) row.style.borderColor = TEAM_COLORS[np.team || 1] + '88';
        const ch = IDX.chars[np.charId];
        const it = (DATA.items || []).find(x => x.id === np.item);
        row.innerHTML = `
          <div class="num">${setup.players.length + k + 1}</div>
          <div class="pname netname">🌐 ${esc(np.name || '参加者')}</div>
          <div class="csel dim">${ch ? esc((ch.icon || '') + ' ' + ch.name) : '🎲 おまかせ'} <small>(本人が選択)</small></div>
          <button type="button" class="small danger kick">外す</button>
          ${teamSel(np.team)}
          <div class="cinfo">${charInfo(ch, n)}${choose ? ` <span>🃏 ${esc(it ? it.name : (np.item === 'none' ? 'なし' : 'おまかせ'))}</span>` : ''}</div>`;
        row.querySelector('.kick').onclick = async () => {
          if (!(await RBUI.confirm(`${np.name} さんをルームから外しますか?`, { ok: '外す', danger: true }))) return;
          RBNet.kick(np.id);
        };
        const ts = row.querySelector('select.team');
        if (ts) ts.onchange = (e) => { np.team = +e.target.value; renderSetup(); };
        box.appendChild(row);
      });
    }
    box.querySelectorAll('[data-info]').forEach(b => { b.onclick = () => showCharModal(IDX.chars[b.dataset.info]); });
    renderRules(n);
    renderOnlinePanel();
    sendLobby();
  }

  function renderRules(n) {
    const r = DATA.rules;
    const sd = RB.num(r.suddenDeathRound);
    $('#ruleInfo').innerHTML = [
      ['人数', `${n}人`],
      ['HP倍率', `×${RB.hpMultiplier(r, n).toFixed(2)} <span class="dim">(3人目から1人ごとに+${RB.num(r.hpScalePerPlayer)}%)</span>`],
      ['行動順', esc(RB.ORDER_MODES[r.orderBy] || r.orderBy)],
      ['倒れた時', esc((RB.PROTECT_MODES[r.protect] || r.protect).replace(/ \(.*\)$/, ''))],
      ['全体技', `対象1人増えるごとに -${RB.num(r.aoeFalloff)}% (最低${RB.num(r.aoeFloor)}%)`],
      ['サドンデス', sd > 0 ? `ラウンド${sd}から毎ラウンド与ダメ+${RB.num(r.suddenDeathPct)}%` : 'なし'],
      ['きりふだ', esc(RB.ITEM_MODES[itemMode()] || '') + ' (1試合に1回)'],
      [`${esc(r.dotLabel || '●')} / ${esc(r.starLabel || '★')}`, `キャラの印。「${esc(r.dotLabel || '●')}の敵全員に30」のように片方だけ狙う技がある`],
    ].map(([a, b]) => `<div class="rule-line"><span class="dim">${a}</span><span style="text-align:right">${b}</span></div>`).join('')
      + `<div class="dim" style="font-size:12px;margin-top:6px">${esc(RB.PROTECT_MODES[r.protect] || '')}</div>`;
  }

  function setCount(n) {
    const net = role === 'host' ? netPlayers.length : 0;
    const local = Math.max(Math.max(0, 2 - net), Math.min(12 - net, n - net));
    while (setup.players.length < local) {
      const k = setup.players.length;
      setup.players.push({ name: `CPU ${k}`, charId: '', cpu: true, team: (k % 2) + 1 });
    }
    setup.players.length = local;
    saveSetup(); renderSetup();
  }

  function resolvePlayers() {
    const rows = setup.players.map(sp => ({ name: (sp.name || '').trim(), charId: sp.charId, cpu: !!sp.cpu, team: sp.team, item: sp.item || '', ctrl: sp.cpu ? 'cpu' : 'local' }))
      .concat(role === 'host' ? netPlayers.map(np => ({ name: np.name, charId: np.charId, cpu: false, team: np.team, item: np.item || '', ctrl: 'net:' + np.id })) : []);
    const used = new Set(rows.map(p => p.charId).filter(Boolean));
    const all = pickable().filter(c => RB.charWheel(DATA, IDX, c).length).map(c => c.id);
    let pool = all.filter(id => !used.has(id));
    return rows.map((r, i) => {
      let cid = r.charId && IDX.chars[r.charId] ? r.charId : '';
      if (!cid) {
        if (!pool.length) pool = all.slice();
        cid = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      }
      return { name: r.name || `P${i + 1}`, charId: cid, cpu: r.cpu, team: setup.teamMode ? (r.team || 1) : 0, item: itemMode() === 'choose' ? r.item : '', ctrl: r.ctrl };
    });
  }

  async function onStart() {
    if (!DATA.chars.length) { await RBUI.alert('キャラがいません。エディタで作成してください。'); return; }
    if (totalPlayers() < 2) { await RBUI.alert('2人以上必要です'); return; }
    const ps = resolvePlayers();
    if (setup.teamMode && new Set(ps.map(p => p.team)).size < 2) { await RBUI.alert('チーム戦には2チーム以上必要です。チームを分けてください。'); return; }
    RBSound.unlock();
    startBattle(ps);
  }

  // ===================== オンライン: ホスト =====================
  function renderOnlinePanel() {
    const box = $('#onlinePanel');
    if (!box) return;
    if (role === 'host') {
      const link = inviteLink(roomCode);
      box.innerHTML = `<h3>🌐 オンライン: ルーム作成中</h3>
        <div class="code-big" aria-label="ルームコード">${esc(roomCode)}</div>
        <div class="dim" style="font-size:12px">参加する人は「ルームに入る」でこのコードを入力します (参加者 ${netPlayers.length}人)</div>
        <div class="row" style="margin-top:6px"><button type="button" class="small" id="copyInvite">🔗 招待リンクをコピー</button><button type="button" class="small danger" id="closeRoom">ルームを閉じる</button></div>
        <input type="text" id="inviteText" value="${esc(link)}" readonly style="width:100%;margin-top:6px;font-size:12px" aria-label="招待リンク">`;
      $('#copyInvite').onclick = async () => { const ok = await RBUI.copyText(link, $('#inviteText')); RBUI.toast(ok ? 'コピーしました' : 'リンクを選択しました。コピーしてください'); };
      $('#closeRoom').onclick = async () => {
        if (netPlayers.length && !(await RBUI.confirm('ルームを閉じると参加者は切断されます。', { ok: '閉じる', danger: true }))) return;
        RBNet.close(); role = 'local'; roomCode = null; netPlayers = []; renderSetup();
      };
      return;
    }
    const av = RBNet.available();
    box.innerHTML = `<h3>🌐 オンライン対戦</h3>
      ${av.ok ? '' : `<div class="warn-box">${esc(av.reason)}</div>`}
      <div class="row"><button type="button" id="hostBtn"${av.ok ? '' : ' disabled'}>ルームを作る</button></div>
      <div class="join-row">
        <input type="text" id="joinCode" placeholder="ルームコード" maxlength="5" autocapitalize="characters" autocomplete="off" aria-label="ルームコード">
        <input type="text" id="joinName" placeholder="あなたの名前" maxlength="12" value="${esc(myPick.name)}" aria-label="あなたの名前">
        <button type="button" id="joinBtn" class="primary"${av.ok ? '' : ' disabled'}>ルームに入る</button>
      </div>`;
    $('#hostBtn').onclick = startHosting;
    $('#joinBtn').onclick = () => joinRoom($('#joinCode').value, $('#joinName').value);
    const pre = roomFromUrl();
    if (pre) $('#joinCode').value = pre;
  }

  function inviteLink(code) {
    try { return location.href.split('#')[0] + '#room=' + code; } catch (e) { return code; }
  }
  function roomFromUrl() {
    try { const m = /room=([A-Za-z0-9]{4,8})/.exec(location.hash || ''); return m ? m[1].toUpperCase() : ''; } catch (e) { return ''; }
  }

  async function startHosting() {
    const b = $('#hostBtn'); b.disabled = true; b.textContent = '作成中…';
    try {
      roomCode = await RBNet.host(onHostEvent);
      role = 'host';
      netPlayers = [];
      // 12人を超えないようにローカルの人数を詰める
      renderSetup();
      RBUI.toast('ルームを作りました。コードを友だちに伝えてください');
    } catch (e) { b.disabled = false; b.textContent = 'ルームを作る'; RBUI.alert(e.message); }
  }

  function onHostEvent(ev) {
    if (ev.type === 'join') {
      if (G && !G.over && !$('#battle').hidden) { RBNet.kick(ev.id, 'バトル中なので入れません。終わるまで待ってください'); return; }
      if (totalPlayers() >= 12) {
        if (setup.players.length > 0 && setup.players[setup.players.length - 1].cpu) setup.players.pop();
        else { RBNet.kick(ev.id, 'ルームが満員です'); return; }
      }
      const h = ev.hello || {};
      netPlayers.push({ id: ev.id, name: String(h.name || '参加者').slice(0, 12), charId: '', item: '', team: (totalPlayers() % 2) + 1 });
      RBNet.send(ev.id, { t: 'data', data: DATA });
      RB_log_system(`🌐 ${h.name || '参加者'} さんが入室しました`);
      renderSetup();
    } else if (ev.type === 'leave') {
      const np = netPlayers.find(x => x.id === ev.id);
      netPlayers = netPlayers.filter(x => x.id !== ev.id);
      if (G && !G.over) {
        for (const p of G.players) if (p.ctrl === 'net:' + ev.id) {
          p.ctrl = 'cpu'; p.cpu = true;
          RB.log(G, `🌐 ${p.name} さんが切断したので、CPU が代わりに操作します`, 'sys');
          if (remoteWait && remoteWait.pid === p.id) remoteWait.fallback();
        }
        pub('refresh');
      }
      if (np) RBUI.toast(`${np.name} さんが退室しました`);
      if (!$('#setup').hidden) renderSetup();
    } else if (ev.type === 'msg') {
      const m = ev.msg;
      if (m.t === 'pick') {
        const np = netPlayers.find(x => x.id === ev.id);
        if (!np) return;
        if (typeof m.name === 'string') np.name = m.name.slice(0, 12) || np.name;
        if (m.charId === '' || IDX.chars[m.charId]) np.charId = m.charId;
        if (typeof m.item === 'string') np.item = m.item;
        if (!$('#setup').hidden) renderSetup();
      } else if (m.t === 'input') {
        if (remoteWait && remoteWait.conn === ev.id && remoteWait.pid === m.pid) remoteWait.resolve({ action: m.action === 'item' ? 'item' : 'spin', target: typeof m.target === 'number' ? m.target : null });
      }
    } else if (ev.type === 'error') {
      RBUI.toast('通信: ' + ev.message);
    }
  }
  function RB_log_system(text) { RBUI.toast(text); }

  // 参加者それぞれにロビー情報を送る
  function sendLobby() {
    if (role !== 'host') return;
    const rows = setup.players.map(sp => ({ name: sp.name, charId: sp.charId, cpu: !!sp.cpu, team: sp.team, net: false }))
      .concat(netPlayers.map(np => ({ name: np.name, charId: np.charId, cpu: false, team: np.team, net: true, id: np.id })));
    for (const np of netPlayers) {
      RBNet.send(np.id, { t: 'lobby', code: roomCode, teamMode: !!setup.teamMode, itemMode: itemMode(), rows: rows.map(r => ({ name: r.name, charId: r.charId, cpu: r.cpu, team: r.team, net: r.net, you: r.id === np.id })) });
    }
  }

  // ===================== オンライン: 参加者 =====================
  async function joinRoom(code, name) {
    code = String(code || '').trim();
    name = String(name || '').trim();
    if (!code) { RBUI.alert('ルームコードを入力してください'); return; }
    if (!name) { RBUI.alert('名前を入力してください'); return; }
    myPick.name = name;
    try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* noop */ }
    const b = $('#joinBtn'); b.disabled = true; b.textContent = '接続中…';
    try {
      roomCode = await RBNet.join(code, { name }, onGuestEvent);
      role = 'guest';
      lobby = null; guestPid = null;
      showScreen('lobby');
      renderLobby();
    } catch (e) { b.disabled = false; b.textContent = 'ルームに入る'; RBUI.alert(e.message); }
  }

  function onGuestEvent(ev) {
    if (ev.type === 'close') {
      const wasIn = role === 'guest';
      role = 'local'; runId++; waiting = null; G = null;
      loadData(); showScreen('setup'); renderSetup();
      if (wasIn) RBUI.alert(ev.reason || 'ルームから切断されました');
      return;
    }
    if (ev.type !== 'msg') return;
    const m = ev.msg;
    switch (m.t) {
      case 'data': useData(m.data); if (!$('#lobby').hidden) renderLobby(); break;
      case 'lobby': lobby = m; if (!$('#lobby').hidden) renderLobby(); break;
      case 'start': guestStart(m); break;
      case 'v': guestView(m); break;
      case 'await':
        if (m.pid !== guestPid) break;
        waiting = { pid: m.pid, need: !!m.need, canItem: !!m.canItem, mode: m.mode, itemName: m.itemName || '', remote: true };
        selectedTarget = (typeof m.target === 'number') ? m.target : null;
        $('#prompt').textContent = m.prompt || 'あなたの番です!';
        if (narrow()) $('#turnPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        RBSound.tick();
        refresh();
        break;
      case 'toLobby': runId++; waiting = null; showScreen('lobby'); renderLobby(); break;
    }
  }

  function renderLobby() {
    const box = $('#lobbyBody');
    if (!box) return;
    const rows = lobby ? lobby.rows : [];
    const me = rows.find(r => r.you);
    const n = rows.length;
    const choose = lobby && lobby.itemMode === 'choose';
    box.innerHTML = `
      <div class="lobby-head"><div><div class="dim" style="font-size:12px">ルーム</div><div class="code-big">${esc(roomCode || '')}</div></div>
        <div class="dim" style="font-size:13px">ホストがバトルを始めるまで待っています…<br>キャラはホストのデータから選べます</div></div>
      <div class="fgrid" style="margin-top:12px">
        <label class="f"><span>あなたの名前</span><input type="text" id="lbName" maxlength="12" value="${esc(myPick.name)}"></label>
        <label class="f"><span>キャラ</span><select id="lbChar">${DATA ? charOptions(myPick.charId) : ''}</select></label>
        ${choose ? `<label class="f"><span>きりふだ</span><select id="lbItem">${itemOptions(myPick.item)}</select></label>` : ''}
      </div>
      <div class="cinfo-wide">${DATA && IDX.chars[myPick.charId] ? charInfo(IDX.chars[myPick.charId], n) : ''}</div>
      <h3 style="margin:14px 0 6px">参加者 (${n}人)</h3>
      <div class="lobby-list">${rows.map((r, i) => {
        const ch = DATA && IDX.chars[r.charId];
        return `<div class="lobby-row${r.you ? ' you' : ''}"><span class="num">${i + 1}</span>${ch ? icon(ch) : '<span class="ico">🎲</span>'}<span class="nm">${esc(r.name || '?')}${r.you ? ' (あなた)' : ''}</span><span class="dim">${r.cpu ? 'CPU' : r.net ? '🌐' : 'ホスト側'}${lobby.teamMode ? ` / チーム${TEAM_NAMES[r.team || 1]}` : ''}</span></div>`;
      }).join('')}</div>`;
    const send = () => RBNet.sendHost({ t: 'pick', name: myPick.name, charId: myPick.charId, item: myPick.item });
    $('#lbName').oninput = (e) => { myPick.name = e.target.value.slice(0, 12); try { localStorage.setItem(NAME_KEY, myPick.name); } catch (er) { /* noop */ } send(); };
    $('#lbChar').onchange = (e) => { myPick.charId = e.target.value; send(); renderLobby(); };
    const li = $('#lbItem'); if (li) li.onchange = (e) => { myPick.item = e.target.value; send(); };
    box.querySelectorAll('[data-info]').forEach(b => { b.onclick = () => showCharModal(IDX.chars[b.dataset.info]); });
    if (me && me.charId !== myPick.charId && !lobby._sentOnce) { lobby._sentOnce = true; send(); }
  }

  async function leaveRoom() {
    if (!(await RBUI.confirm('ルームから退出しますか?', { ok: '退出する', danger: true }))) return;
    RBNet.close(); role = 'local'; runId++; waiting = null; G = null;
    loadData(); showScreen('setup'); renderSetup();
  }

  // ===================== キャラ詳細モーダル =====================
  function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
  function showCharModal(ch, player) {
    if (!ch) return;
    const m = $('#modal');
    const st = RB.wheelStats(DATA, ch);
    const segs = player && G ? RB.wheelOf(G, player) : st.segs;
    const tot = segs.reduce((a, s) => a + s.weight, 0) || 1;
    const abs = (ch.abilities || []).map(a => IDX.abilities[a]).filter(Boolean);
    const gear = player && player.gear && IDX.gears[player.gear.id];
    const item = player && player.item && IDX.items[player.item];
    m.innerHTML = `<div class="panel modal">
      <button type="button" class="close icon" id="mClose" aria-label="閉じる">✕</button>
      <div class="row" style="gap:12px;margin-bottom:10px;padding-right:36px">${icon(ch, 'ico big')}
        <div><div style="font-size:22px;font-weight:800">${esc(ch.name)}${player ? ` <span class="dim" style="font-size:14px">(${esc(player.name)})</span>` : ''}</div>
        <div class="row" style="gap:4px">${elBadge(ch.element)} ${typeBadge(ch.type)} ${marks(ch)} <span class="badge">HP ${player ? player.hp + '/' + player.maxHp : RB.num(ch.baseHp) + ' (基本)'}</span>${player && player.misses ? ` <span class="badge">ミス${player.misses}回</span>` : ''}</div></div></div>
      ${ch.desc ? `<p class="dim" style="margin:0 0 10px">${esc(ch.desc)}</p>` : ''}
      <div class="cdetail">
        <div><canvas id="mWheel"></canvas><div class="dim" style="font-size:12px;text-align:center">期待ダメージ ${st.expected.toFixed(1)} / ミス率 ${(st.missRate * 100).toFixed(0)}%</div></div>
        <div>
          <h3 class="mh">技</h3>
          <ul class="mvlist">${segs.map(s => `<li><span class="sw" style="background:${esc(s.color)}"></span><div class="mvtxt"><b>${esc(s.move.name)}</b>${s.disabledBy ? ` <span class="chip debuff">${esc(s.disabledBy)}で使用不可</span>` : ''}<div class="dim">${esc(s.move.desc || RB.describeMove(s.move, DATA, s.power))}</div></div><span class="pct">${(s.weight / tot * 100).toFixed(0)}%</span></li>`).join('')}</ul>
          <h3 class="mh">特性</h3>
          ${abs.length ? abs.map(a => `<div style="font-size:13px;margin-bottom:6px"><b>${esc(a.name)}</b><div class="dim">${esc(a.desc || '')}</div><div class="auto-desc">${esc(RB.describeAbility(a, DATA))}</div></div>`).join('') : '<div class="dim">なし</div>'}
          ${gear ? `<h3 class="mh">⚙ ギア: ${esc(gear.name)}</h3><div class="dim" style="font-size:13px">${esc(gear.desc || '')}${player.gear.turns > 0 ? ` (あと${player.gear.turns}ターン)` : ''}</div>` : ''}
          ${item ? `<h3 class="mh">🃏 きりふだ: ${esc(item.name)} ${player.itemUsed ? '(使用済み)' : ''}</h3><div class="dim" style="font-size:13px">${esc(item.desc || '')}</div>` : ''}
          ${IDX.types[ch.type] ? `<h3 class="mh">タイプ: ${esc(IDX.types[ch.type].name)}</h3><div class="dim" style="font-size:13px">${esc(IDX.types[ch.type].desc || '')}</div>` : ''}
          <div class="dim" style="font-size:12px;margin-top:10px">印: ${esc(RB.markLabel(DATA, ch.mark) || 'なし')} ／ すばやさ: ${RB.num(ch.speed, 3)} (大きいほど先に行動)</div>
        </div>
      </div></div>`;
    m.hidden = false;
    const w = new RBWheel($('#mWheel'));
    w.setSegments(rbWheelSegments(segs));
    $('#mClose').onclick = closeModal;
    m.onclick = (e) => { if (e.target === m) closeModal(); };
  }

  // ===================== バトル: 表示 =====================
  let G = null, wheel = null, runId = 0, paused = false;
  let speed = 'normal';
  let selectedTarget = null;
  let waiting = null;          // この端末で操作を待っている: { pid, need, canItem, mode, itemName, resolve?, remote? }
  let remoteWait = null;       // ホスト: 参加者の操作待ち
  let cards = {}, logLen = 0, lastSetupPlayers = null, sentLog = 0;
  const SP = () => SPEEDS[speed] || SPEEDS.normal;
  const dead = (my) => my !== runId;

  function showScreen(name) {
    for (const s of ['setup', 'lobby', 'battle', 'result']) $('#' + s).hidden = s !== name;
    if (window.RBApp) RBApp.setBattle(name === 'battle' || name === 'lobby' || role !== 'local');
    $('#pauseBtn').hidden = role === 'guest';
    $('#quitBtn').textContent = role === 'guest' ? '退出' : '終了';
    window.scrollTo(0, 0);
  }

  function buildBoard() {
    const board = $('#board');
    board.innerHTML = '';
    cards = {};
    for (const p of G.players) {
      const el = document.createElement('div');
      el.className = 'pcard';
      el.innerHTML = `<span class="ord"></span>
        <button type="button" class="info-btn" title="詳細" aria-label="${esc(p.name)}の詳細">ⓘ</button>
        <div class="head"></div>
        <div class="tags"></div>
        <div class="hpbar"><div class="lag"></div><div class="fill"></div></div>
        <div class="hptext"></div>
        <div class="chips"></div>`;
      el.querySelector('.info-btn').onclick = (e) => { e.stopPropagation(); showCharModal(p.char, p); };
      el.onclick = () => selectTarget(p.id);
      board.appendChild(el);
      cards[p.id] = { el, head: el.querySelector('.head'), tags: el.querySelector('.tags'), fill: el.querySelector('.fill'), lag: el.querySelector('.lag'), hp: el.querySelector('.hptext'), chips: el.querySelector('.chips'), ord: el.querySelector('.ord'), charId: null };
      paintCardHead(p);
    }
  }

  function paintCardHead(p) {
    const c = cards[p.id];
    const ch = p.char;
    c.charId = ch.id;
    const tag = p.id === guestPid && role === 'guest' ? '<span class="you-tag">あなた</span>' : '';
    const ctl = p.ctrl && String(p.ctrl).startsWith('net') ? '<span class="cpu">🌐</span>' : (p.cpu ? '<span class="cpu">CPU</span>' : '');
    c.head.innerHTML = `${icon(ch)}<div class="names"><div class="pname">${esc(p.name)}${ctl}${tag}${p.team ? `<span class="team-tag" style="background:${TEAM_COLORS[p.team]}">${TEAM_NAMES[p.team]}</span>` : ''}</div><div class="cname">${esc(ch.name)}</div></div>`;
    c.tags.innerHTML = `${elBadge(ch.element)}${typeBadge(ch.type)}${marks(ch)}`;
  }

  // この端末で操作できる待ち状態か
  const canOperate = () => !!waiting && (role !== 'guest' || waiting.pid === guestPid);

  function selectTarget(pid) {
    if (!canOperate() || !G) return;
    const cur = G.players[waiting.pid];
    if (!cur || !RB.validTargets(G, cur).some(t => t.id === pid)) return;
    selectedTarget = pid;
    RBSound.tick();
    refresh();
  }

  function modChips(p) {
    const agg = {};
    for (const m of p.mods) {
      const k = m.stat;
      if (!agg[k]) agg[k] = { stat: k, value: 0, turns: 0, perm: false };
      if (k === 'nullifyBelow') agg[k].value = Math.max(agg[k].value, RB.num(m.value)); else agg[k].value += RB.num(m.value);
      if (m.turns > 0) agg[k].turns = Math.max(agg[k].turns, m.turns); else agg[k].perm = true;
    }
    return Object.values(agg).filter(a => a.value !== 0).map(a => {
      const info = RB.MOD_STATS[a.stat] || { short: a.stat, unit: '', name: a.stat };
      const good = RB.isGoodMod(a);
      const v = ['guard', 'luck', 'extraSpins'].includes(a.stat) ? `×${a.value}` : ['barrier', 'nullifyBelow'].includes(a.stat) ? String(a.value) : `${a.value > 0 ? '+' : ''}${a.value}${info.unit}`;
      return `<span class="chip ${good ? 'buff' : 'debuff'}" title="${esc(info.name)}">${esc(info.short)}${esc(v)}${a.turns && !a.perm ? `<small> ${a.turns}T</small>` : ''}</span>`;
    }).join('');
  }

  function caresMisses(ch) {
    return (ch.moves || []).some(e => { const m = IDX.moves[e.move]; return m && m.scaleBy === 'misses'; })
      || (ch.abilities || []).some(a => { const ab = IDX.abilities[a]; return ab && ab.cond && ab.cond.moveKind === 'miss'; });
  }

  function refresh() {
    if (!G) return;
    const cur = G.current != null ? G.players[G.current] : null;
    const op = canOperate();
    const actor = op ? G.players[waiting.pid] : null;
    const validList = op && waiting.need ? RB.validTargets(G, actor) : [];
    const valid = new Set(validList.map(t => t.id));
    for (const p of G.players) {
      const c = cards[p.id];
      if (!c) continue;
      if (c.charId !== p.char.id) paintCardHead(p);
      const pct = Math.max(0, p.hp / p.maxHp * 100);
      c.fill.style.width = pct + '%';
      c.lag.style.width = pct + '%';
      c.fill.className = 'fill' + (pct <= 25 ? ' low' : pct <= 50 ? ' mid' : '');
      c.hp.textContent = `${Math.max(0, p.hp)} / ${p.maxHp}`;
      const oi = G.order.indexOf(p.id);
      c.ord.textContent = p.out ? '—' : (oi >= 0 ? `${oi + 1}番` : '');
      const stc = p.statuses.map(st => { const d = IDX.statuses[st.id] || {}; return `<span class="chip st" style="background:${esc(d.color || '#ccc')}" title="${esc(d.desc || '')}">${esc(d.icon || '')}${esc(d.name || st.id)}${st.turns > 0 ? `<small> ${st.turns}T</small>` : ''}</span>`; }).join('');
      const gd = p.gear && IDX.gears[p.gear.id];
      const gearChip = gd ? `<span class="chip ${gd.kind === 'bad' ? 'debuff' : 'buff'}" title="${esc(gd.desc || '')}">⚙${esc(gd.name)}${p.gear.turns > 0 ? `<small> ${p.gear.turns}T</small>` : ''}</span>` : '';
      const itemChip = p.item && !p.itemUsed ? `<span class="chip item" title="きりふだ: ${esc((IDX.items[p.item] || {}).name || '')}">🃏</span>` : '';
      const miss = p.misses && caresMisses(p.char) ? `<span class="chip">❌ミス${p.misses}</span>` : '';
      c.chips.innerHTML = stc + gearChip + modChips(p) + itemChip + miss + (p.hp <= 0 && !p.out ? '<span class="chip debuff">💫たおれかけ</span>' : '');
      const cl = c.el.classList;
      cl.toggle('current', !!cur && cur.id === p.id);
      cl.toggle('downed', p.hp <= 0 && !p.out);
      cl.toggle('out', p.out);
      cl.toggle('targetable', valid.has(p.id));
      cl.toggle('targeted', selectedTarget === p.id && !!cur);
      cl.toggle('winner', G.over && G.winners.includes(p.id));
      cl.toggle('me', role === 'guest' && p.id === guestPid);
    }
    const tb = $('#targetBar');
    if (validList.length > 1) {
      tb.hidden = false;
      tb.innerHTML = validList.map(t => {
        const pct = Math.max(0, Math.round(t.hp / t.maxHp * 100));
        return `<button type="button" class="tgt${selectedTarget === t.id ? ' on' : ''}" data-pid="${t.id}">${icon(t.char)}<span class="tn">${esc(t.name)}</span><span class="tbar"><i style="width:${pct}%"></i></span><span class="tp">${pct}%</span></button>`;
      }).join('');
    } else { tb.hidden = true; tb.innerHTML = ''; }
    $('#roundLbl').textContent = `ラウンド ${G.round}`;
    $('#orderStrip').innerHTML = G.order.map((id, i) => {
      const p = G.players[id];
      const cls = p.out ? 'done' : (i < G.ptr ? 'done' : (G.current === id ? 'now' : '')) + (p.hp <= 0 && !p.out ? ' downed' : '');
      return `<span class="o ${cls}">${icon(p.char)}${esc(p.name)}</span>`;
    }).join('');
    const now = $('#orderStrip .now');
    if (now && narrow()) now.scrollIntoView({ block: 'nearest', inline: 'center' });
    renderLog();
    const needOk = !op || !waiting.need || selectedTarget != null || validList.length === 0;
    $('#spinBtn').disabled = !op || !needOk;
    $('#spinBtn').textContent = op && waiting.mode === 'wake' ? '目覚めルーレット!' : 'スピン!';
    const ib = $('#itemBtn');
    ib.hidden = !(op && waiting.mode === 'spin' && waiting.canItem);
    ib.disabled = !needOk;
    if (!ib.hidden) ib.textContent = `🃏 きりふだ「${waiting.itemName}」を使う`;
  }

  function renderLog() {
    const box = $('#log');
    for (; logLen < G.log.length; logLen++) {
      const l = G.log[logLen];
      const d = document.createElement('div');
      d.className = 'l ' + (l.cls || '');
      d.textContent = l.text;
      box.appendChild(d);
    }
    box.scrollTop = box.scrollHeight;
  }

  function flushFx(list) {
    const per = {};
    let snd = null;
    for (const f of list || []) {
      const c = cards[f.pid];
      if (!c) continue;
      if (f.kind === 'transform') { c.el.classList.remove('evolve'); void c.el.offsetWidth; c.el.classList.add('evolve'); snd = 'win'; continue; }
      const k = per[f.pid] = (per[f.pid] || 0) + 1;
      const d = document.createElement('div');
      d.className = 'floater ' + f.kind;
      d.textContent = f.kind === 'dmg' ? (f.value > 0 ? '-' + f.value : '0') : f.kind === 'heal' ? '+' + f.value : f.value;
      d.style.top = (30 + (k - 1) * 18) + '%';
      d.style.animationDelay = ((k - 1) * 0.12) + 's';
      c.el.appendChild(d);
      setTimeout(() => d.remove(), 1600 + k * 120);
      if (f.kind === 'dmg' && f.value > 0) { c.el.classList.remove('shake'); void c.el.offsetWidth; c.el.classList.add('shake'); snd = snd || 'hit'; }
      if (f.kind === 'heal') snd = snd || 'heal';
      if (f.kind === 'ko' || f.kind === 'out') snd = 'ko';
    }
    if (snd) RBSound[snd]();
  }

  function showTurnHead(p, spins) {
    const ch = p.char;
    $('#turnHead').innerHTML = `${icon(ch)}<div style="text-align:left;min-width:0"><div class="who">${esc(p.name)}${p.cpu ? ' <span class="dim" style="font-size:12px">CPU</span>' : ''}${role === 'guest' && p.id === guestPid ? ' <span class="you-tag">あなた</span>' : ''}</div><div class="sub">${esc(ch.name)} ${elBadge(ch.element)} ${marks(ch)}${p.lastStand ? ' <b style="color:var(--bad)">💫最後の行動</b>' : ''}${spins > 1 ? ` <b style="color:var(--good)">⏩${spins}回行動</b>` : ''}</div></div>`;
  }

  function banner(html, color) {
    const b = $('#banner');
    b.innerHTML = html;
    b.style.borderColor = color || 'var(--accent)';
    b.classList.add('show');
  }
  function hideBanner() { $('#banner').classList.remove('show'); }

  // 表示コマンド: ホストはここを通すと参加者にも同じ表示が届く
  const V = {
    refresh: () => refresh(),
    turn: (a) => { const p = G.players[a.pid]; if (p) showTurnHead(p, a.spins); },
    wheel: (a) => { wheel.setSegments(a.segs); $('#wheelTitle').textContent = a.title || ''; },
    spin: (a) => wheel.spinTo(a.idx, a.dur),
    banner: (a) => banner(a.html, a.color),
    hide: () => hideBanner(),
    fx: (a) => flushFx(a.list),
    prompt: (a) => { $('#prompt').textContent = a.text || ''; },
    result: () => showResult(),
  };

  function snapshot() {
    return {
      round: G.round, ptr: G.ptr, order: G.order, current: G.current, over: G.over, winners: G.winners, outOrder: G.outOrder, turnCount: G.turnCount,
      players: G.players.map(p => ({
        id: p.id, name: p.name, charId: p.char.id, team: p.team, cpu: !!p.cpu, ctrl: p.ctrl && p.ctrl.startsWith('net:') ? 'net' : p.ctrl,
        hp: p.hp, maxHp: p.maxHp, statuses: p.statuses, mods: p.mods, out: p.out, downed: p.downed, lastStand: !!p.lastStand,
        misses: p.misses, kills: p.kills, dealt: p.dealt, taken: p.taken, gear: p.gear, item: p.item, itemUsed: p.itemUsed,
      })),
    };
  }

  // ホスト: 表示して参加者にも送る
  function pub(type, args) {
    const r = V[type](args || {});
    if (role === 'host' && G) {
      const logs = G.log.slice(sentLog);
      sentLog = G.log.length;
      RBNet.broadcast({ t: 'v', type, args: args || {}, snap: snapshot(), logs });
    }
    return r;
  }
  function pubFx() { const list = G.fx.splice(0); pub('fx', { list }); }

  // 参加者: ホストの状態を反映
  function applySnap(s, logs) {
    if (!G) return;
    Object.assign(G, { round: s.round, ptr: s.ptr, order: s.order, current: s.current, over: s.over, winners: s.winners, outOrder: s.outOrder || [], turnCount: s.turnCount });
    for (const sp of s.players) {
      const p = G.players[sp.id] || (G.players[sp.id] = {});
      Object.assign(p, sp);
      p.char = IDX.chars[sp.charId] || p.char;
      p.passive = RB.passiveOf(IDX, p.char);
    }
    if (logs && logs.length) G.log.push(...logs);
  }

  function guestStart(m) {
    guestPid = m.you;
    G = { data: DATA, idx: IDX, rules: RB.rules(DATA), players: [], order: [], log: [], fx: [], over: false, winners: [], outOrder: [] };
    applySnap(m.snap, m.logs);
    waiting = null; selectedTarget = null;
    showScreen('battle');
    if (!wheel) wheel = new RBWheel($('#wheel'));
    wheel.resize();
    buildBoard();
    $('#log').innerHTML = ''; logLen = 0;
    refresh();
    RBSound.unlock();
  }

  function guestView(m) {
    if (!G) return;
    applySnap(m.snap, m.logs);
    if (m.type === 'turn' && waiting) waiting = null;
    const f = V[m.type];
    if (f) f(m.args || {});
    if (m.type !== 'refresh') refresh();
  }

  // ===================== バトル: 進行 (ローカル / ホスト) =====================
  function startBattle(players) {
    lastSetupPlayers = players;
    try {
      G = RB.createGame(DATA, { players });
    } catch (e) { RBUI.alert('開始できません: ' + e.message); return; }
    G.players.forEach((p, i) => { p.ctrl = players[i].ctrl || (p.cpu ? 'cpu' : 'local'); });
    waiting = null; remoteWait = null; selectedTarget = null; sentLog = 0;
    showScreen('battle');
    if (!wheel) wheel = new RBWheel($('#wheel'));
    wheel.resize();
    buildBoard();
    $('#log').innerHTML = ''; logLen = 0;
    if (role === 'host') {
      const snap = snapshot();
      const logs = G.log.slice(0); sentLog = G.log.length;
      for (const p of G.players) if (p.ctrl.startsWith('net:')) RBNet.send(p.ctrl.slice(4), { t: 'start', you: p.id, snap, logs });
      // 観戦 (キャラを選んでいない参加者) はいないが、念のため全員に送る
      for (const id of RBNet.guestIds) if (!G.players.some(p => p.ctrl === 'net:' + id)) RBNet.send(id, { t: 'start', you: -1, snap, logs });
    }
    pubFx(); pub('refresh');
    const my = ++runId;
    paused = false; $('#pauseBtn').textContent = '⏸';
    loop(my);
  }

  async function waitCpu(p) {
    pub('prompt', { text: `🤖 ${p.name} が考え中…` });
    await sleep(SP().think);
    while (paused) { $('#prompt').textContent = '⏸ 一時停止中 (右上の ▶ で再開)'; await sleep(150); }
  }

  // 操作を待つ。戻り値 { action: 'spin' | 'item', target }
  async function getInput(p, o) {
    const cpuChoice = () => ({ action: o.mode === 'spin' && RB.cpuWantsItem(G, p) ? 'item' : 'spin', target: o.need ? RB.cpuPickTarget(G, p) : null });
    const ctrl = p.ctrl || (p.cpu ? 'cpu' : 'local');
    if (ctrl === 'cpu') { await waitCpu(p); return cpuChoice(); }
    const itemName = p.item ? ((IDX.items[p.item] || {}).name || '') : '';
    if (ctrl.startsWith('net:')) {
      const conn = ctrl.slice(4);
      pub('prompt', { text: `🌐 ${p.name} さんの操作を待っています…` });
      RBNet.send(conn, { t: 'await', pid: p.id, mode: o.mode, need: o.need, canItem: o.canItem, itemName, prompt: o.prompt, target: selectedTarget });
      return new Promise((resolve) => {
        remoteWait = {
          pid: p.id, conn,
          resolve: (v) => { remoteWait = null; resolve(v); },
          fallback: () => { remoteWait = null; resolve(cpuChoice()); },
        };
      });
    }
    // この端末の人
    pub('prompt', { text: o.prompt });
    if (narrow()) { const tp = $('#turnPanel'); const top = tp.getBoundingClientRect().top; if (top < 0 || top > window.innerHeight * 0.5) tp.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    return new Promise((resolve) => {
      waiting = { pid: p.id, need: o.need, canItem: o.canItem, mode: o.mode, itemName, resolve: (v) => { waiting = null; resolve(v); } };
      refresh();
    });
  }

  // この端末のボタン操作
  function pressAction(action) {
    if (!canOperate()) return;
    const w = waiting;
    const valid = w.need ? RB.validTargets(G, G.players[w.pid]) : [];
    if (w.need && valid.length && selectedTarget == null) return;
    const target = w.need ? selectedTarget : null;
    RBSound.unlock();
    if (w.remote) { RBNet.sendHost({ t: 'input', pid: w.pid, action, target }); waiting = null; $('#prompt').textContent = ''; refresh(); return; }
    w.resolve({ action, target });
    refresh();
  }

  async function loop(my) {
    while (!dead(my) && !G.over) {
      try { await playTurn(my); }
      catch (e) { console.error(e); RB.log(G, '⚠ エラー: ' + e.message, 'bad'); pub('refresh'); try { RB.endTurn(G); } catch (e2) { break; } }
    }
    if (!dead(my) && G.over) { pub('refresh'); RBSound.win(); await sleep(SP().after * 1.5); if (!dead(my)) pub('result'); }
  }

  async function playTurn(my) {
    pub('hide');
    selectedTarget = null;
    const st = RB.startTurn(G);
    if (!st) { pub('refresh'); return; }
    const p = st.player;
    pub('turn', { pid: p.id, spins: st.spins });
    pubFx(); pub('refresh');

    if (st.wake) {
      const ch = st.wake.chance;
      pub('wheel', { title: `${st.wake.icon} 目覚めルーレット`, segs: [
        { label: 'めざめる!', sub: ch + '%', weight: Math.max(1, ch), color: '#ffd84a' },
        { label: `${st.wake.name}のまま`, sub: (100 - ch) + '%', weight: Math.max(1, 100 - ch), color: '#55607a' },
      ] });
      await getInput(p, { mode: 'wake', need: false, canItem: false, prompt: `${st.wake.icon} ${st.wake.name}状態… 目覚めルーレットを回そう` });
      if (dead(my)) return;
      const woke = RB.rollWake(G, p, st.wake);
      await pub('spin', { idx: woke ? 0 : 1, dur: SP().spin * 0.7 });
      if (dead(my)) return;
      pub('banner', woke ? { html: '<div class="mv">☀ めざめた!</div>', color: '#ffd84a' } : { html: `<div class="mv">${esc(st.wake.icon)} ${esc(st.wake.name)}…</div><div class="kd">動けない</div>`, color: '#55607a' });
      pub('refresh');
      await sleep(SP().banner);
      pub('hide');
      if (!woke) { RB.endTurn(G); pubFx(); pub('refresh'); await sleep(SP().after * 0.6); return; }
    }

    let spins = st.spins, chain = 0, n = 0;
    while (spins > 0 && RB.canKeepActing(p) && !G.over) {
      spins--; n++;
      pub('wheel', { segs: rbWheelSegments(RB.wheelFor(G, p, 'char')), title: '' });
      const canItem = RB.canUseItem(G, p);
      const valid = RB.validTargets(G, p);
      const need = (RB.needsTarget(G, p, 'char') || (canItem && RB.needsTarget(G, p, 'item'))) && valid.length > 0;
      if (need && valid.length === 1) selectedTarget = valid[0].id;
      else if (selectedTarget != null && !valid.some(t => t.id === selectedTarget)) selectedTarget = null;
      const head = n > 1 ? (chain > 0 && spins === 0 ? '🔁 もう一回! ' : `⏩ ${n}回目の行動! `) : '';
      const inp = await getInput(p, { mode: 'spin', need, canItem, prompt: head + (need ? '攻撃する相手を選んで「スピン!」' : '「スピン!」でルーレットを回そう') });
      if (dead(my)) return;
      selectedTarget = inp.target != null && valid.some(t => t.id === inp.target) ? inp.target : (need ? RB.cpuPickTarget(G, p) : null);
      let src = 'char';
      if (inp.action === 'item' && RB.canUseItem(G, p)) {
        src = 'item';
        const it = IDX.items[p.item];
        pub('wheel', { segs: rbWheelSegments(RB.wheelFor(G, p, 'item')), title: `🃏 きりふだ「${it.name}」` });
        pub('banner', { html: `<div class="mv">🃏 ${esc(it.name)}!</div><div class="kd">1回だけのきりふだ</div>`, color: it.color || '#ffcf3a' });
        await sleep(SP().banner);
        pub('hide');
      }
      pub('prompt', { text: '' });
      pub('refresh');
      const segs = RB.wheelFor(G, p, src);
      const idx = RB.rollSpin(G, p, src);
      await pub('spin', { idx, dur: SP().spin });
      if (dead(my)) return;
      const seg = segs[idx];
      const r = RB.act(G, p, idx, selectedTarget, src);
      const kind = seg.disabledBy ? 'miss' : seg.kind;
      const kname = seg.disabledBy ? `${seg.disabledBy}で不発!` : (RB.MOVE_KINDS[kind] || {}).name;
      pub('banner', { html: `<div class="mv" style="color:${esc(seg.disabledBy ? '#aaa' : (kind === 'attack' ? '#fff' : seg.color))}">${esc(seg.move.name)}</div><div class="kd">${esc(kname)}${kind === 'attack' && seg.power ? ' ・ 威力 ' + seg.power : ''}</div>`, color: seg.disabledBy ? '#666' : seg.color });
      if (kind === 'miss') RBSound.miss();
      pubFx(); pub('refresh');
      await sleep(Math.max(SP().banner, SP().after));
      pub('hide');
      if (dead(my)) return;
      if (r.spinAgain && chain < RB.num(G.rules.maxSpinChain) && RB.canKeepActing(p)) {
        chain++; spins++;
        RB.log(G, '🔁 もう一回!', 'sys');
        pub('banner', { html: '<div class="mv">🔁 もう一回!</div>' });
        pub('refresh');
        await sleep(SP().banner * 0.8);
        pub('hide');
      }
    }

    // ギア: キャラのルーレットの後に自動で回る
    if (RB.hasGear(G, p) && RB.canKeepActing(p) && !G.over) {
      const gd = IDX.gears[p.gear.id];
      const segs = RB.wheelFor(G, p, 'gear');
      pub('wheel', { segs: rbWheelSegments(segs), title: `⚙ ギア「${gd.name}」` });
      pub('prompt', { text: `⚙ ${p.name} のギアが回る!` });
      await sleep(SP().think);
      if (dead(my)) return;
      const tid = selectedTarget != null && RB.validTargets(G, p).some(t => t.id === selectedTarget) ? selectedTarget : RB.cpuPickTarget(G, p);
      const idx = RB.rollSpin(G, p, 'gear');
      await pub('spin', { idx, dur: SP().spin * 0.6 });
      if (dead(my)) return;
      RB.act(G, p, idx, tid, 'gear');
      pub('banner', { html: `<div class="mv">⚙ ${esc(segs[idx].move.name)}</div><div class="kd">ギア「${esc(gd.name)}」</div>`, color: gd.color || '#9fb4c8' });
      pubFx(); pub('prompt', { text: '' }); pub('refresh');
      await sleep(Math.max(SP().banner, SP().after) * 0.8);
      pub('hide');
    }
    RB.endTurn(G);
    pubFx(); pub('refresh');
    await sleep(SP().after * 0.6);
  }

  // ===================== 結果 =====================
  function showResult() {
    showScreen('result');
    const ws = G.winners.map(id => G.players[id]);
    $('#resTitle').textContent = ws.length ? (ws[0].team ? `チーム${TEAM_NAMES[ws[0].team]} の勝利!` : `${ws[0].name} の勝利!`) : '引き分け!';
    $('#resIcon').innerHTML = ws.length ? icon(ws[0].char, 'ico huge') : '🏳';
    const rank = RB.ranking(G);
    $('#resRank').innerHTML = rank.map((p, i) => `<div class="rank${G.winners.includes(p.id) ? ' first' : ''}${role === 'guest' && p.id === guestPid ? ' me' : ''}">
      <div class="pos">${G.winners.includes(p.id) ? '👑' : i + 1}</div>${icon(p.char)}
      <div class="rn"><b>${esc(p.name)}</b> <span class="dim">${esc(p.char.name)}</span>${p.team ? ` <span class="team-tag badge" style="background:${TEAM_COLORS[p.team]};color:#111">${TEAM_NAMES[p.team]}</span>` : ''}</div>
      <div class="stat">撃破 ${p.kills} ・ 与ダメ ${p.dealt} ・ 被ダメ ${p.taken}</div></div>`).join('')
      + `<div class="dim" style="margin-top:8px;font-size:13px">${G.round} ラウンド / ${G.turnCount} ターン</div>`;
    const guest = role === 'guest';
    $('#againBtn').hidden = guest;
    $('#backBtn').hidden = guest;
    $('#guestWait').hidden = !guest;
    $('#leaveBtn2').hidden = !guest;
  }

  function showLogModal() {
    const m = $('#modal');
    m.innerHTML = `<div class="panel modal"><button type="button" class="close icon" id="mClose" aria-label="閉じる">✕</button><h3 style="margin-top:0">バトルログ</h3><div class="logbox" style="max-height:70vh">${G.log.map(l => `<div class="l ${l.cls || ''}">${esc(l.text)}</div>`).join('')}</div></div>`;
    m.hidden = false;
    $('#mClose').onclick = closeModal;
    m.onclick = (e) => { if (e.target === m) closeModal(); };
  }

  function backToSetup() {
    runId++; waiting = null; remoteWait = null; G = null;
    showScreen('setup');
    loadData(); renderSetup();
    if (role === 'host') { RBNet.broadcast({ t: 'toLobby' }); sendLobby(); }
  }

  async function quitBattle() {
    if (role === 'guest') { await leaveRoom(); return; }
    if (!(await RBUI.confirm(role === 'host' ? 'バトルを終了してセットアップに戻りますか? (参加者もロビーに戻ります)' : 'バトルを終了してセットアップに戻りますか?', { ok: '終了する', danger: true }))) return;
    backToSetup();
  }

  // ===================== 外部 (app.js) から =====================
  function onShow() {
    if (!$('#battle').hidden || role === 'guest') return;
    loadData();
    if (!$('#setup').hidden) renderSetup();
    if (role === 'host') for (const np of netPlayers) RBNet.send(np.id, { t: 'data', data: DATA });
  }

  function onData(ev) {
    if (role === 'guest') return;
    if ((ev.why === 'remote' || ev.why === 'initial') && !$('#setup').hidden) {
      loadData(); renderSetup();
      if (role === 'host') for (const np of netPlayers) RBNet.send(np.id, { t: 'data', data: DATA });
      if (ev.why === 'remote') RBUI.toast('別の端末での変更を読み込みました');
    }
  }

  // ===================== 初期化 =====================
  function init() {
    loadData(); loadSetup(); renderSetup();
    $('#cntMinus').onclick = () => setCount(totalPlayers() - 1);
    $('#cntPlus').onclick = () => setCount(totalPlayers() + 1);
    $('#teamMode').onchange = (e) => { setup.teamMode = e.target.checked; saveSetup(); renderSetup(); };
    $('#allRandom').onclick = () => { setup.players.forEach(p => { p.charId = ''; }); saveSetup(); renderSetup(); };
    $('#allCpu').onclick = () => { setup.players.forEach((p, i) => { p.cpu = i > 0; }); saveSetup(); renderSetup(); };
    $('#allHuman').onclick = () => { setup.players.forEach((p) => { p.cpu = false; }); saveSetup(); renderSetup(); };
    $('#startBtn').onclick = onStart;
    $('#startBtn2').onclick = onStart;
    $('#importBtn').onclick = () => $('#importFile').click();
    $('#importFile').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const d = await RBStore.readFile(f);
        if (!(await RBUI.confirm(`「${f.name}」を読み込みます。今のデータ (キャラ・技など) は置き換わります。`, { ok: '読み込む' }))) return;
        RBStore.save(d); loadData(); renderSetup();
        if (role === 'host') for (const np of netPlayers) RBNet.send(np.id, { t: 'data', data: DATA });
        RBUI.toast('読み込みました');
      } catch (err) { RBUI.alert(err.message); }
    };
    $('#leaveBtn').onclick = leaveRoom;
    $('#leaveBtn2').onclick = leaveRoom;

    try { speed = localStorage.getItem('rouletteBattle.speed') || 'normal'; } catch (e) { /* noop */ }
    $('#speedSel').value = speed;
    $('#speedSel').onchange = (e) => { speed = e.target.value; try { localStorage.setItem('rouletteBattle.speed', speed); } catch (er) { /* noop */ } };
    const sb = $('#soundBtn');
    sb.textContent = RBSound.enabled ? '🔊' : '🔇';
    sb.onclick = () => { RBSound.enabled = !RBSound.enabled; sb.textContent = RBSound.enabled ? '🔊' : '🔇'; };
    $('#pauseBtn').onclick = () => { paused = !paused; $('#pauseBtn').textContent = paused ? '▶' : '⏸'; };
    $('#spinBtn').onclick = () => pressAction('spin');
    $('#itemBtn').onclick = () => pressAction('item');
    $('#targetBar').onclick = (e) => { const b = e.target.closest('[data-pid]'); if (b) selectTarget(+b.dataset.pid); };
    document.addEventListener('keydown', (e) => {
      if ($('#battle').hidden || !$('#modal').hidden || (window.RBApp && RBApp.mode !== 'play')) return;
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if ((e.key === ' ' || e.key === 'Enter') && !$('#spinBtn').disabled) { e.preventDefault(); pressAction('spin'); }
    });
    $('#quitBtn').onclick = quitBattle;
    $('#againBtn').onclick = () => { loadData(); startBattle(role === 'host' ? resolvePlayers() : lastSetupPlayers.map(p => Object.assign({}, p))); };
    $('#backBtn').onclick = backToSetup;
    $('#showLogBtn').onclick = showLogModal;
    try { if (window.matchMedia('(max-width: 560px)').matches) $('#logWrap').open = false; } catch (e) { /* noop */ }
    window.addEventListener('resize', () => { if (wheel && !$('#battle').hidden) wheel.resize(); });
    window.addEventListener('beforeunload', (e) => { if (role !== 'local') { e.preventDefault(); e.returnValue = ''; } });
    if (roomFromUrl()) setTimeout(() => { const i = $('#joinName'); if (i) i.focus(); }, 300);
  }

  init();
  return { onShow, onData, get role() { return role; } };
})();
