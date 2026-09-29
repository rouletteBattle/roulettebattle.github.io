/* ルーレット描画 (canvas) と効果音 */
var RBSound = (function () {
  let ctx = null, enabled = true;
  try { enabled = localStorage.getItem('rouletteBattle.sound') !== 'off'; } catch (e) { /* noop */ }
  function ac() {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type, vol, slide) {
    if (!enabled) return;
    const a = ac(); if (!a) return;
    const o = a.createOscillator(), gn = a.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, a.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, a.currentTime + dur);
    gn.gain.setValueAtTime(vol || 0.08, a.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(gn).connect(a.destination);
    o.start(); o.stop(a.currentTime + dur + 0.02);
  }
  return {
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; try { localStorage.setItem('rouletteBattle.sound', v ? 'on' : 'off'); } catch (e) { /* noop */ } },
    unlock() { ac(); },
    tick() { tone(1400, 0.03, 'square', 0.05); },
    stop() { tone(880, 0.12, 'triangle', 0.12); setTimeout(() => tone(1320, 0.18, 'triangle', 0.12), 90); },
    hit() { tone(180, 0.18, 'sawtooth', 0.12, 60); },
    heal() { tone(660, 0.12, 'sine', 0.1, 990); },
    miss() { tone(300, 0.25, 'triangle', 0.1, 150); },
    ko() { tone(400, 0.5, 'sawtooth', 0.12, 50); },
    win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.12), i * 130)); },
  };
})();

