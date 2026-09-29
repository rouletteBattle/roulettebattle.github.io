/* オンライン対戦 (プライベートルーム)
   方式: PeerJS (WebRTC の P2P)。ルームを作った人 (ホスト) がゲームを動かし、
   参加者はホストから届く画面の状態を表示して、自分の番の操作だけを送る。 */
var RBNet = (function () {
  'use strict';
  const PREFIX = 'rbattle-';
  const PEERJS = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
  let loading = null;
  let peer = null, role = null, hostConn = null;
  const conns = new Map();   // id -> { conn, lastSeen }
  let onEvent = () => {};
  let pingTimer = null;

  function available() {
    if (typeof window === 'undefined') return { ok: false, reason: 'ブラウザで開いてください' };
    if (window.claude && typeof window.claude.use === 'function') return { ok: false, reason: 'claude.ai 上のページではオンライン対戦は使えません (通信が制限されています)。オンライン用のページを開いてください。' };
    if (!window.RTCPeerConnection) return { ok: false, reason: 'このブラウザはオンライン対戦 (WebRTC) に対応していません' };
    if (!window.isSecureContext && location.protocol !== 'file:') return { ok: false, reason: 'https のページで開いてください (http では通信できません)' };
    return { ok: true };
  }

  function load() {
    if (window.Peer) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = PEERJS;
      sc.onload = () => res();
      sc.onerror = () => { loading = null; rej(new Error('通信ライブラリを読み込めませんでした。インターネット接続を確認してください。')); };
      document.head.appendChild(sc);
    });
    return loading;
  }

  function randCode() {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }

  function peerError(e) {
    const t = e && e.type;
    if (t === 'unavailable-id') return 'そのルームコードは使用中です。もう一度作り直してください。';
    if (t === 'peer-unavailable') return 'ルームが見つかりません。コードを確かめるか、ホストがルームを開いているか確認してください。';
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return '通信サーバーにつながりません。インターネット接続を確認してください。';
    if (t === 'browser-incompatible') return 'このブラウザは対応していません';
    return String((e && e.message) || e || '通信エラー');
  }

  function startPing() {
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      const now = Date.now();
      if (role === 'host') {
        for (const [id, c] of conns) {
          try { c.conn.send({ t: 'ping' }); } catch (e) { /* noop */ }
          if (now - c.lastSeen > 16000) dropConn(id, '応答がありません');
        }
      } else if (role === 'guest' && hostConn) {
        try { hostConn.send({ t: 'ping' }); } catch (e) { /* noop */ }
        if (now - (hostConn._lastSeen || now) > 16000) { onEvent({ type: 'close', reason: 'ホストから応答がありません' }); close(); }
      }
    }, 4000);
  }

  function dropConn(id, reason) {
    const c = conns.get(id);
    if (!c) return;
    conns.delete(id);
    try { c.conn.close(); } catch (e) { /* noop */ }
    onEvent({ type: 'leave', id, reason });
  }

  // ホスト: ルームを作る。戻り値はルームコード
  async function host(handler) {
    const av = available(); if (!av.ok) throw new Error(av.reason);
    await load();
    close();
    onEvent = handler || (() => {});
    role = 'host';
    const code = randCode();
    return new Promise((resolve, reject) => {
      peer = new window.Peer(PREFIX + code, { debug: 1 });
      let opened = false;
      peer.on('open', () => { opened = true; startPing(); resolve(code); });
      peer.on('error', (e) => { if (!opened) reject(new Error(peerError(e))); else onEvent({ type: 'error', message: peerError(e) }); });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* noop */ } });
      peer.on('connection', (conn) => {
        const id = conn.connectionId;
        conn.on('open', () => {
          if (conns.size >= 11) { conn.send({ t: 'reject', reason: 'ルームが満員です (最大12人)' }); setTimeout(() => conn.close(), 500); return; }
          conns.set(id, { conn, lastSeen: Date.now() });
        });
        conn.on('data', (msg) => {
          const c = conns.get(id); if (!c) return;
          c.lastSeen = Date.now();
          if (!msg || msg.t === 'ping') return;
          if (msg.t === 'hello') onEvent({ type: 'join', id, hello: msg });
          else onEvent({ type: 'msg', id, msg });
        });
        conn.on('close', () => dropConn(id, '切断しました'));
        conn.on('error', () => dropConn(id, '通信エラー'));
      });
    });
  }

  // 参加者: ルームに入る
  async function join(code, hello, handler) {
    const av = available(); if (!av.ok) throw new Error(av.reason);
    await load();
    close();
    onEvent = handler || (() => {});
    role = 'guest';
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return new Promise((resolve, reject) => {
      peer = new window.Peer(undefined, { debug: 1 });
      let done = false;
      const fail = (m) => { if (!done) { done = true; reject(new Error(m)); } else onEvent({ type: 'close', reason: m }); };
      peer.on('error', (e) => fail(peerError(e)));
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true });
        hostConn = conn;
        const timer = setTimeout(() => fail('ルームに接続できませんでした。コードを確かめてください。'), 15000);
        conn.on('open', () => {
          clearTimeout(timer);
          conn._lastSeen = Date.now();
          conn.send(Object.assign({ t: 'hello' }, hello));
          done = true; startPing(); resolve(code);
        });
        conn.on('data', (msg) => {
          conn._lastSeen = Date.now();
          if (!msg || msg.t === 'ping') return;
          if (msg.t === 'reject') { onEvent({ type: 'close', reason: msg.reason }); close(); return; }
          onEvent({ type: 'msg', msg });
        });
        conn.on('close', () => { if (role === 'guest') { onEvent({ type: 'close', reason: 'ホストとの接続が切れました' }); close(); } });
        conn.on('error', () => fail('通信エラー'));
      });
    });
  }

  function send(id, msg) { const c = conns.get(id); if (c) { try { c.conn.send(msg); } catch (e) { /* noop */ } } }
  function broadcast(msg) { for (const c of conns.values()) { try { c.conn.send(msg); } catch (e) { /* noop */ } } }
  function sendHost(msg) { if (hostConn) { try { hostConn.send(msg); } catch (e) { /* noop */ } } }
  function kick(id, reason) { send(id, { t: 'reject', reason: reason || 'ホストがあなたをルームから外しました' }); setTimeout(() => dropConn(id), 400); }

  function close() {
    clearInterval(pingTimer);
    const r = role;
    role = null;
    for (const c of conns.values()) { try { c.conn.close(); } catch (e) { /* noop */ } }
    conns.clear();
    if (hostConn) { try { hostConn.close(); } catch (e) { /* noop */ } hostConn = null; }
    if (peer) { try { peer.destroy(); } catch (e) { /* noop */ } peer = null; }
    return r;
  }

  return {
    available, host, join, send, broadcast, sendHost, kick, close,
    get role() { return role; },
    get guestIds() { return [...conns.keys()]; },
  };
})();
