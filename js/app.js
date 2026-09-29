/* ヘッダ (あそぶ / つくる) とクラウド同期の表示。
   ゲーム (index.html) とエディタ (editor.html) は別ページ。
   claude.ai 用の1ファイル版だけは両方が同じページにあるので、ページ内で切り替える */
var RBApp = (function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const G = () => (typeof RBGame !== 'undefined' ? RBGame : null);
  const E = () => (typeof RBEditor !== 'undefined' ? RBEditor : null);
  const combined = !!(G() && E());
  let mode = G() ? 'play' : 'edit';

  function show(m) {
    mode = m === 'edit' ? 'edit' : 'play';
    if ($('#playApp')) $('#playApp').hidden = mode !== 'play';
    if ($('#editApp')) $('#editApp').hidden = mode !== 'edit';
    if ($('#modePlay')) $('#modePlay').classList.toggle('on', mode === 'play');
    if ($('#modeEdit')) $('#modeEdit').classList.toggle('on', mode === 'edit');
    try { history.replaceState(null, '', '#' + mode); } catch (e) { /* noop */ }
    window.scrollTo(0, 0);
    if (mode === 'edit') { if (E()) E().onShow(); } else if (G()) G().onShow();
  }

  // バトル中・オンライン中はページを離れないようにヘッダを隠す
  function setBattle(on) { $('#appHead').hidden = !!on; }

  function updateSync() { $('#syncInd').textContent = RBStore.statusLabel(); }

  function init() {
    if (combined) {
      $('#modePlay').onclick = (e) => { e.preventDefault(); show('play'); };
      $('#modeEdit').onclick = (e) => { e.preventDefault(); show('edit'); };
    }
    RBStore.onChange((ev) => {
      if (ev.type === 'status') updateSync();
      if (ev.type === 'data') { if (G()) G().onData(ev); if (E()) E().onData(ev); }
    });
    // 別タブ (ゲームとエディタを両方開いている時) の保存を反映
    window.addEventListener('storage', (e) => {
      if (e.key !== RBStore.KEY) return;
      RBStore.clearMemory();
      const ev = { type: 'data', why: 'remote' };
      if (G()) G().onData(ev); if (E()) E().onData(ev);
    });
    updateSync();
    if (combined) {
      let h = '';
      try { h = (location.hash || '').replace('#', ''); } catch (e) { /* noop */ }
      show(h === 'edit' ? 'edit' : 'play');
    } else if (E() && !G()) {
      E().onShow();
    }
    RBStore.initCloud();
  }

  init();
  return { show, setBattle, get mode() { return mode; } };
})();