class RBWheel {
  constructor(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.segs = [];
    this.rot = 0;           // ラジアン。ポインタは上 (12時)
    this.hl = -1;
    this.spinning = false;
    this.resize();
  }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const size = this.cv.clientWidth || 320;
    this.cv.width = Math.round(size * dpr);
    this.cv.height = Math.round(size * dpr);
    this.scale = dpr;
    this.draw();
  }
  // segs: [{ label, sub, weight, color, disabled }]
  setSegments(segs) {
    this.segs = segs || [];
    this.hl = -1;
    this.total = this.segs.reduce((a, s) => a + s.weight, 0) || 1;
    let acc = 0;
    for (const s of this.segs) { s._a0 = acc / this.total; acc += s.weight; s._a1 = acc / this.total; }
    this.draw();
  }
  static textColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#111';
    const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#1a1a22' : '#ffffff';
  }
  draw() {
    const g = this.g, W = this.cv.width, R = W / 2, cx = R, cy = R, rr = R * 0.94;
    g.clearRect(0, 0, W, W);
    if (!this.segs.length) return;
    const TAU = Math.PI * 2;
    // 外周リング
    g.beginPath(); g.arc(cx, cy, R * 0.995, 0, TAU); g.fillStyle = '#1b1d2b'; g.fill();
    for (let i = 0; i < this.segs.length; i++) {
      const s = this.segs[i];
      const a0 = this.rot + s._a0 * TAU - Math.PI / 2, a1 = this.rot + s._a1 * TAU - Math.PI / 2;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, rr, a0, a1); g.closePath();
      g.fillStyle = s.disabled ? '#55586a' : s.color;
      g.fill();
      if (s.disabled) {
        g.save(); g.clip();
        g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 6 * this.scale;
        for (let k = -W; k < W; k += 16 * this.scale) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + W, W); g.stroke(); }
        g.restore();
      }
      if (i === this.hl) {
        g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, rr, a0, a1); g.closePath();
        g.fillStyle = 'rgba(255,255,255,.28)'; g.fill();
        g.lineWidth = 5 * this.scale; g.strokeStyle = '#ffd84a'; g.stroke();
      }
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr);
      g.strokeStyle = '#1b1d2b'; g.lineWidth = 2.5 * this.scale; g.stroke();
      // ラベル
      const span = (s._a1 - s._a0) * TAU;
      const mid = (a0 + a1) / 2;
      g.save();
      g.translate(cx, cy); g.rotate(mid);
      const col = s.disabled ? '#e8e8f0' : RBWheel.textColor(s.color);
      g.fillStyle = col; g.textAlign = 'right'; g.textBaseline = 'middle';
      const maxW = rr * 0.66;
      let fs = Math.min(rr * 0.105, span * rr * 0.42);
      if (fs >= 7 * this.scale) {
        const label = s.disabled ? '✖ ' + s.label : s.label;
        g.font = `bold ${fs}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Meiryo", sans-serif`;
        let w = g.measureText(label).width;
        if (w > maxW) { fs = fs * maxW / w; g.font = `bold ${fs}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Meiryo", sans-serif`; }
        const hasSub = s.sub && span * rr > fs * 2.3;
        g.fillText(label, rr * 0.92, hasSub ? -fs * 0.45 : 0);
        if (hasSub) {
          g.globalAlpha = 0.75;
          g.font = `${fs * 0.72}px "M PLUS Rounded 1c", "Meiryo", sans-serif`;
          g.fillText(s.sub, rr * 0.92, fs * 0.62);
          g.globalAlpha = 1;
        }
      }
      g.restore();
    }
    // ハブ
    g.beginPath(); g.arc(cx, cy, rr * 0.16, 0, TAU);
    const grd = g.createRadialGradient(cx - rr * 0.05, cy - rr * 0.05, 2, cx, cy, rr * 0.16);
    grd.addColorStop(0, '#fff6c8'); grd.addColorStop(1, '#d9a400');
    g.fillStyle = grd; g.fill();
    g.lineWidth = 3 * this.scale; g.strokeStyle = '#1b1d2b'; g.stroke();
    // ポインタ (上)
    g.beginPath();
    g.moveTo(cx, R * 0.16); g.lineTo(cx - R * 0.07, 0); g.lineTo(cx + R * 0.07, 0); g.closePath();
    g.fillStyle = '#ff4d6d'; g.fill(); g.lineWidth = 2 * this.scale; g.strokeStyle = '#fff'; g.stroke();
  }
  // ポインタ位置の区画
  indexAtPointer() {
    const TAU = Math.PI * 2;
    let f = ((-this.rot) % TAU + TAU) % TAU / TAU;
    for (let i = 0; i < this.segs.length; i++) if (f >= this.segs[i]._a0 && f < this.segs[i]._a1) return i;
    return this.segs.length - 1;
  }
  // index の区画に止まるように回す
  spinTo(index, duration) {
    const TAU = Math.PI * 2;
    const s = this.segs[index];
    if (!s) return Promise.resolve();
    duration = duration == null ? 2600 : duration;
    const margin = Math.min(0.3, 0.12 + 0.1 * Math.random());
    const f = s._a0 + (s._a1 - s._a0) * (margin + (1 - 2 * margin) * Math.random());
    const start = this.rot;
    const turns = duration < 500 ? 1 : (3 + Math.floor(duration / 900));
    let target = -f * TAU;
    while (target < start + turns * TAU) target += TAU;
    this.hl = -1;
    this.spinning = true;
    let last = this.indexAtPointer();
    return new Promise((resolve) => {
      if (duration <= 0) { this.rot = target % TAU; this.hl = index; this.spinning = false; this.draw(); resolve(); return; }
      const t0 = performance.now();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.rot = target % TAU; this.hl = index; this.spinning = false; this.draw(); RBSound.stop(); resolve();
      };
      const step = (now) => {
        if (done) return;
        const t = Math.min(1, (now - t0) / duration);
        const e = 1 - Math.pow(1 - t, 4);
        this.rot = start + (target - start) * e;
        const cur = this.indexAtPointer();
        if (cur !== last) { last = cur; RBSound.tick(); }
        this.draw();
        if (t < 1) requestAnimationFrame(step); else finish();
      };
      requestAnimationFrame(step);
      // タブが裏にあると requestAnimationFrame が止まるので、時間で確実に終わらせる
      setTimeout(finish, duration + 300);
    });
  }
}

// キャラのルーレットを RBWheel 用の区画に変換
function rbWheelSegments(segs) {
  const tgt = (m) => m.target === 'group' ? (m.groupMark === 'dot' ? '●' : m.groupMark === 'star' ? '★' : '') + '全' : (m.target === 'allEnemies' || m.target === 'everyone') ? '全' : '';
  return segs.map(s => ({
    label: s.move.name,
    sub: s.kind === 'attack' && s.power > 0
      ? tgt(s.move) + String(s.power) + (s.move.hits > 1 ? '×' + s.move.hits : '') + (s.move.scaleBy ? '↑' : '')
      : tgt(s.move) + (RB.MOVE_KINDS[s.kind] || {}).name,
    weight: s.weight,
    color: s.color,
    disabled: !!s.disabledBy,
  }));
}
