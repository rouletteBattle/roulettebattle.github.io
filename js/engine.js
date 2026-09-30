/* ルーレットバトル エンジン (DOM 非依存。index.html と tools の QuickJS 検証で共用) */
var RB = (function () {
  'use strict';
  const RB = {};

  // ===================== 定義メタ (エディタとエンジンで共有) =====================
  RB.MOVE_KINDS = {
    attack:  { name: '攻撃', color: '#f1f1f1' },
    status:  { name: '変化', color: '#b27cf2' },
    guard:   { name: '防御', color: '#5aa9f0' },
    heal:    { name: '回復', color: '#5fd38a' },
    special: { name: '特殊', color: '#ffc93a' },
    miss:    { name: 'ミス', color: '#e0525a' },
  };

  RB.MOVE_TARGETS = {
    single:      '選んだ相手',
    randomEnemy: 'ランダムな敵',
    randomAny:   'ランダム (自分含む全員から)',
    allEnemies:  '敵全体',
    group:       '条件に合う敵全員 (●/★・属性・タイプ)',
    self:        '自分',
    allies:      '味方全体(自分含む)',
    everyone:    '全員(自分含む)',
  };

  RB.EFFECT_TO = {
    target:      '技の対象',
    self:        '自分',
    attacker:    '攻撃してきた相手 (被弾時)',
    randomEnemy: 'ランダムな敵',
    randomAny:   'ランダム (自分含む)',
    allEnemies:  '敵全体',
    allies:      '味方全体',
    everyone:    '全員',
  };

  RB.MOD_STATS = {
    atkFlat:      { name: '攻撃力 +',            short: '攻', unit: '' },
    atkPct:       { name: '攻撃力 %',            short: '攻', unit: '%' },
    nextPower:    { name: '次の攻撃の威力 +',     short: 'ため', unit: '' },
    defFlat:      { name: '防御 (被ダメ −)',      short: '防', unit: '' },
    dmgTakenPct:  { name: '被ダメージ %',         short: '被ダメ', unit: '%' },
    barrier:      { name: 'バリア (吸収量)',       short: 'バリア', unit: '' },
    nullifyBelow: { name: 'N以下のダメージ無効',    short: '無効≤', unit: '' },
    guard:        { name: '攻撃無効 (回数)',       short: '🛡', unit: '回' },
    reflectPct:   { name: '受けたダメージを反射 %', short: '反射', unit: '%' },
    critPct:      { name: '会心率 % (1.5倍ダメージ)', short: '会心', unit: '%' },
    evadePct:     { name: '回避率 % (攻撃をかわす)', short: '回避', unit: '%' },
    endure:       { name: 'こらえる (HP1で耐える回数)', short: '根性', unit: '回' },
    regen:        { name: '毎ターン回復', short: '再生', unit: '' },
    thorns:       { name: 'トゲ (攻撃してきた相手にダメージ)', short: 'トゲ', unit: '' },
    lifestealPct: { name: '吸収 % (与ダメの%回復)', short: '吸収', unit: '%' },
    missWeightPct:{ name: 'ミスの大きさ % (+で不運・−で幸運)', short: 'ミス', unit: '%' },
    healBlock:    { name: '回復封じ', short: '回復封', unit: '' },
    taunt:        { name: '挑発 (敵は自分しか狙えない)', short: '挑発', unit: '' },
    stealth:      { name: '隠れ身 (狙われない)', short: '隠れ', unit: '' },
    speed:        { name: 'すばやさ +', short: '速', unit: '' },
    extraSpins:   { name: '行動回数 + (2回行動)',  short: '連続', unit: '回' },
    luck:         { name: 'ミス回避 (回数)',       short: '🍀', unit: '回' },
  };
  // 「逆転」で符号を反転できる能力 (回数系は反転しない)
  RB.INVERTIBLE = ['atkFlat', 'atkPct', 'nextPower', 'defFlat', 'dmgTakenPct', 'reflectPct', 'critPct', 'evadePct', 'regen', 'thorns', 'lifestealPct', 'missWeightPct', 'speed'];
  // 値が大きいほど「不利」な能力
  RB.BAD_WHEN_POSITIVE = ['dmgTakenPct', 'missWeightPct', 'healBlock'];

  RB.TRIGGERS = {
    passive:     '常時 (パッシブのみ)',
    battleStart: 'バトル開始時',
    turnStart:   '自分のターン開始時',
    turnEnd:     '自分のターン終了時',
    onSpin:      'ルーレットが止まった時',
    onAttack:    '攻撃を当てた時',
    onHit:       '攻撃を受けた時',
    onLowHp:     'HPが一定以下になった時',
    onKO:        '相手を倒した時',
    onDowned:    '自分が倒れた時',
  };

  // 威力が増える条件 (威力 + 1あたり × 数)
  RB.SCALE_BY = {
    misses:         '自分がミスを引いた回数',
    uses:           'この技を使った回数 (使うほど強く)',
    round:          '今のラウンド数',
    kills:          '自分が倒した人数',
    lostHp:         '自分が失ったHP10ごと',
    enemies:        '生き残っている敵の数',
    targetStatuses: '相手の状態異常の数',
  };

  RB.MARKS = { dot: '●', star: '★' };

  RB.GEAR_POOL = { good: '良いギア', bad: '悪いギア', any: 'すべて' };
  RB.ITEM_MODES = { random: '全員にランダムで配る', choose: 'セットアップで選ぶ (空欄はランダム)', off: '使わない' };

  RB.HP_CHAOS = { shuffle: '全員のHP割合をシャッフル', average: '全員のHP割合を平均にそろえる' };
  RB.RANDOM_POOL = { all: 'ゲーム中のすべての技', others: '自分のルーレットにない技' };
  RB.EFFECT_LINK = { '': '(常に判定)', then: '直前の効果が発動したときだけ', else: '直前の効果が発動しなかったときだけ' };

  // エフェクト定義: params = [key, label, kind]。once = 対象ごとではなく1回だけ処理
  const DMG_PARAMS = [['power', '威力', 'num'], ['element', '属性(空=キャラの属性)', 'element'], ['hits', '回数', 'num'],
    ['markBonus', '相手が●/★のときの追加威力', 'markBonus'], ['elemBonus', '相手の属性ごとの追加威力', 'elemBonus'], ['typeBonus', '相手のタイプごとの追加威力', 'typeBonus'],
    ['scaleBy', '威力が増える条件', 'scaleBy'], ['scalePer', '1あたりの威力+', 'num'], ['scaleMax', '増える威力の上限', 'num'],
    ['pctHp', '相手の現在HPの%ダメージ', 'num'],
    ['fixed', '固定ダメージ(補正なし)', 'bool'], ['ignoreDef', '防御無視', 'bool'], ['pierce', 'バリア/無効を貫通', 'bool'],
    ['drainPct', '与ダメの%回復', 'num'], ['recoilPct', '与ダメの%反動', 'num']];
  RB.EFFECTS = {
    damage:         { name: 'ダメージ', params: DMG_PARAMS },
    heal:           { name: '回復', params: [['amount', '回復量', 'num'], ['pct', '最大HPの%', 'num'], ['ofDamagePct', '与えたダメージの%', 'num']] },
    status:         { name: '状態異常にする', params: [['status', '状態異常', 'status'], ['turns', 'ターン数(空=既定)', 'num']] },
    cure:           { name: '状態異常を治す', params: [['status', '状態異常(空=すべて)', 'status']] },
    mod:            { name: 'バフ/デバフ', params: [['stat', '能力', 'stat'], ['value', '値 (マイナスでデバフ)', 'num'], ['turns', 'ターン数(0=永続/消費まで)', 'num']] },
    clearMods:      { name: 'バフ/デバフ解除', params: [['which', '対象', 'clearWhich']] },
    invertMods:     { name: 'あべこべ (バフとデバフを反転)', params: [] },
    stealMods:      { name: 'バフを奪う', params: [] },
    transferStatus: { name: '自分の状態異常を押し付ける', params: [['status', '状態異常(空=すべて)', 'status']] },
    hpSwap:         { name: 'HP割合を入れ替える', params: [] },
    hpChaos:        { name: '全員のHPを混ぜる (大波乱)', params: [['mode', '方法', 'hpChaos']], once: true },
    randomMove:     { name: 'ランダムな技を使う', params: [['pool', '候補', 'randomPool']], once: true },
    mimic:          { name: '相手が最後に使った技をまねる', params: [], once: true },
    transform:      { name: '進化・変身 (キャラが変わる)', params: [['char', '変わった後のキャラ', 'char']] },
    attachGear:     { name: 'ギアをつける', params: [['gear', 'ギア (空=候補からランダム)', 'gear'], ['pool', '候補', 'gearPool']] },
    removeGear:     { name: 'ギアを外す', params: [] },
    spinAgain:      { name: 'もう一回ルーレット', params: [], once: true },
  };
  RB.CLEAR_WHICH = { buffs: '有利な効果', debuffs: '不利な効果', all: 'すべて' };

  RB.CONDS = [
    ['selfHpBelowPct', '自分のHPが%以下', 'num'],
    ['selfHpAbovePct', '自分のHPが%以上', 'num'],
    ['targetHpBelowPct', '相手のHPが%以下', 'num'],
    ['targetElement', '相手の属性が', 'element'],
    ['targetType', '相手のタイプが', 'type'],
    ['targetStatus', '相手が状態異常 (any=何か)', 'statusAny'],
    ['selfStatus', '自分が状態異常 (any=何か)', 'statusAny'],
    ['targetMark', '相手が ● / ★', 'mark'],
    ['selfMark', '自分が ● / ★', 'mark'],
    ['missesAtLeast', 'ミスを引いた回数がN以上', 'num'],
    ['aliveAtMost', '生存人数がN人以下', 'num'],
    ['roundAtLeast', 'ラウンドN以降', 'num'],
    ['moveKind', '引いた技の種類が (onSpin用)', 'moveKind'],
    ['dealtAtLeast', '与えた/受けたダメージがN以上', 'num'],
  ];

  RB.PROTECT_MODES = {
    lastStand: '最後の行動保証 (倒れても自分のターンで最後の行動ができる)',
    firstTurn: '初回ターン保証 (1回目の行動まではHP1で耐える)',
    none:      'なし (HP0で即脱落)',
  };
  RB.ORDER_MODES = { speed: 'すばやさが高い順 (同じならランダム)', seat: '席順', random: '毎ラウンドランダム' };
  RB.DISABLE_MODES = { random: 'ランダム', smallest: '一番小さい区画', largest: '一番大きい区画', strongest: '一番威力が高い技' };

  RB.DEFAULT_RULES = {
    hpScalePerPlayer: 15,   // 3人目以降、1人増えるごとに HP +15%
    protect: 'lastStand',
    orderBy: 'speed',
    maxSpinChain: 2,        // 1ターンに「もう一回」できる最大回数
    maxExtraSpins: 2,       // 2回行動系で増える行動回数の上限
    aoeFalloff: 6,          // 全体技: 対象が1人増えるごとに威力 -6%
    aoeFloor: 50,           // 全体技の下限 %
    suddenDeathRound: 8,    // このラウンドから与ダメ上昇 (0=なし)
    suddenDeathPct: 25,     // 1ラウンドごとに +%
    maxRounds: 60,          // 打ち切り (HP割合で順位)
    itemMode: 'random',     // きりふだの配り方
    dotLabel: '●', starLabel: '★',
  };

  // ===================== 汎用 =====================
  RB.clone = (o) => JSON.parse(JSON.stringify(o));
  const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(+v)) ? (d || 0) : +v;
  const has = (v) => v !== undefined && v !== null && v !== '';
  RB.num = num; RB.has = has;

  RB.index = function (data) {
    const m = {};
    for (const k of ['chars', 'moves', 'abilities', 'statuses', 'elements', 'types', 'gears', 'items']) {
      m[k] = {};
      for (const x of (data[k] || [])) m[k][x.id] = x;
    }
    return m;
  };

  RB.rules = function (data) { return Object.assign({}, RB.DEFAULT_RULES, (data && data.rules) || {}); };

  RB.hpMultiplier = function (rules, n) {
    return 1 + Math.max(0, n - 2) * num(rules.hpScalePerPlayer) / 100;
  };

  // (任意) 属性相性の倍率。初期データでは使っていない
  RB.elementMult = function (data, atk, def) {
    const row = (data.chart || {})[atk];
    if (!row || !has(row[def])) return 1;
    return num(row[def], 1);
  };

  RB.elemBonusOf = function (opts, elementId) {
    const eb = opts && opts.elemBonus;
    return eb && has(eb[elementId]) ? num(eb[elementId]) : 0;
  };
  RB.typeBonusOf = function (opts, typeId) {
    const tb = opts && opts.typeBonus;
    return tb && typeId && has(tb[typeId]) ? num(tb[typeId]) : 0;
  };
  // 相手に対する追加威力の合計 (属性 + タイプ)
  RB.markBonusOf = function (opts, mark) {
    const mb = opts && opts.markBonus;
    return mb && mark && has(mb[mark]) ? num(mb[mark]) : 0;
  };
  RB.bonusVs = (opts, d) => RB.elemBonusOf(opts, d.char.element) + RB.typeBonusOf(opts, d.char.type) + RB.markBonusOf(opts, d.char.mark);
  RB.markLabel = (data, mark) => mark === 'dot' ? ((data.rules && data.rules.dotLabel) || '●') : mark === 'star' ? ((data.rules && data.rules.starLabel) || '★') : '';

  // ルーレット区画を作る (キャラ・ギア・きりふだ共通)
  RB.buildWheel = function (idx, list) {
    const segs = [];
    for (const [i, e] of (list || []).entries()) {
      const mv = idx.moves[e.move];
      if (!mv) continue;
      const w = num(e.weight, 0);
      if (w <= 0) continue;
      const power = has(e.power) ? num(e.power) : num(mv.power);
      const kind = mv.kind || 'attack';
      segs.push({
        slot: i, moveId: mv.id, move: mv, weight: w, power, kind,
        label: mv.name + (kind === 'attack' && power > 0 ? ' ' + power : ''),
        color: mv.color || (RB.MOVE_KINDS[kind] || RB.MOVE_KINDS.attack).color,
      });
    }
    return segs;
  };
  // キャラのルーレット区画 (状態異常による無効化は含まない)
  RB.charWheel = (data, idx, ch) => RB.buildWheel(idx, ch.moves);

  // 全能力 (パッシブ) を合算
  RB.passiveOf = function (idx, ch) {
    const p = { atkFlat: 0, atkPct: 0, defFlat: 0, dmgTakenPct: 0, hpPct: 0, nullifyBelow: 0, statusChanceBonus: 0, healPct: 0, immune: [], resist: {} };
    const type = idx.types[ch.type];
    if (type) {
      for (const k of ['atkFlat', 'atkPct', 'defFlat', 'hpPct', 'statusChanceBonus', 'healPct']) p[k] += num(type[k]);
    }
    for (const aid of (ch.abilities || [])) {
      const ab = idx.abilities[aid];
      if (!ab || !ab.passive) continue;
      const ps = ab.passive;
      for (const k of ['atkFlat', 'atkPct', 'defFlat', 'dmgTakenPct', 'hpPct', 'statusChanceBonus', 'healPct']) p[k] += num(ps[k]);
      p.nullifyBelow = Math.max(p.nullifyBelow, num(ps.nullifyBelow));
      for (const s of (ps.immune || [])) if (!p.immune.includes(s)) p.immune.push(s);
      for (const [el, m] of Object.entries(ps.resist || {})) if (has(m)) p.resist[el] = (p.resist[el] || 1) * num(m, 1);
    }
    return p;
  };

  // 1スピンあたりの期待ダメージ (エディタ表示用, 単体攻撃の基本威力のみ)
  RB.wheelStats = function (data, ch) {
    const idx = RB.index(data);
    const segs = RB.charWheel(data, idx, ch);
    const total = segs.reduce((a, s) => a + s.weight, 0);
    let exp = 0, miss = 0;
    for (const s of segs) {
      if (s.kind === 'attack') exp += s.power * Math.max(1, num(s.move.hits, 1)) * s.weight;
      if (s.kind === 'miss') miss += s.weight;
    }
    return { total, expected: total ? exp / total : 0, missRate: total ? miss / total : 0, segs };
  };

  // ===================== ゲーム生成 =====================
  /*
   setup = { players: [{ name, charId, cpu, team }] }
   opts  = { rng }
  */
  RB.createGame = function (data, setup, opts) {
    opts = opts || {};
    const idx = RB.index(data);
    const rules = RB.rules(data);
    const n = setup.players.length;
    const hpMult = RB.hpMultiplier(rules, n);
    const g = {
      data, idx, rules, rng: opts.rng || Math.random,
      round: 0, ptr: 0, order: [], players: [], log: [], fx: [],
      over: false, winners: [], hpMult, turnCount: 0, current: null, depth: 0, sdMult: 1,
      outOrder: [],
    };
    setup.players.forEach((sp, i) => {
      const ch = idx.chars[sp.charId];
      if (!ch) throw new Error('キャラが見つかりません: ' + sp.charId);
      const passive = RB.passiveOf(idx, ch);
      const maxHp = Math.max(1, Math.round(num(ch.baseHp, 100) * hpMult * (1 + passive.hpPct / 100)));
      g.players.push({
        id: i, name: sp.name || ('P' + (i + 1)), charId: ch.id, char: ch, team: num(sp.team), cpu: !!sp.cpu,
        passive, maxHp, hp: maxHp, statuses: [], mods: [], downed: false, out: false, acted: false,
        once: {}, lowFired: {}, kills: 0, dealt: 0, taken: 0, seat: i,
        misses: 0, uses: {}, lastMove: null,
        gear: null, item: RB.pickItem(data, rules, sp, opts.rng || Math.random), itemUsed: false,
      });
    });
    RB.log(g, `⚔ バトル開始! ${n}人 / HP倍率 ×${hpMult.toFixed(2)}`, 'sys');
    RB.newRound(g);
    for (const p of g.players) RB.fire(g, p, 'battleStart', {});
    return g;
  };

  // きりふだの配布: sp.item = ID / '' (おまかせ) / 'none'
  RB.pickItem = function (data, rules, sp, rng) {
    const items = (data.items || []).filter(it => (it.moves || []).length);
    if (rules.itemMode === 'off' || !items.length || sp.item === 'none') return null;
    if (rules.itemMode === 'choose' && sp.item && items.some(it => it.id === sp.item)) return sp.item;
    return items[Math.floor(rng() * items.length)].id;
  };

  RB.log = function (g, text, cls) { g.log.push({ text, cls: cls || '', round: g.round }); };
  RB.fxPush = function (g, pid, kind, value) { g.fx.push({ pid, kind, value }); };

  RB.speed = (p) => num(p.char.speed, 3) + RB.sumMod(p, 'speed');
  RB.alive = (p) => !p.out && p.hp > 0;
  RB.isEnemy = (a, b) => a.id !== b.id && (a.team === 0 || a.team !== b.team);
  RB.enemiesOf = (g, p) => g.players.filter(q => RB.alive(q) && RB.isEnemy(p, q));
  RB.alliesOf = (g, p) => g.players.filter(q => RB.alive(q) && (q.id === p.id || (p.team !== 0 && q.team === p.team)));
  const pick = (g, arr) => arr.length ? arr[Math.floor(g.rng() * arr.length)] : null;

  RB.newRound = function (g) {
    g.round++;
    const list = g.players.filter(p => !p.out);
    const mode = g.rules.orderBy;
    if (mode === 'seat') list.sort((a, b) => a.seat - b.seat);
    else {
      const r = new Map(list.map(p => [p.id, g.rng()]));
      if (mode === 'random') list.sort((a, b) => r.get(a.id) - r.get(b.id));
      else list.sort((a, b) => (RB.speed(b) - RB.speed(a)) || (r.get(a.id) - r.get(b.id)));
    }
    g.order = list.map(p => p.id);
    g.aim = {};   // このラウンドに CPU が誰を何回狙ったか
    g.ptr = 0;
    const sdr = num(g.rules.suddenDeathRound);
    if (sdr > 0 && g.round >= sdr) {
      g.sdMult = 1 + (g.round - sdr + 1) * num(g.rules.suddenDeathPct) / 100;
      RB.log(g, `── ラウンド ${g.round} ── 🔥サドンデス: 与ダメージ ×${g.sdMult.toFixed(2)}`, 'round');
    } else {
      RB.log(g, `── ラウンド ${g.round} ──`, 'round');
    }
  };

  // ===================== ターン進行 =====================
  // 戻り値: { player, wake: {statusId, name, chance} | null, spins }
  RB.startTurn = function (g) {
    if (g.over) return null;
    let p = null;
    for (let guard = 0; guard < 1000 && !p; guard++) {
      if (g.ptr >= g.order.length) {
        if (g.round >= num(g.rules.maxRounds, 60)) { RB.timeUp(g); return null; }
        RB.newRound(g);
      }
      const cand = g.players[g.order[g.ptr]];
      if (cand && !cand.out) p = cand; else g.ptr++;
    }
    g.current = p.id;
    p.lastStand = p.hp <= 0;
    RB.log(g, `▶ ${p.name} (${p.char.name}) のターン` + (p.lastStand ? ' ― 💫最後の行動!' : ''), 'turn');
    RB.fire(g, p, 'turnStart', {});
    let wake = null;
    if (!p.lastStand) {
      for (const st of p.statuses) {
        const def = g.idx.statuses[st.id];
        if (def && has(def.skipWake)) { wake = { statusId: st.id, name: def.name, icon: def.icon || '', chance: Math.max(0, Math.min(100, num(def.skipWake))) }; break; }
      }
    }
    const extra = Math.max(0, Math.min(num(g.rules.maxExtraSpins, 2), RB.sumMod(p, 'extraSpins')));
    if (extra > 0) RB.log(g, `⏩ ${p.name} は ${extra + 1}回行動!`, 'good');
    return { player: p, wake, spins: 1 + extra };
  };

  // 目覚めルーレット: 結果を決め、UI はそれに合わせて回す
  RB.rollWake = function (g, p, wake) {
    const woke = g.rng() * 100 < wake.chance;
    if (woke) {
      p.statuses = p.statuses.filter(s => s.id !== wake.statusId);
      RB.log(g, `☀ ${p.name} は ${wake.name} から回復した! 行動できる`, 'good');
    } else {
      RB.log(g, `${wake.icon} ${p.name} は ${wake.name} で動けない…`, 'bad');
    }
    return woke;
  };

  // 現在のルーレット (状態異常による無効化込み)
  RB.wheelOf = function (g, p) {
    const segs = RB.charWheel(g.data, g.idx, p.char);
    const mw = RB.sumMod(p, 'missWeightPct');
    if (mw) for (const s of segs) if (s.kind === 'miss') s.weight = Math.max(0, s.weight * (1 + mw / 100));
    for (const st of p.statuses) {
      const def = g.idx.statuses[st.id];
      for (const slot of (st.disabled || [])) {
        const s = segs.find(x => x.slot === slot);
        if (s && !s.disabledBy) s.disabledBy = def ? def.name : st.id;
      }
    }
    return segs;
  };

  // src: 'char' (キャラ) / 'gear' (ギア) / 'item' (きりふだ)
  RB.wheelFor = function (g, p, src) {
    if (src === 'gear') { const gd = p.gear && g.idx.gears[p.gear.id]; return gd ? RB.buildWheel(g.idx, gd.moves) : []; }
    if (src === 'item') { const it = p.item && g.idx.items[p.item]; return it ? RB.buildWheel(g.idx, it.moves) : []; }
    return RB.wheelOf(g, p);
  };
  RB.canUseItem = (g, p) => !!(p.item && !p.itemUsed && g.idx.items[p.item] && RB.wheelFor(g, p, 'item').length);
  RB.hasGear = (g, p) => !!(p.gear && g.idx.gears[p.gear.id] && RB.wheelFor(g, p, 'gear').length);

  // 狙える相手: 挑発している敵がいればその人だけ。隠れ身の敵は (全員隠れていなければ) 狙えない
  RB.validTargets = function (g, p) {
    let en = RB.enemiesOf(g, p);
    const taunt = en.filter(t => RB.sumMod(t, 'taunt') > 0);
    if (taunt.length) return taunt;
    const vis = en.filter(t => RB.sumMod(t, 'stealth') <= 0);
    return vis.length ? vis : en;
  };

  const needsPick = (mv) => (mv.target || 'single') === 'single' || (mv.effects || []).some(e => e.type === 'mimic' || e.type === 'randomMove' || e.type === 'hpSwap');
  RB.needsTarget = function (g, p, src) {
    return RB.wheelFor(g, p, src).some(s => !s.disabledBy && s.kind !== 'miss' && needsPick(s.move)) && RB.validTargets(g, p).length > 0;
  };

  // 止まる区画を決める (ミス回避🍀があればミスを引き直す)
  RB.rollSpin = function (g, p, src) {
    const segs = RB.wheelFor(g, p, src);
    const roll = (list) => {
      const total = list.reduce((a, s) => a + s.weight, 0);
      let r = g.rng() * total;
      for (const s of list) { r -= s.weight; if (r < 0) return s; }
      return list[list.length - 1];
    };
    let s = roll(segs);
    const bad = (x) => x.kind === 'miss' || !!x.disabledBy;
    if (bad(s) && (!src || src === 'char')) {
      const lm = p.mods.find(m => m.stat === 'luck' && num(m.value) > 0);
      const good = segs.filter(x => !bad(x));
      if (lm && good.length) {
        lm.value = num(lm.value) - 1;
        if (lm.value <= 0) p.mods.splice(p.mods.indexOf(lm), 1);
        RB.log(g, `🍀 ${p.name} のラッキー! 「${s.move.name}」を回避して引き直し`, 'good');
        s = roll(good);
      }
    }
    return segs.indexOf(s);
  };

  // CPU がきりふだを使うか
  RB.cpuWantsItem = function (g, p) {
    if (!RB.canUseItem(g, p)) return false;
    return p.lastStand || p.hp / p.maxHp < 0.4 || g.players.filter(RB.alive).length <= 2 || (g.round >= 5 && g.rng() < 0.2);
  };

  // CPU の狙い
  RB.cpuPickTarget = function (g, p) {
    const ts = RB.validTargets(g, p);
    if (!ts.length) return null;
    const segs = RB.charWheel(g.data, g.idx, p.char);
    const total = segs.reduce((a, s) => a + s.weight, 0) || 1;
    let best = null, bs = -1e9;
    for (const t of ts) {
      let exp = 0;
      for (const s of segs) if (s.kind === 'attack') exp += (s.power + RB.bonusVs(s.move, t)) * Math.max(1, num(s.move.hits, 1)) * s.weight;
      exp /= total;
      // 人間・CPU を区別しない。弱った相手を少し優先しつつ、同じ相手ばかり狙わないよう分散する
      let sc = (1 - t.hp / t.maxHp) * 25 + exp * 0.6 + g.rng() * 50;
      if (t.hp <= exp * 1.2) sc += 25;                             // 倒せそう
      if (t.lastAttacker === p.id) sc += 15;                        // やり返す
      sc -= ((g.aim || {})[t.id] || 0) * 22;                        // このラウンドにもう狙われている
      sc -= RB.sumMod(t, 'guard') * 20 + RB.sumMod(t, 'barrier') * 0.3 + RB.sumMod(t, 'reflectPct') * 0.4 + RB.sumMod(t, 'thorns') * 0.8 + RB.sumMod(t, 'evadePct') * 0.4;
      if (sc > bs) { bs = sc; best = t; }
    }
    g.aim = g.aim || {};
    g.aim[best.id] = (g.aim[best.id] || 0) + 1;
    return best.id;
  };

  // 技の実行 (ルーレットの区画から)
  RB.act = function (g, p, segIdx, targetId, src) {
    const res = { spinAgain: false, segIdx, move: null, missed: false, src: src || 'char' };
    const segs = RB.wheelFor(g, p, src);
    const seg = segs[segIdx];
    p.acted = true;
    if (!seg) return res;
    res.move = seg.move;
    if (src === 'gear' || src === 'item') {
      const def = src === 'gear' ? g.idx.gears[p.gear.id] : g.idx.items[p.item];
      if (src === 'item') p.itemUsed = true;
      const head = src === 'gear' ? `⚙ ${p.name} のギア「${def.name}」` : `🃏 ${p.name} のきりふだ「${def.name}」`;
      if ((seg.move.kind || 'attack') === 'miss') { RB.log(g, `${head}: …何も起きない`, ''); res.missed = true; return res; }
      RB.log(g, `${head}: 「${seg.move.name}」!` + ((seg.move.kind || 'attack') === 'attack' && seg.power ? ` (威力${seg.power})` : ''), 'act');
      RB.execMove(g, p, seg.move, seg.power, targetId, res, 0);
      return res;
    }
    if (seg.disabledBy) {
      res.missed = true;
      p.misses++;
      RB.log(g, `⚡ 「${seg.move.name}」は ${seg.disabledBy} で使えない! 不発… (ミス${p.misses}回目)`, 'bad');
      RB.fire(g, p, 'onSpin', { moveKind: 'miss', res });
      return res;
    }
    const mv = seg.move;
    const kind = mv.kind || 'attack';
    if (kind === 'miss') {
      res.missed = true;
      p.misses++;
      RB.log(g, `❌ ${p.name} は「${mv.name}」を引いた… (ミス${p.misses}回目)`, 'bad');
      RB.fire(g, p, 'onSpin', { moveKind: 'miss', move: mv, res });
      return res;
    }
    RB.log(g, `🎯 ${p.name} の「${mv.name}」!` + (kind === 'attack' && seg.power ? ` (威力${seg.power})` : ''), 'act');
    RB.fire(g, p, 'onSpin', { moveKind: kind, move: mv, res });
    RB.execMove(g, p, mv, seg.power, targetId, res, 0);
    return res;
  };

  // 技の中身を実行 (ランダム技・ものまねからも呼ばれる)
  RB.execMove = function (g, p, mv, power, targetId, res, depth) {
    const kind = mv.kind || 'attack';
    if (kind === 'miss') { RB.log(g, '  …何も起きなかった', 'bad'); return; }
    let targets = RB.moveTargets(g, p, mv, targetId);
    // こんらん
    const conf = RB.confuseChance(g, p);
    const tmode = mv.target || 'single';
    if (conf > 0 && (tmode === 'single' || tmode === 'randomEnemy') && g.rng() * 100 < conf) {
      const t = pick(g, g.players.filter(RB.alive));
      if (t) { targets = [t]; RB.log(g, `😵 ${p.name} はこんらんして ${t.id === p.id ? '自分' : t.name} に向かった!`, 'bad'); }
    }
    if (res && !res.targets) res.targets = targets.map(t => t.id);
    const ctx = { self: p, targets, move: mv, dealt: 0, res, depth: depth || 0, targetId };
    if (kind === 'attack' && num(power) > 0) {
      const aoe = targets.length > 1 ? Math.max(num(g.rules.aoeFloor, 50), 100 - (targets.length - 1) * num(g.rules.aoeFalloff)) / 100 : 1;
      for (const t of targets) RB.attack(g, p, t, power, mv, ctx, aoe);
    }
    RB.runEffects(g, mv.effects || [], ctx);
    if (ctx.usedNextPower) p.mods = p.mods.filter(m => m.stat !== 'nextPower');
    p.uses[mv.id] = (p.uses[mv.id] || 0) + 1;
    p.lastMove = { id: mv.id, power: num(power) };
  };

  RB.moveTargets = function (g, p, mv, targetId) {
    const mode = mv.target || 'single';
    const en = RB.enemiesOf(g, p);
    switch (mode) {
      case 'self': return [p];
      case 'allEnemies': return en;
      case 'group': return en.filter(t => RB.inGroup(mv, t));
      case 'allies': return RB.alliesOf(g, p);
      case 'everyone': return g.players.filter(RB.alive);
      case 'randomEnemy': { const t = pick(g, en); return t ? [t] : []; }
      case 'randomAny': { const t = pick(g, g.players.filter(q => RB.alive(q) || q.id === p.id)); return t ? [t] : []; }
      default: {
        const valid = RB.validTargets(g, p);
        const t = g.players[targetId];
        if (t && valid.includes(t)) return [t];
        const r = pick(g, valid);
        return r ? [r] : [];
      }
    }
  };

  RB.inGroup = (mv, t) => (!mv.groupMark || t.char.mark === mv.groupMark) && (!mv.groupElement || t.char.element === mv.groupElement) && (!mv.groupType || t.char.type === mv.groupType);

  RB.confuseChance = function (g, p) {
    let c = 0;
    for (const st of p.statuses) { const d = g.idx.statuses[st.id]; if (d) c = Math.max(c, num(d.confuseChance)); }
    return c;
  };

  RB.sumMod = function (p, stat) {
    let s = 0; for (const m of p.mods) if (m.stat === stat) s += num(m.value); return s;
  };
  RB.maxMod = function (p, stat) {
    let s = 0; for (const m of p.mods) if (m.stat === stat) s = Math.max(s, num(m.value)); return s;
  };
  RB.statusSum = function (g, p, key) {
    let s = 0; for (const st of p.statuses) { const d = g.idx.statuses[st.id]; if (d) s += num(d[key]); } return s;
  };

  // 威力の増加量 (misses など)
  RB.scaleBonus = function (g, a, d, opts, moveId) {
    if (!opts || !opts.scaleBy || !num(opts.scalePer)) return 0;
    let n = 0;
    switch (opts.scaleBy) {
      case 'misses': n = a.misses; break;
      case 'uses': n = a.uses[moveId] || 0; break;
      case 'round': n = g.round; break;
      case 'kills': n = a.kills; break;
      case 'lostHp': n = Math.floor(Math.max(0, a.maxHp - Math.max(0, a.hp)) / 10); break;
      case 'enemies': n = RB.enemiesOf(g, a).length; break;
      case 'targetStatuses': n = d ? d.statuses.length : 0; break;
    }
    let v = n * num(opts.scalePer);
    if (has(opts.scaleMax)) v = Math.min(v, num(opts.scaleMax));
    return v;
  };

  // opts: 技 or ダメージ効果
  RB.calcDamage = function (g, a, d, power, opts, extraMult, ctx) {
    opts = opts || {};
    let p = num(power);
    p += RB.scaleBonus(g, a, d, opts, ctx && ctx.move ? ctx.move.id : opts.id);
    p += RB.bonusVs(opts, d);
    if (num(opts.pctHp) > 0) p += Math.max(0, d.hp) * num(opts.pctHp) / 100;
    if (opts.fixed) return { dmg: Math.max(0, Math.round(p)), mult: 1 };
    const np = RB.sumMod(a, 'nextPower');
    if (np && ctx && ctx.self === a) { p += np; ctx.usedNextPower = true; }
    p += num(a.passive.atkFlat) + RB.sumMod(a, 'atkFlat');
    p *= Math.max(0, 1 + (a.passive.atkPct + RB.sumMod(a, 'atkPct') + RB.statusSum(g, a, 'atkPct')) / 100);
    const el = opts.element || a.char.element;
    let mult = RB.elementMult(g.data, el, d.char.element);
    if (has(d.passive.resist[el])) mult *= d.passive.resist[el];
    p *= mult;
    p *= g.sdMult * (extraMult || 1);
    if (!opts.ignoreDef) p -= d.passive.defFlat + RB.sumMod(d, 'defFlat') + RB.statusSum(g, d, 'defFlat');
    p *= Math.max(0, 1 + (d.passive.dmgTakenPct + RB.sumMod(d, 'dmgTakenPct') + RB.statusSum(g, d, 'dmgTakenPct')) / 100);
    return { dmg: Math.max(0, Math.round(p)), mult };
  };

  // 攻撃 (onHit / onAttack / onKO を発火)
  RB.attack = function (g, a, d, power, opts, ctx, extraMult) {
    if (d.id === a.id) {
      const c = RB.calcDamage(g, a, a, power, opts, extraMult, ctx);
      return RB.applyDamage(g, a, c.dmg, { src: a });
    }
    const hits = Math.max(1, num(opts.hits, 1));
    let total = 0, mult = 1;
    const wasUp = d.hp > 0;
    const eb = RB.elemBonusOf(opts, d.char.element);
    if (eb && wasUp) {
      const el = g.idx.elements[d.char.element];
      RB.log(g, `  🔸 ${el ? el.name : ''}属性の ${d.name} に威力+${eb}!`, 'good');
    }
    const mb = RB.markBonusOf(opts, d.char.mark);
    if (mb && wasUp) RB.log(g, `  🔸 ${RB.markLabel(g.data, d.char.mark)}の ${d.name} に威力+${mb}!`, 'good');
    const tb = RB.typeBonusOf(opts, d.char.type);
    if (tb && wasUp) {
      const ty = g.idx.types[d.char.type];
      RB.log(g, `  🔹 ${ty ? ty.name : ''}の ${d.name} に威力+${tb}!`, 'good');
    }
    const sb = RB.scaleBonus(g, a, d, opts, ctx && ctx.move ? ctx.move.id : opts.id);
    if (sb && wasUp) RB.log(g, `  📈 ${RB.SCALE_BY[opts.scaleBy] || ''} で威力+${sb}`, 'good');
    for (let h = 0; h < hits; h++) {
      if (!RB.alive(d)) break;
      const c = RB.calcDamage(g, a, d, power, opts, extraMult, ctx);
      mult = c.mult;
      const crit = RB.sumMod(a, 'critPct');
      if (crit > 0 && c.dmg > 0 && g.rng() * 100 < crit) { c.dmg = Math.round(c.dmg * 1.5); RB.log(g, `  ⚡ 会心の一撃!`, 'good'); }
      total += RB.applyDamage(g, d, c.dmg, { src: a, attack: true, pierce: !!opts.pierce, mult, hitNo: hits > 1 ? h + 1 : 0 });
    }
    a.dealt += total;
    if (ctx) ctx.dealt += total;
    d.lastAttacker = a.id;
    const fromMove = !!(ctx && ctx.move && !ctx.srcTag);
    const ls = RB.sumMod(a, 'lifestealPct');
    if (ls > 0 && total > 0) RB.heal(g, a, Math.round(total * ls / 100), a, false);
    const th = RB.sumMod(d, 'thorns');
    if (th > 0 && total > 0 && !a.out) { RB.log(g, `  🌵 ${d.name} のトゲ!`, 'good'); RB.applyDamage(g, a, th, { src: d }); }
    if (num(opts.drainPct) > 0 && total > 0) RB.heal(g, a, Math.round(total * num(opts.drainPct) / 100), a, fromMove);
    if (num(opts.recoilPct) > 0 && total > 0) {
      const r = Math.round(total * num(opts.recoilPct) / 100);
      RB.log(g, `  ${a.name} は反動を受けた`, 'bad');
      RB.applyDamage(g, a, r, { src: a });
    }
    // 反射
    const rf = RB.sumMod(d, 'reflectPct');
    if (rf > 0 && total > 0 && !a.out) {
      const r = Math.round(total * rf / 100);
      if (r > 0) { RB.log(g, `  🪞 ${d.name} が ${r} ダメージを跳ね返した!`, 'good'); RB.applyDamage(g, a, r, { src: d }); }
    }
    if (g.depth < 4) {
      g.depth++;
      RB.fire(g, a, 'onAttack', { target: d, dealt: total, move: ctx && ctx.move });
      if (!d.out) RB.fire(g, d, 'onHit', { attacker: a, dealt: total, move: ctx && ctx.move });
      if (wasUp && d.hp <= 0) { a.kills++; RB.fire(g, a, 'onKO', { target: d }); }
      g.depth--;
    }
    // 攻撃で治る状態異常 (こおり等)
    if (total > 0) {
      d.statuses = d.statuses.filter(st => {
        const def = g.idx.statuses[st.id];
        if (def && def.cureOnHit) { RB.log(g, `  ${d.name} の ${def.name} が解けた`, 'good'); return false; }
        return true;
      });
    }
    return total;
  };

  RB.applyDamage = function (g, d, amount, o) {
    o = o || {};
    if (d.out || d.hp <= 0) return 0;
    if (typeof amount === 'object') amount = amount.dmg;
    amount = Math.max(0, Math.round(num(amount)));
    const src = o.src && o.src.id !== d.id ? o.src : null;
    if (o.attack && !o.pierce && src) {
      const ev = RB.sumMod(d, 'evadePct');
      if (ev > 0 && g.rng() * 100 < ev) {
        RB.log(g, `  💨 ${d.name} は攻撃をかわした!`, 'good');
        RB.fxPush(g, d.id, 'guard', 'かわした');
        return 0;
      }
      const gm = d.mods.find(m => m.stat === 'guard' && num(m.value) > 0);
      if (gm) {
        gm.value = num(gm.value) - 1;
        if (gm.value <= 0) d.mods.splice(d.mods.indexOf(gm), 1);
        RB.log(g, `  🛡 ${d.name} は攻撃を防いだ!`, 'good');
        RB.fxPush(g, d.id, 'guard', 'ガード');
        return 0;
      }
      const nb = Math.max(RB.maxMod(d, 'nullifyBelow'), num(d.passive.nullifyBelow));
      if (nb > 0 && amount > 0 && amount <= nb) {
        RB.log(g, `  ✋ ${d.name} は ${amount} ダメージを無効化した! (${nb}以下無効)`, 'good');
        RB.fxPush(g, d.id, 'guard', '無効');
        return 0;
      }
      for (const m of d.mods.filter(m => m.stat === 'barrier')) {
        if (amount <= 0) break;
        const ab = Math.min(num(m.value), amount);
        m.value = num(m.value) - ab; amount -= ab;
        if (ab > 0) RB.log(g, `  🔰 バリアが ${ab} ダメージを吸収` + (m.value <= 0 ? ' (バリア消滅)' : ` (残り${m.value})`), 'good');
        if (m.value <= 0) d.mods.splice(d.mods.indexOf(m), 1);
      }
    }
    if (amount <= 0) {
      if (o.attack) { RB.log(g, `  ${d.name} にダメージはなかった`, ''); RB.fxPush(g, d.id, 'dmg', 0); }
      return 0;
    }
    if (d.hp - amount <= 0) {
      const en = d.mods.find(m => m.stat === 'endure' && num(m.value) > 0);
      if (en && d.hp > 1) {
        en.value = num(en.value) - 1;
        if (en.value <= 0) d.mods.splice(d.mods.indexOf(en), 1);
        amount = d.hp - 1;
        RB.log(g, `  💪 ${d.name} はこらえた!`, 'good');
        RB.fxPush(g, d.id, 'buff', 'こらえた');
      }
    }
    d.hp -= amount;
    d.taken += amount;
    const eff = o.mult > 1 ? ' こうかはばつぐんだ!' : (o.mult < 1 ? ' いまひとつのようだ…' : '');
    const label = o.dot ? `  ${o.dot} ${d.name} に ${amount} ダメージ` : `  💥 ${d.name} に ${amount} ダメージ!${o.hitNo ? ` (${o.hitNo}回目)` : ''}${eff}`;
    RB.log(g, label, 'dmg');
    RB.fxPush(g, d.id, 'dmg', amount);
    if (d.hp <= 0) RB.zeroHp(g, d);
    else RB.checkLowHp(g, d);
    return amount;
  };

  RB.zeroHp = function (g, d) {
    const mode = g.rules.protect;
    if (mode === 'firstTurn' && !d.acted && g.current !== d.id) {
      d.hp = 1;
      RB.log(g, `  💪 ${d.name} はまだ行動していないので HP1 で踏ん張った!`, 'good');
      return;
    }
    d.hp = 0;
    if (d.downed) return;
    d.downed = true;
    if (mode === 'lastStand' && g.current !== d.id) RB.log(g, `  💫 ${d.name} はたおれかけている… 次の自分のターンが最後の行動!`, 'ko');
    else RB.log(g, `  💀 ${d.name} はたおれた!`, 'ko');
    RB.fxPush(g, d.id, 'ko', 'KO');
    if (g.depth < 4) { g.depth++; RB.fire(g, d, 'onDowned', {}); g.depth--; }
  };

  RB.checkLowHp = function (g, p) {
    for (const aid of (p.char.abilities || [])) {
      const ab = g.idx.abilities[aid];
      if (!ab || ab.trigger !== 'onLowHp' || p.lowFired[aid]) continue;
      if (p.hp > 0 && p.hp <= p.maxHp * num(ab.lowHpPct, 50) / 100) {
        p.lowFired[aid] = true;
        if (g.depth < 4) { g.depth++; RB.fireOne(g, p, ab, {}); g.depth--; }
      }
    }
  };

  // revive: HP0 (たおれかけ) から立ち上がれるのは技による回復だけ (特性の自然回復では起き上がらない)
  RB.heal = function (g, p, amount, healer, revive) {
    if (p.out) return 0;
    if (p.hp <= 0 && !revive) return 0;
    if (RB.sumMod(p, 'healBlock') > 0 && amount > 0) { RB.log(g, `  🚫 ${p.name} は回復を封じられている`, 'bad'); return 0; }
    const bonus = healer ? num(healer.passive.healPct) : 0;
    amount = Math.round(num(amount) * (1 + bonus / 100));
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + Math.max(0, amount));
    const got = p.hp - before;
    if (got > 0) {
      RB.log(g, `  💚 ${p.name} は HP を ${got} 回復`, 'good');
      RB.fxPush(g, p.id, 'heal', got);
      if (p.downed && p.hp > 0) { p.downed = false; RB.log(g, `  ✨ ${p.name} は立ち上がった!`, 'good'); }
    }
    return got;
  };

  // HP を最大HPに対する割合で設定 (入れ替え・シャッフル用。0 にはしない)
  RB.setHpPct = function (g, p, pct) {
    const before = p.hp;
    p.hp = Math.max(1, Math.min(p.maxHp, Math.round(p.maxHp * pct)));
    const diff = p.hp - before;
    if (diff !== 0) RB.fxPush(g, p.id, diff > 0 ? 'heal' : 'dmg', Math.abs(diff));
    if (p.downed && p.hp > 0) p.downed = false;
    if (diff < 0) RB.checkLowHp(g, p);
    return diff;
  };

  // まひ型: 使えなくなる区画を選ぶ
  RB.pickDisabled = function (g, t, def, st) {
    const cnt = num(def.disableCount);
    if (cnt <= 0) return;
    const segs = RB.charWheel(g.data, g.idx, t.char).filter(s => s.kind !== 'miss');
    const taken = new Set(); for (const s of t.statuses) if (s !== st) for (const d of (s.disabled || [])) taken.add(d);
    let cands = segs.filter(s => !taken.has(s.slot));
    const mode = def.disableMode || 'random';
    for (let k = 0; k < cnt && cands.length; k++) {
      let sel;
      if (mode === 'smallest') sel = cands.reduce((a, b) => (b.weight < a.weight ? b : a));
      else if (mode === 'largest') sel = cands.reduce((a, b) => (b.weight > a.weight ? b : a));
      else if (mode === 'strongest') sel = cands.reduce((a, b) => (b.power > a.power ? b : a));
      else sel = pick(g, cands);
      st.disabled.push(sel.slot);
      cands = cands.filter(c => c !== sel);
    }
  };

  RB.addStatus = function (g, t, statusId, turns, src) {
    const def = g.idx.statuses[statusId];
    if (!def || !RB.alive(t)) return false;
    if (t.passive.immune.includes(statusId)) { RB.log(g, `  ${t.name} には ${def.name} が効かない! (特性)`, ''); return false; }
    const tt = has(turns) ? num(turns) : num(def.turns, 2);
    const ex = t.statuses.find(s => s.id === statusId);
    if (ex) {
      ex.turns = Math.max(ex.turns, tt); ex.born = g.turnCount;
      RB.log(g, `  ${def.icon || ''} ${t.name} の ${def.name} が続く (${ex.turns}ターン)`, 'bad');
      return true;
    }
    const st = { id: statusId, turns: tt, born: g.turnCount, disabled: [] };
    RB.pickDisabled(g, t, def, st);
    t.statuses.push(st);
    const wheel = RB.charWheel(g.data, g.idx, t.char);
    const dis = st.disabled.length ? ` (「${st.disabled.map(sl => { const s = wheel.find(x => x.slot === sl); return s ? s.move.name : '?'; }).join('」「')}」が使えない)` : '';
    RB.log(g, `  ${def.icon || '●'} ${t.name} は ${def.name} になった! ${tt > 0 ? tt + 'ターン' : ''}${dis}`, 'bad');
    RB.fxPush(g, t.id, 'status', def.name);
    return true;
  };

  RB.addMod = function (g, t, stat, value, turns, src) {
    if (!RB.alive(t) && !(t.hp <= 0 && !t.out && t.id === g.current)) return;
    if (!RB.MOD_STATS[stat]) return;
    value = num(value);
    const m = { stat, value, turns: num(turns), born: g.turnCount, src: src || '' };
    // 同じ出どころ・同じ能力は上書き (無限スタック防止)。攻撃力系は重ねがけ可
    const ex = t.mods.find(x => x.stat === stat && x.src === m.src && m.src);
    if (ex && stat !== 'atkFlat' && stat !== 'atkPct') Object.assign(ex, m);
    else t.mods.push(m);
    const info = RB.MOD_STATS[stat];
    const sign = value > 0 ? '+' : '';
    const good = RB.isGoodMod(m);
    RB.log(g, `  ${good ? '⬆' : '⬇'} ${t.name}: ${info.name.replace(/ [+%]$/, '')} ${sign}${value}${info.unit}` + (m.turns > 0 ? ` (${m.turns}ターン)` : ''), good ? 'good' : 'bad');
    RB.fxPush(g, t.id, good ? 'buff' : 'debuff', `${info.short}${sign}${value}${info.unit}`);
  };

  RB.isGoodMod = (m) => (RB.BAD_WHEN_POSITIVE.includes(m.stat) ? num(m.value) < 0 : num(m.value) > 0);

  // ===================== 効果・特性 =====================
  RB.effectTargets = function (g, to, ctx) {
    const self = ctx.self;
    switch (to || 'target') {
      case 'self': return self.out ? [] : [self];
      case 'attacker': return ctx.attacker && !ctx.attacker.out ? [ctx.attacker] : [];
      case 'allEnemies': return RB.enemiesOf(g, self);
      case 'randomEnemy': { const t = pick(g, RB.enemiesOf(g, self)); return t ? [t] : []; }
      case 'randomAny': { const t = pick(g, g.players.filter(q => RB.alive(q) || q.id === self.id)); return t ? [t] : []; }
      case 'allies': return RB.alliesOf(g, self);
      case 'everyone': return g.players.filter(RB.alive);
      default: return (ctx.targets || []).filter(t => !t.out);
    }
  };

  RB.checkCond = function (g, c, self, target, ctx) {
    if (!c) return true;
    const pct = (p) => p.hp / p.maxHp * 100;
    const hasSt = (p, v) => v === 'any' ? p.statuses.length > 0 : (v === 'none' ? p.statuses.length === 0 : p.statuses.some(s => s.id === v));
    if (has(c.selfHpBelowPct) && pct(self) > num(c.selfHpBelowPct)) return false;
    if (has(c.selfHpAbovePct) && pct(self) < num(c.selfHpAbovePct)) return false;
    if (has(c.selfStatus) && !hasSt(self, c.selfStatus)) return false;
    if (has(c.missesAtLeast) && self.misses < num(c.missesAtLeast)) return false;
    if (has(c.aliveAtMost) && g.players.filter(RB.alive).length > num(c.aliveAtMost)) return false;
    if (has(c.roundAtLeast) && g.round < num(c.roundAtLeast)) return false;
    if (has(c.moveKind) && (ctx.moveKind || (ctx.move && ctx.move.kind)) !== c.moveKind) return false;
    if (has(c.dealtAtLeast) && num(ctx.dealt) < num(c.dealtAtLeast)) return false;
    if (has(c.selfMark) && self.char.mark !== c.selfMark) return false;
    const needT = ['targetHpBelowPct', 'targetElement', 'targetType', 'targetStatus', 'targetMark'].some(k => has(c[k]) && c[k] !== false);
    if (needT) {
      if (!target) return false;
      if (has(c.targetHpBelowPct) && pct(target) > num(c.targetHpBelowPct)) return false;
      if (has(c.targetElement) && target.char.element !== c.targetElement) return false;
      if (has(c.targetType) && target.char.type !== c.targetType) return false;
      if (has(c.targetStatus) && !hasSt(target, c.targetStatus)) return false;
      if (has(c.targetMark) && target.char.mark !== c.targetMark) return false;
    }
    return true;
  };

  RB.runEffects = function (g, effects, ctx) {
    let prevFired = null;
    for (const e of (effects || [])) {
      if (!e || !e.type) continue;
      if (e.link === 'then' && prevFired === false) { prevFired = false; continue; }
      if (e.link === 'else' && prevFired !== false) { prevFired = false; continue; }
      const spec = RB.EFFECTS[e.type] || {};
      let fired = false;
      if (spec.once) {
        const t0 = (ctx.targets || [])[0] || null;
        if (RB.checkCond(g, e.cond, ctx.self, t0, ctx) && !(has(e.chance) && g.rng() * 100 >= num(e.chance))) {
          fired = RB.applyEffect(g, e, ctx, t0) !== false;
        }
      } else {
        for (const t of RB.effectTargets(g, e.to, ctx)) {
          if (!RB.checkCond(g, e.cond, ctx.self, t, ctx)) continue;
          let chance = has(e.chance) ? num(e.chance) : 100;
          if (e.type === 'status' && t.id !== ctx.self.id) chance += num(ctx.self.passive.statusChanceBonus);
          if (chance < 100 && g.rng() * 100 >= chance) continue;
          if (RB.applyEffect(g, e, ctx, t) !== false) fired = true;
        }
      }
      prevFired = fired;
    }
  };

  RB.applyEffect = function (g, e, ctx, t) {
    const self = ctx.self;
    const fromMove = !!ctx.move && !ctx.srcTag;
    switch (e.type) {
      case 'damage': {
        if (t.id === self.id) {
          // 自分へのダメージ (反動・代償) は基本的に固定値
          const c = (e.fixed || !has(e.element)) ? { dmg: num(e.power) } : RB.calcDamage(g, self, self, e.power, e, 1, ctx);
          RB.applyDamage(g, self, c.dmg, { src: self });
        } else {
          RB.attack(g, self, t, e.power, e, ctx, 1);
        }
        break;
      }
      case 'heal': {
        const amt = num(e.amount) + t.maxHp * num(e.pct) / 100 + num(ctx.dealt) * num(e.ofDamagePct) / 100;
        RB.heal(g, t, amt, self, fromMove);
        break;
      }
      case 'status': return e.status ? RB.addStatus(g, t, e.status, e.turns, self) : false;
      case 'cure': {
        const before = t.statuses.length;
        const names = [];
        t.statuses = t.statuses.filter(s => { const hit = !e.status || s.id === e.status; if (hit) names.push((g.idx.statuses[s.id] || {}).name || s.id); return !hit; });
        if (t.statuses.length !== before) RB.log(g, `  ✨ ${t.name} の ${names.join('・')} が治った`, 'good');
        break;
      }
      case 'mod': if (e.stat) RB.addMod(g, t, e.stat, e.value, e.turns, ctx.srcTag || (ctx.move ? ctx.move.id : '')); break;
      case 'clearMods': {
        const w = e.which || 'all';
        const before = t.mods.length;
        t.mods = t.mods.filter(m => w === 'all' ? false : (w === 'buffs' ? !RB.isGoodMod(m) : RB.isGoodMod(m)));
        if (t.mods.length !== before) RB.log(g, `  🌀 ${t.name} の${RB.CLEAR_WHICH[w]}が消えた`, '');
        break;
      }
      case 'invertMods': {
        let n = 0;
        for (const m of t.mods) if (RB.INVERTIBLE.includes(m.stat)) { m.value = -num(m.value); n++; }
        RB.log(g, n ? `  🔄 あべこべ! ${t.name} のバフとデバフが逆になった` : `  🔄 ${t.name} には入れ替わる効果がなかった`, n ? 'good' : '');
        if (!n) return false;
        RB.fxPush(g, t.id, 'status', 'あべこべ');
        break;
      }
      case 'stealMods': {
        if (t.id === self.id) return false;
        const got = t.mods.filter(RB.isGoodMod);
        t.mods = t.mods.filter(m => !RB.isGoodMod(m));
        for (const m of got) { m.born = g.turnCount; m.src = 'steal:' + (m.src || ''); self.mods.push(m); }
        RB.log(g, got.length ? `  🫳 ${self.name} は ${t.name} のバフを${got.length}つ奪った!` : `  🫳 ${t.name} は奪えるバフを持っていなかった`, got.length ? 'good' : '');
        if (!got.length) return false;
        RB.fxPush(g, self.id, 'buff', '奪った!');
        break;
      }
      case 'transferStatus': {
        if (t.id === self.id) return false;
        const moving = self.statuses.filter(s => !e.status || s.id === e.status);
        if (!moving.length) return false;
        self.statuses = self.statuses.filter(s => !moving.includes(s));
        for (const s of moving) {
          const def = g.idx.statuses[s.id];
          RB.log(g, `  👉 ${self.name} は ${def ? def.icon + def.name : s.id} を ${t.name} に押し付けた!`, 'act');
          RB.addStatus(g, t, s.id, s.turns, self);
        }
        break;
      }
      case 'hpSwap': {
        if (t.id === self.id || !RB.alive(t)) return false;
        const ps = Math.max(0, self.hp) / self.maxHp, pt = t.hp / t.maxHp;
        RB.setHpPct(g, self, pt);
        RB.setHpPct(g, t, ps);
        RB.log(g, `  🔀 ${self.name} と ${t.name} のHP割合が入れ替わった! (${Math.round(ps * 100)}% ⇄ ${Math.round(pt * 100)}%)`, 'act');
        break;
      }
      case 'hpChaos': {
        const ps = g.players.filter(RB.alive);
        if (ps.length < 2) break;
        if (e.mode === 'average') {
          const avg = ps.reduce((a, p) => a + p.hp / p.maxHp, 0) / ps.length;
          for (const p of ps) RB.setHpPct(g, p, avg);
          RB.log(g, `  ⚖ 全員のHPが ${Math.round(avg * 100)}% にそろった!`, 'act');
        } else {
          const pcts = ps.map(p => p.hp / p.maxHp);
          for (let i = pcts.length - 1; i > 0; i--) { const j = Math.floor(g.rng() * (i + 1)); [pcts[i], pcts[j]] = [pcts[j], pcts[i]]; }
          ps.forEach((p, i) => RB.setHpPct(g, p, pcts[i]));
          RB.log(g, `  🌪 大波乱! 全員のHPがシャッフルされた!`, 'act');
        }
        for (const p of ps) RB.fxPush(g, p.id, 'status', '🌪');
        break;
      }
      case 'randomMove': {
        if (ctx.depth >= 2) return false;
        const mine = new Set((self.char.moves || []).map(m => m.move));
        const cands = (g.data.moves || []).filter(m => (m.kind || 'attack') !== 'miss' && !m.noRandom
          && !(m.effects || []).some(x => x.type === 'randomMove' || x.type === 'mimic')
          && (e.pool !== 'others' || !mine.has(m.id)));
        const mv = pick(g, cands);
        if (!mv) break;
        RB.log(g, `  🎲 ランダムで「${mv.name}」が出た!`, 'act');
        RB.execMove(g, self, mv, num(mv.power), ctx.targetId, ctx.res, ctx.depth + 1);
        break;
      }
      case 'mimic': {
        if (ctx.depth >= 2) break;
        const src = t && t.id !== self.id ? t : null;
        const lm = src && src.lastMove ? g.idx.moves[src.lastMove.id] : null;
        if (!lm || (lm.effects || []).some(x => x.type === 'mimic')) { RB.log(g, `  🎭 まねできる技がなかった…`, 'bad'); return false; }
        RB.log(g, `  🎭 ${src.name} の「${lm.name}」をまねした!`, 'act');
        RB.execMove(g, self, lm, src.lastMove.power, src.id, ctx.res, ctx.depth + 1);
        break;
      }
      case 'transform': {
        const ch = e.char === '@target' ? ((ctx.targets || []).find(x => x.id !== t.id) || {}).char : g.idx.chars[e.char];
        if (!ch || t.char.id === ch.id || t.out) return false;
        const old = t.char;
        t.char = ch; t.charId = ch.id;
        t.passive = RB.passiveOf(g.idx, ch);
        // まひ等で使えなくなる区画は新しいルーレットで選び直す
        for (const st of t.statuses) {
          if (!(st.disabled || []).length) continue;
          const def = g.idx.statuses[st.id];
          st.disabled = [];
          if (def) RB.pickDisabled(g, t, def, st);
        }
        RB.log(g, `  🌟 ${t.name} の ${old.name} は ${ch.name} に${e.to === 'self' || t.id === self.id ? '進化' : '変身'}した!`, 'act');
        RB.fxPush(g, t.id, 'ability', ch.name + '!');
        RB.fxPush(g, t.id, 'transform', ch.id);
        break;
      }
      case 'attachGear': {
        if (t.out || t.gear) return false;
        let gd = e.gear ? g.idx.gears[e.gear] : null;
        if (!gd) gd = pick(g, (g.data.gears || []).filter(x => (x.moves || []).length && (!e.pool || e.pool === 'any' || (x.kind || 'good') === e.pool)));
        if (!gd) return false;
        t.gear = { id: gd.id, turns: num(gd.turns), born: g.turnCount };
        RB.log(g, `  ⚙ ${t.name} に${gd.kind === 'bad' ? '悪い' : ''}ギア「${gd.icon || ''}${gd.name}」がついた!` + (num(gd.turns) > 0 ? ` (${gd.turns}ターン)` : ''), gd.kind === 'bad' ? 'bad' : 'good');
        RB.fxPush(g, t.id, gd.kind === 'bad' ? 'debuff' : 'buff', '⚙' + gd.name);
        break;
      }
      case 'removeGear': {
        if (!t.gear) return false;
        const gd = g.idx.gears[t.gear.id];
        t.gear = null;
        RB.log(g, `  ⚙ ${t.name} のギア「${gd ? gd.name : '?'}」が外れた`, '');
        break;
      }
      case 'spinAgain': if (ctx.res) ctx.res.spinAgain = true; break;
    }
  };

  RB.fire = function (g, p, trig, ev) {
    if (!p || p.out) return;
    for (const aid of (p.char.abilities || [])) {
      const ab = g.idx.abilities[aid];
      if (!ab || ab.trigger !== trig) continue;
      RB.fireOne(g, p, ab, ev);
    }
  };

  RB.fireOne = function (g, p, ab, ev) {
    if (ab.once && p.once[ab.id]) return;
    const ctx = {
      self: p, attacker: ev.attacker || null, targets: ev.target ? [ev.target] : (ev.attacker ? [ev.attacker] : []),
      move: ev.move || null, moveKind: ev.moveKind, dealt: num(ev.dealt), res: ev.res || null, srcTag: 'ab:' + ab.id, depth: 2,
    };
    const tgt0 = ctx.targets[0] || null;
    if (!RB.checkCond(g, ab.cond, p, tgt0, ctx)) return;
    if (has(ab.chance) && num(ab.chance) < 100 && g.rng() * 100 >= num(ab.chance)) return;
    if (!(ab.effects || []).length) return;
    if (ab.once) p.once[ab.id] = true;
    RB.log(g, `✨ ${p.name} の特性「${ab.name}」!`, 'ability');
    RB.fxPush(g, p.id, 'ability', ab.name);
    RB.runEffects(g, ab.effects, ctx);
  };

  // ターン終了: 継続ダメージ・効果時間・時限爆発・脱落・勝敗
  RB.endTurn = function (g) {
    const p = g.players[g.current];
    if (p && !p.out) {
      for (const st of p.statuses.slice()) {
        const def = g.idx.statuses[st.id];
        if (!def) continue;
        const amt = num(def.dotAmount) + Math.round(p.maxHp * num(def.dotPct) / 100);
        if (amt > 0 && p.hp > 0) RB.applyDamage(g, p, amt, { dot: (def.icon || '') + ' ' + def.name + ':' });
      }
      RB.fire(g, p, 'turnEnd', {});
      p.statuses = p.statuses.filter(st => {
        if (st.turns > 0 && st.born !== g.turnCount) {
          st.turns--;
          if (st.turns <= 0) {
            const def = g.idx.statuses[st.id] || {};
            const boom = num(def.expireDamage) + Math.round(p.maxHp * num(def.expirePct) / 100);
            if (boom > 0) {
              RB.log(g, `  💥💥 ${p.name} の ${def.icon || ''}${def.name || st.id} が爆発した!`, 'ko');
              RB.applyDamage(g, p, boom, { dot: '💣' });
            } else {
              RB.log(g, `  ${p.name} の ${def.name || st.id} が治った`, 'good');
            }
            return false;
          }
        }
        return true;
      });
      p.mods = p.mods.filter(m => {
        if (m.turns > 0 && m.born !== g.turnCount) { m.turns--; if (m.turns <= 0) return false; }
        return true;
      });
      const rg = RB.sumMod(p, 'regen');
      if (rg > 0 && p.hp > 0) RB.heal(g, p, rg, null, false);
      else if (rg < 0 && p.hp > 0) RB.applyDamage(g, p, -rg, { dot: '🩸 衰弱:' });
      if (p.gear && p.gear.turns > 0 && p.gear.born !== g.turnCount) {
        p.gear.turns--;
        if (p.gear.turns <= 0) { const gd = g.idx.gears[p.gear.id]; RB.log(g, `  ⚙ ${p.name} のギア「${gd ? gd.name : '?'}」が外れた`, ''); p.gear = null; }
      }
    }
    // 脱落処理
    const mode = g.rules.protect;
    for (const q of g.players) {
      if (q.out || q.hp > 0) continue;
      if (mode === 'lastStand' && q.id !== g.current) continue;
      q.out = true; q.downed = true;
      g.outOrder.push(q.id);
      RB.log(g, `☠ ${q.name} は脱落した`, 'ko');
      RB.fxPush(g, q.id, 'out', '脱落');
    }
    g.turnCount++;
    g.ptr++;
    RB.checkWin(g);
    g.current = null;
    return { over: g.over };
  };

  RB.teamKey = (p) => p.team === 0 ? 'p' + p.id : 't' + p.team;

  RB.checkWin = function (g) {
    const left = g.players.filter(p => !p.out);
    const keys = new Set(left.map(RB.teamKey));
    if (keys.size <= 1) {
      g.over = true;
      g.winners = left.map(p => p.id);
      if (!left.length) RB.log(g, '🏳 全員たおれた… 引き分け!', 'sys');
      else RB.log(g, `🏆 ${left.map(p => p.name).join('・')} の勝利!`, 'sys');
    }
  };

  RB.timeUp = function (g) {
    g.over = true;
    const left = g.players.filter(p => !p.out).sort((a, b) => b.hp / b.maxHp - a.hp / a.maxHp);
    const top = left[0];
    g.winners = top ? left.filter(p => RB.teamKey(p) === RB.teamKey(top)).map(p => p.id) : [];
    RB.log(g, `⌛ ${g.rules.maxRounds}ラウンド経過で判定! ${top ? top.name + ' の勝利 (残りHP割合)' : ''}`, 'sys');
  };

  // 最終順位 (勝者 → 後に脱落した順)
  RB.ranking = function (g) {
    const win = g.winners.map(id => g.players[id]);
    const rest = g.players.filter(p => !g.winners.includes(p.id) && !p.out).sort((a, b) => b.hp / b.maxHp - a.hp / a.maxHp);
    const outs = g.outOrder.slice().reverse().map(id => g.players[id]).filter(p => !g.winners.includes(p.id));
    return win.concat(rest, outs);
  };

  // このあと続けて回せるか (ターン中に倒れたら止める)
  RB.canKeepActing = (p) => !p.out && (p.hp > 0 || p.lastStand);

  // 1ターン丸ごと自動で進める (CPU 同士の検証用)
  RB.autoTurn = function (g) {
    const st = RB.startTurn(g);
    if (!st) return;
    const p = st.player;
    let canAct = true;
    if (st.wake) canAct = RB.rollWake(g, p, st.wake);
    if (canAct) {
      let spins = st.spins, chain = 0;
      while (spins > 0 && RB.canKeepActing(p) && !g.over) {
        spins--;
        const src = RB.cpuWantsItem(g, p) ? 'item' : 'char';
        const tid = RB.cpuPickTarget(g, p);
        const seg = RB.rollSpin(g, p, src);
        const r = RB.act(g, p, seg, tid, src);
        if (r.spinAgain && chain < num(g.rules.maxSpinChain)) { chain++; spins++; RB.log(g, '🔁 もう一回!', 'sys'); }
      }
      if (RB.hasGear(g, p) && RB.canKeepActing(p) && !g.over) {
        const seg = RB.rollSpin(g, p, 'gear');
        RB.act(g, p, seg, RB.cpuPickTarget(g, p), 'gear');
      }
    }
    RB.endTurn(g);
    g.fx.length = 0;
  };

  // ===================== データ検証 =====================
  RB.validate = function (data) {
    const w = [];
    const idx = RB.index(data);
    for (const k of ['chars', 'moves', 'abilities', 'statuses', 'elements', 'types', 'gears', 'items']) {
      const seen = new Set();
      for (const x of (data[k] || [])) {
        if (!x.id) w.push(`${k}: IDが空の項目があります (${x.name || '?'})`);
        else if (seen.has(x.id)) w.push(`${k}: ID「${x.id}」が重複しています`);
        seen.add(x.id);
      }
    }
    const checkEb = (where, o) => {
      for (const k of Object.keys((o && o.elemBonus) || {})) if (!idx.elements[k]) w.push(`${where}: 属性ボーナスの属性「${k}」がありません`);
      for (const k of Object.keys((o && o.typeBonus) || {})) if (!idx.types[k]) w.push(`${where}: タイプボーナスのタイプ「${k}」がありません`);
    };
    const checkEffects = (where, effs) => {
      for (const e of (effs || [])) {
        if ((e.type === 'status' || e.type === 'cure' || e.type === 'transferStatus') && e.status && !idx.statuses[e.status]) w.push(`${where}: 状態異常「${e.status}」がありません`);
        if (e.type === 'status' && !e.status) w.push(`${where}: 状態異常が未選択です`);
        if (e.type === 'damage' && e.element && !idx.elements[e.element]) w.push(`${where}: 属性「${e.element}」がありません`);
        if (e.type === 'damage') checkEb(where, e);
        if (e.type === 'mod' && !RB.MOD_STATS[e.stat]) w.push(`${where}: バフ/デバフの能力が未設定です`);
        if (e.type === 'transform' && e.char !== '@target' && !idx.chars[e.char]) w.push(`${where}: 進化・変身先のキャラが未設定です`);
        if (e.type === 'attachGear' && e.gear && !idx.gears[e.gear]) w.push(`${where}: ギア「${e.gear}」がありません`);
        if (!RB.EFFECTS[e.type]) w.push(`${where}: 不明な効果「${e.type}」`);
      }
    };
    for (const c of (data.chars || [])) {
      const nm = `キャラ「${c.name}」`;
      if (!idx.elements[c.element]) w.push(`${nm}: 属性が未設定/存在しません`);
      if (c.type && !idx.types[c.type]) w.push(`${nm}: タイプ「${c.type}」がありません`);
      for (const a of (c.abilities || [])) if (!idx.abilities[a]) w.push(`${nm}: 特性「${a}」がありません`);
      const segs = (c.moves || []).filter(e => idx.moves[e.move] && num(e.weight) > 0);
      if (!segs.length) w.push(`${nm}: ルーレットに技がありません`);
      if (c.mark && !RB.MARKS[c.mark]) w.push(`${nm}: ●/★ の指定が不正です`);
      for (const e of (c.moves || [])) if (!idx.moves[e.move]) w.push(`${nm}: 技「${e.move}」がありません`);
      if (num(c.baseHp) <= 0) w.push(`${nm}: HPが0以下です`);
    }
    for (const m of (data.moves || [])) {
      if (m.element && !idx.elements[m.element]) w.push(`技「${m.name}」: 属性「${m.element}」がありません`);
      if (m.target === 'group' && !m.groupMark && !m.groupElement && !m.groupType) w.push(`技「${m.name}」: 対象「条件に合う敵全員」の条件が未設定です`);
      checkEb(`技「${m.name}」`, m);
      checkEffects(`技「${m.name}」`, m.effects);
    }
    for (const [k, lbl] of [['gears', 'ギア'], ['items', 'きりふだ']]) {
      for (const x of (data[k] || [])) {
        const segs = (x.moves || []).filter(e => idx.moves[e.move] && num(e.weight) > 0);
        if (!segs.length) w.push(`${lbl}「${x.name}」: ルーレットに技がありません`);
        for (const e of (x.moves || [])) if (!idx.moves[e.move]) w.push(`${lbl}「${x.name}」: 技「${e.move}」がありません`);
      }
    }
    for (const a of (data.abilities || [])) {
      checkEffects(`特性「${a.name}」`, a.effects);
      if (a.trigger !== 'passive' && !(a.effects || []).length && !a.passive) w.push(`特性「${a.name}」: 効果がありません`);
    }
    return w;
  };

  // ===================== 説明文の自動生成 =====================
  const nm = (data, k, id) => { const x = (data[k] || []).find(o => o.id === id); return x ? x.name : id; };
  const TO_SHORT = { target: '相手', self: '自分', attacker: '攻撃してきた相手', randomEnemy: 'ランダムな敵', randomAny: 'ランダムな誰か(自分含む)', allEnemies: '敵全体', allies: '味方全体', everyone: '全員' };
  const SCALE_SHORT = { misses: 'ミスした回数', uses: 'この技を使った回数', round: 'ラウンド数', kills: '倒した人数', lostHp: '失ったHP10', enemies: '残りの敵の数', targetStatuses: '相手の状態異常の数' };

  const ebText = (data, o) => Object.entries((o && o.markBonus) || {}).filter(([, v]) => has(v) && num(v)).map(([k, v]) => `${RB.markLabel(data, k)}に+${v}`)
    .concat(Object.entries((o && o.elemBonus) || {}).filter(([, v]) => has(v) && num(v)).map(([k, v]) => `${nm(data, 'elements', k)}属性に+${v}`)
    .concat(Object.entries((o && o.typeBonus) || {}).filter(([, v]) => has(v) && num(v)).map(([k, v]) => `${nm(data, 'types', k)}に+${v}`))).join('・');
  RB.groupLabel = (data, m) => {
    const x = [];
    if (m.groupMark) x.push(RB.markLabel(data, m.groupMark));
    if (m.groupElement) x.push(nm(data, 'elements', m.groupElement) + '属性');
    if (m.groupType) x.push(nm(data, 'types', m.groupType));
    return '敵の' + (x.join('・') || '(条件なし)') + '全員';
  };
  const scaleText = (o) => o.scaleBy && num(o.scalePer) ? `+${SCALE_SHORT[o.scaleBy] || o.scaleBy}×${o.scalePer}${has(o.scaleMax) ? `(最大+${o.scaleMax})` : ''}` : '';

  RB.describeCond = function (c, data) {
    if (!c) return '';
    const r = data.rules || {};
    const parts = [];
    const stName = (v) => v === 'any' ? '何かの状態異常' : (v === 'none' ? '状態異常なし' : nm(data, 'statuses', v));
    if (has(c.selfHpBelowPct)) parts.push(`自分のHP${c.selfHpBelowPct}%以下`);
    if (has(c.selfHpAbovePct)) parts.push(`自分のHP${c.selfHpAbovePct}%以上`);
    if (has(c.targetHpBelowPct)) parts.push(`相手のHP${c.targetHpBelowPct}%以下`);
    if (has(c.targetElement)) parts.push(`相手が${nm(data, 'elements', c.targetElement)}属性`);
    if (has(c.targetType)) parts.push(`相手が${nm(data, 'types', c.targetType)}`);
    if (has(c.targetStatus)) parts.push(`相手が${stName(c.targetStatus)}`);
    if (has(c.selfStatus)) parts.push(`自分が${stName(c.selfStatus)}`);
    if (has(c.targetMark)) parts.push(`相手が${RB.markLabel(data, c.targetMark)}`);
    if (has(c.selfMark)) parts.push(`自分が${RB.markLabel(data, c.selfMark)}`);
    if (has(c.missesAtLeast)) parts.push(`ミス${c.missesAtLeast}回以上`);
    if (has(c.aliveAtMost)) parts.push(`残り${c.aliveAtMost}人以下`);
    if (has(c.roundAtLeast)) parts.push(`ラウンド${c.roundAtLeast}以降`);
    if (has(c.moveKind)) parts.push(`「${(RB.MOVE_KINDS[c.moveKind] || {}).name || c.moveKind}」を引いた`);
    if (has(c.dealtAtLeast)) parts.push(`ダメージ${c.dealtAtLeast}以上`);
    return parts.join('・');
  };

  RB.describeEffect = function (e, data) {
    const to = TO_SHORT[e.to || 'target'] || '相手';
    let s = '';
    switch (e.type) {
      case 'damage': {
        s = e.to === 'self' ? `自分に${num(e.power)}ダメージ` : `${to}に威力${num(e.power)}${scaleText(e)}${num(e.pctHp) ? `+現在HPの${e.pctHp}%` : ''}のダメージ`;
        if (num(e.hits) > 1) s += `×${e.hits}回`;
        const x = [];
        const eb = ebText(data, e); if (eb) x.push(eb);
        if (e.element) x.push(nm(data, 'elements', e.element) + '属性');
        if (e.fixed) x.push('固定');
        if (e.ignoreDef) x.push('防御無視');
        if (e.pierce) x.push('バリア貫通');
        if (e.drainPct) x.push(`${e.drainPct}%吸収`);
        if (e.recoilPct) x.push(`反動${e.recoilPct}%`);
        if (x.length) s += `(${x.join('・')})`;
        break;
      }
      case 'heal': {
        const x = [];
        if (num(e.amount)) x.push(String(e.amount));
        if (num(e.pct)) x.push(`最大HPの${e.pct}%`);
        if (num(e.ofDamagePct)) x.push(`与ダメの${e.ofDamagePct}%`);
        s = `${to}のHPを${x.join('+') || '0'}回復`;
        break;
      }
      case 'status': s = `${to}を${nm(data, 'statuses', e.status)}にする` + (has(e.turns) ? `(${e.turns}ターン)` : ''); break;
      case 'cure': s = `${to}の${e.status ? nm(data, 'statuses', e.status) : '状態異常'}を治す`; break;
      case 'mod': {
        const info = RB.MOD_STATS[e.stat] || { name: '?', unit: '' };
        const v = num(e.value);
        const label = info.name.replace(/ [+%]$/, '').replace(/ \(.*\)$/, '');
        if (e.stat === 'barrier') s = `${to}に${v}のバリア`;
        else if (e.stat === 'nullifyBelow') s = `${to}は${v}以下のダメージを無効`;
        else if (e.stat === 'guard') s = `${to}は攻撃を${v}回無効`;
        else if (e.stat === 'extraSpins') s = `${to}は${v + 1}回行動になる`;
        else if (e.stat === 'luck') s = `${to}はミスを${v}回まで引き直せる`;
        else if (e.stat === 'reflectPct') s = `${to}は受けたダメージの${v}%を反射`;
        else if (e.stat === 'nextPower') s = `${to}の次の攻撃の威力+${v}`;
        else if (e.stat === 'endure') s = `${to}は倒れそうな攻撃を${v}回HP1でこらえる`;
        else if (e.stat === 'regen') s = v > 0 ? `${to}は毎ターンHPが${v}回復` : `${to}は毎ターン${-v}ダメージ (衰弱)`;
        else if (e.stat === 'thorns') s = `${to}を攻撃した相手に${v}ダメージ (トゲ)`;
        else if (e.stat === 'missWeightPct') s = v > 0 ? `${to}のルーレットのミスが${v}%大きくなる (不運)` : `${to}のルーレットのミスが${-v}%小さくなる (幸運)`;
        else if (e.stat === 'healBlock') s = `${to}は回復できなくなる (回復封じ)`;
        else if (e.stat === 'taunt') s = `${to}が挑発: 敵は${to}しか狙えない`;
        else if (e.stat === 'stealth') s = `${to}は隠れ身: 狙われなくなる`;
        else s = `${to}の${label}${v > 0 ? '+' : ''}${v}${info.unit}`;
        s += num(e.turns) > 0 ? `(${e.turns}ターン)` : (['guard', 'barrier', 'luck', 'nextPower'].includes(e.stat) ? '' : '(永続)');
        break;
      }
      case 'clearMods': s = `${to}の${RB.CLEAR_WHICH[e.which || 'all']}を消す`; break;
      case 'invertMods': s = `${to}のバフとデバフを逆にする`; break;
      case 'stealMods': s = `${to}のバフを奪う`; break;
      case 'transferStatus': s = `自分の${e.status ? nm(data, 'statuses', e.status) : '状態異常'}を${to}に押し付ける`; break;
      case 'hpSwap': s = `自分と${to}のHP割合を入れ替える`; break;
      case 'hpChaos': s = RB.HP_CHAOS[e.mode || 'shuffle']; break;
      case 'randomMove': s = `${RB.RANDOM_POOL[e.pool || 'all']}からランダムに1つ使う`; break;
      case 'mimic': s = '相手が最後に使った技をまねする'; break;
      case 'attachGear': s = `${to}に${e.gear ? 'ギア「' + nm(data, 'gears', e.gear) + '」' : (RB.GEAR_POOL[e.pool || 'any'] || 'ギア') + (e.pool && e.pool !== 'any' ? 'をランダムに1つ' : 'をランダムに')}つける (ギアは1人1つまで)`; break;
      case 'removeGear': s = `${to}のギアを外す`; break;
      case 'transform': s = e.char === '@target' ? '選んだ相手と同じキャラに変身する' : `${e.to === 'self' || !e.to ? '' : to + 'を'}「${nm(data, 'chars', e.char)}」に${e.to === 'self' ? '進化する' : '変身させる'}`; break;
      case 'spinAgain': s = 'もう一回ルーレット'; break;
      default: s = e.type;
    }
    if (has(e.chance) && num(e.chance) < 100) s = `${e.chance}%で` + s;
    const c = RB.describeCond(e.cond, data);
    if (c) s = `[${c}なら] ` + s;
    if (e.link === 'then') s = '(成功したら) ' + s;
    if (e.link === 'else') s = '(ダメなら) ' + s;
    return s;
  };

  RB.describeMove = function (m, data, power) {
    const kind = m.kind || 'attack';
    const parts = [];
    if (kind === 'miss') return m.desc || '何も起きない';
    const p = has(power) ? num(power) : num(m.power);
    const tgt = m.target === 'group' ? RB.groupLabel(data, m) : RB.MOVE_TARGETS[m.target || 'single'];
    if (kind === 'attack') {
      let s = `${tgt}に威力${p}${scaleText(m)}`;
      if (num(m.pctHp)) s += `+現在HPの${m.pctHp}%`;
      if (num(m.hits) > 1) s += `×${m.hits}回`;
      const x = [];
      const eb = ebText(data, m); if (eb) x.push(eb);
      if (m.ignoreDef) x.push('防御無視');
      if (m.pierce) x.push('バリア貫通');
      if (m.drainPct) x.push(`与ダメの${m.drainPct}%回復`);
      if (m.recoilPct) x.push(`反動${m.recoilPct}%`);
      if (x.length) s += '・' + x.join('・');
      parts.push(s);
    }
    for (const e of (m.effects || [])) parts.push(RB.describeEffect(e, data));
    return parts.join(' / ') || (m.desc || '');
  };

  RB.describeAbility = function (a, data) {
    const parts = [];
    const ps = a.passive || {};
    const px = [];
    if (num(ps.atkFlat)) px.push(`攻撃力${ps.atkFlat > 0 ? '+' : ''}${ps.atkFlat}`);
    if (num(ps.atkPct)) px.push(`攻撃力${ps.atkPct > 0 ? '+' : ''}${ps.atkPct}%`);
    if (num(ps.defFlat)) px.push(`被ダメ-${ps.defFlat}`);
    if (num(ps.dmgTakenPct)) px.push(`被ダメージ${ps.dmgTakenPct > 0 ? '+' : ''}${ps.dmgTakenPct}%`);
    if (num(ps.hpPct)) px.push(`HP${ps.hpPct > 0 ? '+' : ''}${ps.hpPct}%`);
    if (num(ps.nullifyBelow)) px.push(`${ps.nullifyBelow}以下のダメージ無効`);
    if (num(ps.statusChanceBonus)) px.push(`状態異常付与率+${ps.statusChanceBonus}%`);
    if (num(ps.healPct)) px.push(`回復量+${ps.healPct}%`);
    if ((ps.immune || []).length) px.push(ps.immune.map(s => nm(data, 'statuses', s)).join('・') + 'にならない');
    for (const [el, m] of Object.entries(ps.resist || {})) if (has(m)) px.push(`${nm(data, 'elements', el)}属性から×${m}`);
    if (px.length) parts.push('常時: ' + px.join('・'));
    if (a.trigger && a.trigger !== 'passive' && (a.effects || []).length) {
      let t = RB.TRIGGERS[a.trigger] || a.trigger;
      if (a.trigger === 'onLowHp') t = `HPが${num(a.lowHpPct, 50)}%以下になった時`;
      const c = RB.describeCond(a.cond, data);
      parts.push(`${t}${c ? `(${c})` : ''}${has(a.chance) && num(a.chance) < 100 ? `${a.chance}%で` : ''}: ` + a.effects.map(e => RB.describeEffect(e, data)).join(' / ') + (a.once ? ' (1回のみ)' : ''));
    }
    return parts.join(' ／ ');
  };

  // 参照している場所 (削除時の警告用)
  RB.references = function (data, kind, id) {
    const out = [];
    const effRef = (effs) => (effs || []).some(e => (kind === 'statuses' && e.status === id) || (kind === 'elements' && (e.element === id || (e.elemBonus && id in e.elemBonus))) || (kind === 'elements' && e.cond && e.cond.targetElement === id) || (kind === 'types' && ((e.cond && e.cond.targetType === id) || (e.typeBonus && id in e.typeBonus))));
    if (kind === 'moves') for (const c of data.chars || []) if ((c.moves || []).some(e => e.move === id)) out.push('キャラ: ' + c.name);
    if (kind === 'moves') for (const x of data.gears || []) if ((x.moves || []).some(e => e.move === id)) out.push('ギア: ' + x.name);
    if (kind === 'moves') for (const x of data.items || []) if ((x.moves || []).some(e => e.move === id)) out.push('きりふだ: ' + x.name);
    if (kind === 'gears') for (const m of data.moves || []) if ((m.effects || []).some(e => e.type === 'attachGear' && e.gear === id)) out.push('技: ' + m.name);
    if (kind === 'chars') for (const m of data.moves || []) if ((m.effects || []).some(e => e.type === 'transform' && e.char === id)) out.push('技: ' + m.name);
    if (kind === 'abilities') for (const c of data.chars || []) if ((c.abilities || []).includes(id)) out.push('キャラ: ' + c.name);
    if (kind === 'elements' || kind === 'types') for (const c of data.chars || []) if (c.element === id || c.type === id) out.push('キャラ: ' + c.name);
    for (const m of data.moves || []) if (effRef(m.effects) || (kind === 'elements' && (m.element === id || (m.elemBonus && id in m.elemBonus))) || (kind === 'types' && m.typeBonus && id in m.typeBonus)) out.push('技: ' + m.name);
    for (const a of data.abilities || []) if (effRef(a.effects) || (kind === 'statuses' && a.passive && (a.passive.immune || []).includes(id))) out.push('特性: ' + a.name);
    return out;
  };

  return RB;
})();
