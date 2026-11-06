/**
 * CrossTalk Cockpit: a standalone protocol v2 client for humans.
 *
 * Connects to any hub over WebSocket, sends `hello`, waits for `welcome`, then
 * speaks request/result (`{type, id}` -> `{type:'result', id, ok, data|error}`)
 * and renders unsolicited events.
 *
 * Every conversation is identified by its address (ChannelInfo.id, "xt_…").
 * The address is also the capability to join, so the cockpit shows it with a
 * copy button and supports deep links: cockpit.html#xt_…
 *
 * Layout: channels on the left, the conversation in the middle, a details
 * drawer (members, claims, locks, questions) on the right. On a phone the
 * channel list is a slide-over drawer and the details a bottom sheet.
 *
 * Kept in localStorage (all optional; everything works with storage blocked):
 * hub URL, token, display name, joined channels per hub (rejoined on reload),
 * owner keys of channels started here, per-channel drafts, panel state, theme.
 *
 * All user content is rendered with textContent / text nodes; nothing is ever
 * assigned to innerHTML. No inline scripts or style attributes (the site sends
 * a strict CSP); styles set from here go through the CSSOM.
 */
(function () {
  'use strict';

  const PROTOCOL_VERSION = 2;
  // The public hub works from any browser. A hub on your own machine is
  // ws://localhost:4488 ("This computer" in Hub settings).
  const DEFAULT_URL = 'wss://hub-production-a114.up.railway.app';
  const LOCAL_URL = 'ws://localhost:4488';
  const REQUEST_TIMEOUT_MS = 15000;
  const HELLO_TIMEOUT_MS = 10000;
  const MAX_TIMELINE = 500;
  const PUBLIC_PAGE = 50;
  const POLL_MS = 30000;
  const GROUP_MS = 5 * 60 * 1000;
  const ADDRESS = /^xt_[A-Za-z0-9_-]{16,}$/;
  const ADDRESS_IN_TEXT = /xt_[A-Za-z0-9_-]{16,}/;
  const STORE_URL = 'crosstalk.cockpit.url';
  const STORE_TOKEN = 'crosstalk.cockpit.token';
  const STORE_NAME = 'crosstalk.cockpit.name';
  /** Owner keys of conversations started in this browser, by "hub|address". Never sent anywhere but that hub. */
  const STORE_KEYS = 'crosstalk.cockpit.owner-keys';
  /** Joined channels by hub: { [hub]: [{ id, name, seen }] }, rejoined on reload. */
  const STORE_CHANNELS = 'crosstalk.cockpit.channels';
  /** Unsent composer text by "hub|address". */
  const STORE_DRAFTS = 'crosstalk.cockpit.drafts';
  /** { sidebar, details, theme, selected: { [hub]: address } } */
  const STORE_UI = 'crosstalk.cockpit.ui';
  /** sessionStorage: this tab's resume token, written as the page goes away so a reload carries on as the same member. */
  const STORE_RESUME = 'crosstalk.cockpit.resume';
  const RECONNECT_MAX_MS = 15000;
  const BASE_TITLE = document.title;

  // ---------------------------------------------------------------------------
  // Storage (may be unavailable: private mode, blocked site data)
  // ---------------------------------------------------------------------------

  function load(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function save(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch { /* ignore */ }
  }
  function loadJSON(key, fallback) {
    try {
      const v = JSON.parse(load(key) || 'null');
      return v && typeof v === 'object' ? v : fallback;
    } catch { return fallback; }
  }
  const saveJSON = (key, value) => save(key, JSON.stringify(value));

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  /** Build an element. Children that are strings become text nodes. */
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  /** Small stroke icons for system chips and controls. */
  const ICONS = {
    join: 'M15 19a6 6 0 0 0-12 0M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
    leave: 'M15 19a6 6 0 0 0-12 0M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 11h6',
    lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
    wait: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    claim: 'M5 12.5l4 4L19 7',
    stall: 'M12 8v5M12 16.5v.5M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    question: 'M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 17.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    answer: 'M4 12.5l5 5L20 6.5',
    config: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
    notice: 'M12 8v5M12 16.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    dm: 'M4 6h16v11H8l-4 3z',
    slot: 'M4 6h16v4H4zM4 14h16v4H4z',
    close: 'M6 6l12 12M18 6 6 18',
  };
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'ico');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICONS[name] || ICONS.notice);
    svg.append(path);
    return svg;
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function formatFull(ts) {
    return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }
  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  }
  /** Short "last activity" label for the channel list. */
  function ago(ts) {
    if (!ts) return '';
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 7 * 86400) return new Date(ts).toLocaleDateString([], { weekday: 'short' });
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function formatRemaining(ms) {
    if (ms <= 0) return 'expiring';
    const s = Math.ceil(ms / 1000);
    if (s < 60) return `${s}s left`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s left`;
    return `${Math.floor(m / 60)}h ${m % 60}m left`;
  }

  function initials(name) {
    const parts = String(name || '?').replace(/[^\p{L}\p{N}\s_-]/gu, '').split(/[\s_-]+/).filter(Boolean);
    const s = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || '?').slice(0, 2);
    return s.toUpperCase();
  }

  /** Display label for a conversation; names are not unique, so callers also show the address. */
  const label = (info) => (info && info.name) || 'Untitled channel';
  const shortAddress = (id) => (id && id.length > 10 ? `${id.slice(0, 7)}…${id.slice(-4)}` : id || '');
  const isLive = () => state.status === 'connected' || state.status === 'connecting' || state.status === 'reconnecting';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const state = {
    ws: null,
    /** 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error' */
    status: 'disconnected',
    me: null,
    serverVersion: '',
    nextId: 1,
    /** id -> { resolve, reject, timer } */
    pending: new Map(),
    /** ChannelInfo[] from channel.list scope 'joined' */
    channels: [],
    /** Public directory (scope 'public'), loaded on demand. */
    directory: { loaded: false, channels: [], cursor: undefined, loading: false },
    /**
     * Conversations this cockpit is a member of, keyed by address.
     * address -> { info, members: Map<id, AgentInfo>, attention: Map<id, MemberAttention>,
     *              locks: Map<file, FileLock>, questions: Map<id, UserQuestion>,
     *              claims: Map<id, TaskClaim>, slots: Map<name, Slot>,
     *              timeline: Array<entry>, seen: Set<messageId>, lastMessage, unread, mention, polledAt }
     */
    joined: new Map(),
    /** Addresses being (re)joined right now. */
    joining: new Set(),
    /** Selected conversation address. */
    selected: null,
    /** From the last welcome: lets a reconnect carry on as the same member. */
    resumeToken: null,
    /** Hub URL (as typed) of the current session, for owner keys and reconnects. */
    hub: '',
    /** What the next connect uses; edited in Hub settings. */
    config: { url: DEFAULT_URL, token: '', name: '' },
    reconnectTimer: null,
    reconnectDelay: 1000,
    /** Callers of ensureConnected() waiting for the next welcome (or failure). */
    waiters: [],
    /** Conversations whose "invite your agents" panel was dismissed. */
    inviteHidden: new Set(),
    /** Persisted UI preferences. */
    ui: { sidebar: true, details: true, theme: 'system', selected: {} },
    /** Transient drawer state for narrow screens. */
    overlay: { sidebar: false, details: false },
    readTimer: null,
    /** Resume token handed over from before a reload of this tab. */
    pendingResume: null,
  };

  const narrowMq = window.matchMedia('(max-width: 760px)');
  const midMq = window.matchMedia('(max-width: 1100px)');

  // ---------------------------------------------------------------------------
  // Owner keys: the person who starts a conversation here answers its agents'
  // questions here. Kept in this browser only.
  // ---------------------------------------------------------------------------

  function ownerKeys() {
    try { return JSON.parse(load(STORE_KEYS) || '{}') || {}; } catch { return {}; }
  }
  function ownerKey(address) {
    return ownerKeys()[`${state.hub}|${address}`] || null;
  }
  function saveOwnerKey(address, key) {
    const keys = ownerKeys();
    keys[`${state.hub}|${address}`] = key;
    save(STORE_KEYS, JSON.stringify(keys));
  }

  // ---------------------------------------------------------------------------
  // Saved channels, drafts and UI preferences
  // ---------------------------------------------------------------------------

  function savedChannels(hub = state.hub || state.config.url) {
    const all = loadJSON(STORE_CHANNELS, {});
    return Array.isArray(all[hub]) ? all[hub].filter((c) => c && ADDRESS.test(c.id)) : [];
  }
  function updateSaved(fn) {
    const hub = state.hub || state.config.url;
    const all = loadJSON(STORE_CHANNELS, {});
    const list = Array.isArray(all[hub]) ? all[hub] : [];
    all[hub] = fn(list);
    saveJSON(STORE_CHANNELS, all);
  }
  function rememberChannel(info) {
    updateSaved((list) => {
      const found = list.find((c) => c.id === info.id);
      if (found) { found.name = info.name || ''; return list; }
      return [...list, { id: info.id, name: info.name || '', seen: Date.now() }];
    });
  }
  function forgetChannel(address) {
    updateSaved((list) => list.filter((c) => c.id !== address));
    saveDraft(address, '');
  }
  function markSeen(address, ts) {
    updateSaved((list) => {
      const found = list.find((c) => c.id === address);
      if (found && ts > (found.seen || 0)) found.seen = ts;
      return list;
    });
  }

  const draftKey = (address) => `${state.hub}|${address}`;
  function loadDraft(address) {
    return loadJSON(STORE_DRAFTS, {})[draftKey(address)] || '';
  }
  function saveDraft(address, text) {
    const drafts = loadJSON(STORE_DRAFTS, {});
    if (text) drafts[draftKey(address)] = text;
    else delete drafts[draftKey(address)];
    saveJSON(STORE_DRAFTS, drafts);
  }

  function saveUi() { saveJSON(STORE_UI, state.ui); }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  function buildUrl(raw, token) {
    let url;
    try { url = new URL(raw); } catch { throw new Error(`"${raw}" is not a valid URL.`); }
    if (url.protocol === 'http:') url.protocol = 'ws:';
    else if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      throw new Error('The hub URL must start with ws:// or wss://.');
    }
    if (token) url.searchParams.set('token', token);
    return url.toString();
  }

  /**
   * Opens the hub connection. `resuming` is an automatic reconnect after a drop:
   * conversations stay on screen and the hub is asked to resume our membership.
   */
  function connect(resuming) {
    const rawUrl = state.config.url.trim() || DEFAULT_URL;
    const token = state.config.token.trim();
    const name = state.config.name.trim();

    let url;
    try { url = buildUrl(rawUrl, token); } catch (err) {
      showNotice(err.message);
      settleWaiters(err);
      openSettings();
      return;
    }

    clearTimeout(state.reconnectTimer);
    // After a reload of this tab, carry on as the same member if the hub still holds it.
    const handover = !resuming && state.pendingResume && state.pendingResume.hub === rawUrl && state.pendingResume.name === name
      ? state.pendingResume.token : undefined;
    state.pendingResume = null;
    if (!resuming) {
      save(STORE_URL, rawUrl);
      save(STORE_TOKEN, token);
      save(STORE_NAME, name);
      disconnect();
      hideNotice();
      state.hub = rawUrl;
    }
    setStatus('connecting');

    let ws;
    try { ws = new WebSocket(url); } catch (err) {
      setStatus('error');
      showNotice(`Could not open a connection: ${err.message}`);
      return;
    }
    state.ws = ws;

    let welcomed = false;
    const helloTimer = setTimeout(() => {
      if (!welcomed && state.ws === ws) {
        showNotice('The hub did not answer the hello handshake. Is it running protocol v2?');
        ws.close();
      }
    }, HELLO_TIMEOUT_MS);

    ws.addEventListener('open', () => {
      const suffix = Math.random().toString(36).slice(2, 6);
      send({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        // A named person takes part; an anonymous tab is an observer.
        agent: name
          ? { name, role: 'person', environment: 'web', currentTask: 'In the cockpit' }
          : { name: `cockpit-${suffix}`, role: 'observer', environment: 'web', currentTask: 'Watching conversations' },
        resume: resuming && state.resumeToken ? state.resumeToken : handover,
      });
    });

    ws.addEventListener('message', (ev) => {
      if (state.ws !== ws) return;
      let frame;
      try { frame = JSON.parse(ev.data); } catch { return; }
      if (!frame || typeof frame.type !== 'string') return;
      if (frame.type === 'welcome') {
        welcomed = true;
        clearTimeout(helloTimer);
        onWelcome(frame);
        return;
      }
      if (!welcomed && frame.type === 'error') {
        showNotice(`The hub rejected the handshake: ${(frame.error && frame.error.message) || 'unknown error'}`);
        return;
      }
      handleFrame(frame);
    });

    ws.addEventListener('close', (ev) => {
      clearTimeout(helloTimer);
      if (state.ws !== ws) return;
      const wasConnected = state.status === 'connected';
      // Dropped (sleep, Wi-Fi, hub redeploy): keep everything on screen and reconnect.
      if ((welcomed || resuming) && ev.code !== 1000) {
        state.ws = null;
        rejectPending();
        scheduleReconnect();
        render();
        return;
      }
      resetSession();
      settleWaiters(new Error('Could not reach the hub. Check Hub settings.'));
      setStatus(welcomed || ev.wasClean ? 'disconnected' : 'error');
      if (!welcomed && $('notice').hidden) {
        showNotice(...connectionHint(rawUrl, token, ev));
      } else if (wasConnected && !ev.wasClean) {
        showNotice('Lost the connection to the hub.');
      }
      render();
    });

    ws.addEventListener('error', () => { /* `close` follows and reports */ });
  }

  /**
   * Browsers hide why a WebSocket upgrade failed, so explain both likely causes:
   * the hub is down, or it refused this page's origin / token.
   * Returns [text, command?] for showNotice.
   */
  function connectionHint(rawUrl, token, ev) {
    if (ev.reason) return [`The hub closed the connection: ${ev.reason}`];
    const origin = location.origin && location.origin !== 'null' ? location.origin : '';
    const mixed = location.protocol === 'https:' && rawUrl.startsWith('ws://') &&
      !/^ws:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(rawUrl);
    if (mixed) {
      return ['Could not connect. This page is served over HTTPS, so the browser blocks plain ws:// to remote hosts. Use a wss:// URL.'];
    }
    const lead = `Could not connect to ${rawUrl}. Either the hub is not running, or it refused this page.`;
    if (token) return [`${lead} Check the token in Hub settings.`];
    if (!origin) return [`${lead} Enter the hub's token in Hub settings.`];
    return [`${lead} Enter the hub's token in Hub settings, or allow this page's origin when starting the hub:`,
      `crosstalk serve --allow-origin ${origin}`];
  }

  /**
   * Resolves once connected, connecting first if needed, so starting or opening
   * a conversation never needs a separate "connect" step. A name typed since we
   * connected applies if we aren't in any conversation yet.
   */
  function ensureConnected() {
    const name = state.config.name.trim();
    const renamed = state.me && name && state.me.name !== name && state.joined.size === 0;
    if (state.status === 'connected' && !renamed) return Promise.resolve();
    const ready = new Promise((resolve, reject) => state.waiters.push({ resolve, reject }));
    if (renamed || (state.status !== 'connecting' && state.status !== 'reconnecting')) connect(false);
    return ready;
  }

  function settleWaiters(err) {
    const waiters = state.waiters.splice(0);
    for (const w of waiters) err ? w.reject(err) : w.resolve();
  }

  function scheduleReconnect() {
    setStatus('reconnecting');
    clearTimeout(state.reconnectTimer);
    const delay = state.reconnectDelay;
    state.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS);
    state.reconnectTimer = setTimeout(() => connect(true), delay);
  }

  /** Coming back online or to the tab: retry now rather than at the end of the backoff. */
  function reconnectSoon() {
    if (state.status !== 'reconnecting') return;
    state.reconnectDelay = 1000;
    connect(true);
  }

  function rejectPending() {
    for (const p of state.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Disconnected'));
    }
    state.pending.clear();
  }

  function disconnect() {
    clearTimeout(state.reconnectTimer);
    state.reconnectDelay = 1000;
    state.resumeToken = null;
    const ws = state.ws;
    state.ws = null;
    resetSession();
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, 'cockpit disconnect');
    setStatus('disconnected');
    render();
  }

  function resetSession() {
    state.ws = state.ws && state.ws.readyState <= WebSocket.OPEN ? state.ws : null;
    rejectPending();
    state.me = null;
    state.channels = [];
    state.directory = { loaded: false, channels: [], cursor: undefined, loading: false };
    state.joined.clear();
    state.joining.clear();
  }

  function send(frame) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) throw new Error('Not connected');
    state.ws.send(JSON.stringify(frame));
  }

  /** Send a request frame and resolve with its result data. */
  function request(type, params) {
    return new Promise((resolve, reject) => {
      const id = `c${state.nextId++}`;
      const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(new Error(`${type} timed out`));
      }, REQUEST_TIMEOUT_MS);
      state.pending.set(id, { resolve, reject, timer });
      try {
        send({ type, id, ...params });
      } catch (err) {
        clearTimeout(timer);
        state.pending.delete(id);
        reject(err);
      }
    });
  }

  function onWelcome(frame) {
    state.me = frame.agent;
    state.serverVersion = frame.serverVersion || '';
    state.resumeToken = frame.resumeToken || null;
    state.reconnectDelay = 1000;
    setStatus('connected');
    hideNotice();
    render();
    settleWaiters();
    if ($('directory').open) loadDirectory(true);

    const fromHash = decodeURIComponent(location.hash.slice(1));
    const target = ADDRESS.test(fromHash) ? fromHash : (state.selected || state.ui.selected[state.hub] || null);

    // Resumed as the same member: catch up on what we hold. Otherwise (fresh page, too late
    // to resume, or an older hub) join every channel we were in again, plus a deep link.
    const resumed = !!frame.resumed;
    if (resumed) for (const address of state.joined.keys()) pollChannel(address);
    const addresses = new Set([...state.joined.keys(), ...savedChannels().map((c) => c.id)]);
    if (ADDRESS.test(fromHash)) addresses.add(fromHash);
    state.selected = target && addresses.has(target) ? target : null;
    const joins = [...addresses].filter((address) => !(resumed && state.joined.has(address))).map((address) => {
      state.joining.add(address);
      // A resumed member is still in its channels: read their state rather than joining again.
      const fetch = resumed
        ? request('channel.state', { channel: address }).catch(() => request('channel.join', { channel: address }))
        : request('channel.join', { channel: address });
      return fetch
        .then((snap) => adoptSnapshot(snap, address === target))
        .catch((err) => {
          state.joined.delete(address);
          if (err.code === 'not_found' || err.code === 'forbidden') {
            forgetChannel(address);
            showNotice(`${address === fromHash ? 'That channel' : `Channel ${shortAddress(address)}`} is gone or no longer lets you in (${err.message}).`);
          } else if (address === fromHash) {
            showNotice(err.message);
          }
          if (state.selected === address) state.selected = null;
        })
        .finally(() => { state.joining.delete(address); render(); });
    });
    render();
    Promise.allSettled(joins).then(() => refreshChannels());
  }

  // ---------------------------------------------------------------------------
  // Incoming frames
  // ---------------------------------------------------------------------------

  function handleFrame(frame) {
    switch (frame.type) {
      case 'result': {
        const p = state.pending.get(frame.id);
        if (!p) return;
        state.pending.delete(frame.id);
        clearTimeout(p.timer);
        if (frame.ok) p.resolve(frame.data);
        else {
          const e = frame.error || {};
          const err = new Error(e.message || e.code || 'Request failed');
          err.code = e.code;
          p.reject(err);
        }
        return;
      }
      case 'error':
        showNotice(`Hub error: ${(frame.error && (frame.error.message || frame.error.code)) || 'unknown'}`);
        return;
      case 'message':
        if (frame.message) addMessage(frame.message);
        return;
      case 'member.joined': {
        const ch = state.joined.get(frame.channel);
        if (!ch || !frame.agent) return;
        const known = ch.members.has(frame.agent.id);
        ch.members.set(frame.agent.id, frame.agent);
        if (!known) addActivity(ch, 'join', `${frame.agent.name} joined`);
        syncMemberCount(ch);
        renderIfSelected(frame.channel, true);
        return;
      }
      case 'member.left': {
        const ch = state.joined.get(frame.channel);
        if (!ch || !frame.agent) return;
        ch.members.delete(frame.agent.id);
        ch.attention.delete(frame.agent.id);
        const how = { disconnected: 'disconnected', kicked: 'was removed' }[frame.reason] || 'left';
        addActivity(ch, 'leave', `${frame.agent.name} ${how}`);
        syncMemberCount(ch);
        renderIfSelected(frame.channel, true);
        return;
      }
      case 'member.updated': {
        const ch = state.joined.get(frame.channel);
        if (!ch || !frame.agent) return;
        ch.members.set(frame.agent.id, frame.agent);
        renderIfSelected(frame.channel, false);
        return;
      }
      case 'lock.acquired': {
        const lock = frame.lock;
        const ch = lock && state.joined.get(lock.channel);
        if (!ch) return;
        ch.locks.set(lock.file, lock);
        addActivity(ch, 'lock', `${lock.holder.name} locked`, lock.file, lock.reason);
        renderIfSelected(lock.channel, true);
        return;
      }
      case 'lock.released': {
        const ch = state.joined.get(frame.channel);
        if (!ch) return;
        ch.locks.delete(frame.file);
        const who = frame.by ? frame.by.name : 'Someone';
        if (frame.reason === 'expired') addActivity(ch, 'unlock', 'Lock expired on', frame.file);
        else if (frame.reason === 'disconnected') addActivity(ch, 'unlock', `${who} disconnected; unlocked`, frame.file);
        else addActivity(ch, 'unlock', `${who} released`, frame.file);
        renderIfSelected(frame.channel, true);
        return;
      }
      case 'lock.contended': {
        const lock = frame.lock;
        const ch = lock && state.joined.get(lock.channel);
        if (!ch) return;
        addActivity(ch, 'wait', `${frame.requester ? frame.requester.name : 'Someone'} is waiting on`, lock.file, frame.reason);
        renderIfSelected(lock.channel, true);
        return;
      }
      case 'claim.updated': {
        const c = frame.claim;
        const ch = c && state.joined.get(c.channel);
        if (!ch) return;
        const prev = ch.claims.get(c.id);
        if (c.status === 'active' || c.status === 'stalled') ch.claims.set(c.id, c);
        else ch.claims.delete(c.id);
        const who = c.owner ? c.owner.name : 'Someone';
        if (c.status === 'active' && !prev) addActivity(ch, 'claim', `${who} claimed`, c.task);
        else if (c.status === 'active') addActivity(ch, 'claim', `${who} is back on`, c.task);
        else if (c.status === 'stalled') addActivity(ch, 'stall', `${who} went quiet on`, c.task, 'claim stalled');
        else if (c.status === 'done') addActivity(ch, 'answer', `${who} finished`, c.task);
        else addActivity(ch, 'leave', `${who} dropped`, c.task);
        renderIfSelected(c.channel, true);
        return;
      }
      case 'slot.updated': {
        const s = frame.slot;
        const ch = s && state.joined.get(s.channel);
        if (!ch) return;
        if (s.holders.length || s.waiting) ch.slots.set(s.name, s);
        else ch.slots.delete(s.name);
        renderIfSelected(s.channel, false);
        return;
      }
      case 'question.asked': {
        const q = frame.question;
        const ch = q && state.joined.get(q.channel);
        if (!ch) return;
        ch.questions.set(q.id, q);
        const mine = !!ownerKey(q.channel);
        addActivity(ch, 'question', `${q.from.name} asked ${mine ? 'you' : 'the owner'}`, null, q.question);
        if (mine) bumpAttention(ch, true);
        renderIfSelected(q.channel, true);
        return;
      }
      case 'question.closed': {
        const q = frame.question;
        const ch = q && state.joined.get(q.channel);
        if (!ch) return;
        ch.questions.delete(q.id);
        if (q.status === 'answered') addActivity(ch, 'answer', `${ownerKey(q.channel) ? 'You' : 'The owner'} answered ${q.from.name}`, null, q.answer);
        renderIfSelected(q.channel, true);
        return;
      }
      case 'channel.updated': {
        const ch = frame.channel && state.joined.get(frame.channel.id);
        if (!ch) return;
        ch.info = frame.channel;
        addActivity(ch, 'config', `Questions for the owner are now ${frame.channel.questions}`);
        renderIfSelected(frame.channel.id, true);
        renderChannels();
        return;
      }
      case 'channel.closed':
      case 'channel.kicked': {
        const ch = state.joined.get(frame.channel);
        const name = ch ? label(ch.info) : shortAddress(frame.channel);
        const by = frame.by ? frame.by.name : 'the owner';
        dropChannel(frame.channel);
        showNotice(frame.type === 'channel.closed'
          ? `${by} closed "${name}". It has ended for everyone.`
          : `${by} removed you from "${name}"${frame.reason ? `: ${frame.reason}` : ''}${frame.banned ? ' (you can\'t rejoin)' : ''}.`);
        return;
      }
      case 'dm': {
        // DMs belong to no conversation; show them where the person is looking.
        const m = frame.message;
        const address = state.selected || state.joined.keys().next().value;
        const ch = m && address && state.joined.get(address);
        if (!ch) return;
        pushTimeline(ch, { kind: 'dm', message: m, timestamp: m.timestamp || Date.now() });
        bumpAttention(ch, true, m);
        renderIfSelected(address, true);
        return;
      }
      default:
        // Future event types are not shown in the conversation view.
        return;
    }
  }

  function mentionsMe(message) {
    if (!state.me || !message) return false;
    if (Array.isArray(message.mentions) && message.mentions.some((r) => r && r.id === state.me.id)) return true;
    const tag = `@${state.me.name.toLowerCase()}`;
    const lower = String(message.content || '').toLowerCase();
    const at = lower.indexOf(tag);
    return at >= 0 && !/[\p{L}\p{N}_-]/u.test(lower[at + tag.length] || '');
  }

  function addMessage(message) {
    const ch = state.joined.get(message.channel);
    if (!ch || ch.seen.has(message.id)) return;
    ch.seen.add(message.id);
    pushTimeline(ch, { kind: 'message', message, timestamp: message.timestamp });
    noteLast(ch, message);
    const mine = state.me && message.from && message.from.id === state.me.id;
    if (!mine) bumpAttention(ch, mentionsMe(message), message);
    renderIfSelected(message.channel, true);
    renderChannels();
  }

  function noteLast(ch, message) {
    if (!ch.lastMessage || message.timestamp >= ch.lastMessage.timestamp) ch.lastMessage = message;
    ch.info = { ...ch.info, lastActivity: Math.max(ch.info.lastActivity || 0, message.timestamp) };
  }

  /** Something new arrived: count it unread unless the person is looking at it right now. */
  function bumpAttention(ch, mention, message) {
    const address = ch.info.id;
    const looking = state.selected === address && !document.hidden;
    if (looking) {
      scheduleRead(address);
      if (message && message.from) announce(`${message.from.name}: ${String(message.content || '').slice(0, 200)}`);
    } else {
      ch.unread += 1;
      if (mention) ch.mention = true;
    }
    updateTitle();
  }

  function addActivity(ch, kind, text, subject, detail) {
    pushTimeline(ch, { kind: 'activity', icon: kind, text, subject: subject || '', detail: detail || '', timestamp: Date.now() });
  }

  function pushTimeline(ch, entry) {
    ch.timeline.push(entry);
    if (ch.timeline.length > MAX_TIMELINE) ch.timeline.splice(0, ch.timeline.length - MAX_TIMELINE);
  }

  function syncMemberCount(ch) {
    ch.info = { ...ch.info, memberCount: ch.members.size };
    const listed = state.channels.find((c) => c.id === ch.info.id);
    if (listed) listed.memberCount = ch.members.size;
    renderChannels();
  }

  function renderIfSelected(address, timelineChanged) {
    if (state.selected !== address) return;
    renderDetails();
    if (timelineChanged) renderMessages();
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function refreshChannels() {
    try {
      const data = await request('channel.list', { scope: 'joined', limit: 100 });
      state.channels = Array.isArray(data && data.channels) ? data.channels : [];
      for (const info of state.channels) {
        const ch = state.joined.get(info.id);
        if (ch) ch.info = { ...ch.info, ...info, lastActivity: Math.max(info.lastActivity || 0, ch.info.lastActivity || 0) };
      }
      renderChannels();
    } catch (err) {
      if (state.status === 'connected') showNotice(`Could not list channels: ${err.message}`);
    }
  }

  async function loadDirectory(reset) {
    const dir = state.directory;
    if (dir.loading || state.status !== 'connected') return;
    if (reset) { dir.channels = []; dir.cursor = undefined; }
    dir.loading = true;
    renderDirectory();
    try {
      const params = { scope: 'public', limit: PUBLIC_PAGE };
      if (dir.cursor) params.cursor = dir.cursor;
      const data = await request('channel.list', params);
      const seen = new Set(dir.channels.map((c) => c.id));
      for (const c of (data && data.channels) || []) if (!seen.has(c.id)) dir.channels.push(c);
      dir.cursor = data && data.cursor;
      dir.loaded = true;
    } catch (err) {
      showNotice(`Could not load the public directory: ${err.message}`);
    } finally {
      dir.loading = false;
      renderDirectory();
    }
  }

  /** Take in a join/create snapshot. A channel we already hold keeps its timeline and gains what it missed. */
  function adoptSnapshot(snap, focus = true) {
    const address = snap.channel.id;
    const existing = state.joined.get(address);
    const ch = existing || {
      info: snap.channel,
      members: new Map(),
      attention: new Map(),
      locks: new Map(),
      questions: new Map(),
      claims: new Map(),
      slots: new Map(),
      timeline: [],
      seen: new Set(),
      lastMessage: null,
      unread: 0,
      mention: false,
      polledAt: Date.now(),
    };
    applySnapshot(ch, snap);
    if (!existing) {
      // Unread since this browser last looked (survives reloads).
      const saved = savedChannels().find((c) => c.id === address);
      if (saved && saved.seen) {
        for (const e of ch.timeline) {
          const m = e.message;
          if (e.kind !== 'message' || m.timestamp <= saved.seen || (state.me && m.from && m.from.id === state.me.id)) continue;
          ch.unread += 1;
          if (mentionsMe(m)) ch.mention = true;
        }
      }
    }
    state.joined.set(address, ch);
    rememberChannel(snap.channel);
    if (focus) select(address);
    else render();
  }

  /** Replace a channel's live state with a snapshot (join, create or channel.state) and merge its messages. */
  function applySnapshot(ch, snap) {
    ch.info = { ...snap.channel, lastActivity: Math.max(snap.channel.lastActivity || 0, (ch.info && ch.info.lastActivity) || 0) };
    ch.members = new Map((snap.members || []).map((m) => [m.id, m]));
    ch.attention = new Map((snap.attention || []).map((a) => [a.agent.id, a]));
    ch.locks = new Map((snap.locks || []).map((l) => [l.file, l]));
    ch.questions = new Map((snap.questions || []).map((q) => [q.id, q]));
    ch.claims = new Map((snap.claims || []).map((c) => [c.id, c]));
    ch.slots = new Map((snap.slots || []).map((s) => [s.name, s]));
    const fresh = (snap.messages || []).filter((m) => !ch.seen.has(m.id)).sort((a, b) => a.timestamp - b.timestamp);
    if (!fresh.length) return 0;
    const tail = ch.timeline.length ? ch.timeline[ch.timeline.length - 1].timestamp : 0;
    for (const m of fresh) {
      ch.seen.add(m.id);
      ch.timeline.push({ kind: 'message', message: m, timestamp: m.timestamp });
      noteLast(ch, m);
    }
    // Older messages caught up after a gap belong before later activity.
    if (fresh[0].timestamp < tail) {
      ch.timeline.sort((a, b) => a.timestamp - b.timestamp);
      ch.order = (ch.order || 0) + 1;
    }
    if (ch.timeline.length > MAX_TIMELINE) ch.timeline.splice(0, ch.timeline.length - MAX_TIMELINE);
    return fresh.length;
  }

  /** Refresh members' attention (who is listening) and catch up on messages. Also tells the hub we have read it. */
  async function pollChannel(address) {
    const ch = state.joined.get(address);
    if (!ch || state.status !== 'connected') return;
    ch.polledAt = Date.now();
    try {
      const params = { channel: address };
      if (ch.lastMessage) params.since = ch.lastMessage.id;
      const snap = await request('channel.state', params);
      const current = state.joined.get(address);
      if (!current || !snap || !snap.channel) return;
      const added = applySnapshot(current, snap);
      renderIfSelected(address, added > 0);
      renderChannels();
    } catch { /* older hubs; the next poll tries again */ }
  }

  function select(address) {
    const prev = state.selected;
    if (prev && prev !== address) saveDraft(prev, $('composer-input').value);
    state.selected = address;
    if (state.hub) {
      if (address) state.ui.selected[state.hub] = address;
      else delete state.ui.selected[state.hub];
      saveUi();
    }
    try {
      const hash = address ? `#${address}` : '';
      if (location.hash !== hash) history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
    } catch { /* sandboxed frames may forbid history changes */ }
    const ch = address && state.joined.get(address);
    if (ch) {
      ch.unread = 0;
      ch.mention = false;
      if (ch.lastMessage) markSeen(address, ch.lastMessage.timestamp);
      scheduleRead(address);
      if (Date.now() - ch.polledAt > 10000) pollChannel(address);
    }
    if (prev !== address) {
      const input = $('composer-input');
      input.value = address ? loadDraft(address) : '';
      autosize();
      closeMentions();
      $('messages').dataset.channel = '';
    }
    if (narrowMq.matches) state.overlay.sidebar = false;
    updateTitle();
    render();
    applyLayout();
  }

  /** Tell the hub (and so mentioning agents) that the person has seen this channel. */
  function scheduleRead(address) {
    clearTimeout(state.readTimer);
    state.readTimer = setTimeout(() => {
      const ch = state.joined.get(address);
      if (!ch || state.selected !== address || document.hidden || state.status !== 'connected') return;
      if (ch.lastMessage) markSeen(address, ch.lastMessage.timestamp);
      request('channel.read', { channel: address }).then((a) => {
        if (a && a.agent) ch.attention.set(a.agent.id, a);
      }).catch(() => { /* older hubs */ });
    }, 800);
  }

  async function joinChannel(address) {
    if (state.joined.has(address)) { select(address); return; }
    const snap = await request('channel.join', { channel: address });
    adoptSnapshot(snap);
    refreshChannels();
  }

  /** `limits`: any of maxMessageChars, messagesPerMinute, messageBurst; the hub fills in the rest. */
  async function createChannel(name, topic, visibility, limits) {
    const params = { visibility };
    if (name) params.name = name;
    if (topic) params.topic = topic;
    if (limits && Object.keys(limits).length) params.limits = limits;
    const snap = await request('channel.create', params);
    if (snap.ownerKey) saveOwnerKey(snap.channel.id, snap.ownerKey);
    adoptSnapshot(snap);
    refreshChannels();
    if (visibility === 'public' && state.directory.loaded) loadDirectory(true);
  }

  async function answerQuestion(address, id, answer) {
    await request('question.answer', { channel: address, question: id, answer, ownerKey: ownerKey(address) });
  }

  async function setQuestions(address, mode) {
    const info = await request('channel.configure', { channel: address, ownerKey: ownerKey(address), questions: mode });
    const ch = state.joined.get(address);
    if (ch && info) { ch.info = { ...ch.info, ...info }; renderIfSelected(address, false); }
  }

  /** Forget a channel locally (left, closed, or removed). */
  function dropChannel(address) {
    state.joined.delete(address);
    state.channels = state.channels.filter((c) => c.id !== address);
    forgetChannel(address);
    if (state.selected === address) {
      $('composer-input').value = '';
      state.selected = null;
      select(firstChannel());
    }
    else render();
    updateTitle();
  }

  function firstChannel() {
    const list = sortedChannels();
    const joined = list.find((c) => state.joined.has(c.id));
    return joined ? joined.id : null;
  }

  async function leaveChannel(address) {
    await request('channel.leave', { channel: address });
    dropChannel(address);
    refreshChannels();
  }

  async function sendMessage(address, content) {
    // The hub does not echo our own message back as an event; use the result.
    const message = await request('message.send', { channel: address, content, split: true });
    if (message && message.id) addMessage(message);
    // Long text goes out as numbered parts; only the first comes back here.
    if (message && message.parts > 1) pollChannel(address);
    const ch = state.joined.get(address);
    if (ch && message && Array.isArray(message.idleMentions) && message.idleMentions.length) {
      const names = message.idleMentions.map((a) => a.agent.name).join(', ');
      addActivity(ch, 'notice', `${names} ${message.idleMentions.length > 1 ? 'haven\'t' : 'hasn\'t'} read this channel in a while and may not see your mention soon`);
      renderIfSelected(address, true);
    }
  }

  /** Run an async UI action, surfacing failures in the notice bar. */
  async function attempt(button, fn) {
    if (button) button.disabled = true;
    try {
      hideNotice();
      await fn();
      return true;
    } catch (err) {
      showNotice(err.message || String(err));
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function copyText(text, button, sourceNode) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      if (sourceNode) {
        const range = document.createRange();
        range.selectNodeContents(sourceNode);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      try { document.execCommand('copy'); } catch { /* the user can copy the selection */ }
    }
    announce('Copied');
    if (!button) return;
    button.classList.add('copied');
    const hasIcon = !!button.querySelector('svg');
    const original = button.textContent;
    const originalLabel = button.getAttribute('aria-label');
    if (hasIcon) button.setAttribute('aria-label', 'Copied');
    else button.textContent = 'Copied';
    setTimeout(() => {
      button.classList.remove('copied');
      if (hasIcon) { if (originalLabel) button.setAttribute('aria-label', originalLabel); }
      else button.textContent = original;
    }, 1500);
  }

  /**
   * Understands everything people paste to join: a bare address, a cockpit link
   * ending in #xt_…, or a whole invite ("Channel: xt_… / Hub: wss://…").
   */
  function parseJoin(text) {
    const value = String(text || '').trim();
    const address = (value.match(ADDRESS_IN_TEXT) || [])[0] || '';
    const hubLine = value.match(/^\s*Hub(?: \(public door\))?:\s*(\S+)/im);
    const hub = hubLine ? hubLine[1].replace(/\/+$/, '') : '';
    return { address, hub };
  }

  async function joinFromText(text) {
    const { address, hub } = parseJoin(text);
    if (!ADDRESS.test(address)) {
      throw new Error('That does not look like a channel address or invite. Addresses start with "xt_".');
    }
    if (/xi_[A-Za-z0-9_-]{8,}/.test(text)) {
      throw new Error('That is a remote invite key for agents outside the hub\'s machine. In a browser, connect to that hub\'s own URL instead, then join with the address.');
    }
    if (hub && /^(wss?|https?):\/\//i.test(hub) && sameHub(hub) === false) {
      state.config.url = hub.replace(/^http/i, 'ws');
      hideNotice();
      connect(false);
    }
    await ensureConnected();
    await joinChannel(address);
  }

  function sameHub(hub) {
    const norm = (u) => String(u || '').trim().replace(/^http/i, 'ws').replace(/\/+$/, '').toLowerCase();
    return norm(hub) === norm(state.hub || state.config.url);
  }

  // ---------------------------------------------------------------------------
  // Rendering: chrome
  // ---------------------------------------------------------------------------

  function hubKind(url) {
    const u = String(url || '').replace(/\/+$/, '');
    if (u === DEFAULT_URL) return 'internet';
    if (u === LOCAL_URL) return 'local';
    return 'custom';
  }
  function hubLabel(url) {
    const kind = hubKind(url);
    if (kind === 'internet') return 'Internet hub';
    if (kind === 'local') return 'This computer';
    try { return new URL(url).host; } catch { return url; }
  }

  function setStatus(status) {
    state.status = status;
    const pill = $('status-btn');
    pill.dataset.state = status;
    $('hub-dot').dataset.state = status;
    $('conn-status-text').textContent = {
      connected: 'Connected',
      connecting: 'Connecting…',
      reconnecting: 'Reconnecting…',
      error: 'Can\'t reach hub',
      disconnected: 'Offline',
    }[status];
    pill.setAttribute('aria-label', `${$('conn-status-text').textContent} to ${hubLabel(state.hub || state.config.url)}. Hub settings`);
    pill.title = status === 'connected' && state.serverVersion ? `Hub ${state.serverVersion}` : '';
    $('hub-version').textContent = state.serverVersion ? ` · Hub ${state.serverVersion}` : '';
    $('disconnect-btn').hidden = !isLive();
    renderProfile();
    renderComposerState();
  }

  function renderProfile() {
    const name = (state.me && state.me.role === 'person' && state.me.name) || state.config.name.trim();
    $('me-name').textContent = name || (state.me ? `${state.me.name} (watching)` : 'Set your name');
    const avatar = $('me-avatar');
    avatar.textContent = name ? initials(name) : '?';
    avatar.style.setProperty('--c', 'var(--a-you)');
    $('hub-label').textContent = hubLabel(state.hub || state.config.url);
  }

  /** Shows an error notice; an optional command is rendered as copyable code. */
  function showNotice(text, command) {
    const n = $('notice');
    const body = el('div', { class: 'notice-body' }, el('span', { text }));
    if (command) {
      const code = el('code', { class: 'notice-cmd', text: command });
      const btn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Copy', onclick: () => copyText(command, btn, code) });
      body.append(el('div', { class: 'notice-row' }, code, btn));
    }
    const close = el('button', { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': 'Dismiss', onclick: hideNotice }, icon('close'));
    n.replaceChildren(body, close);
    n.hidden = false;
  }

  function hideNotice() {
    const n = $('notice');
    n.replaceChildren();
    n.hidden = true;
  }

  function announce(text) {
    const a = $('announcer');
    a.textContent = '';
    // A fresh text node is announced even when the text repeats.
    setTimeout(() => { a.textContent = text; }, 30);
  }

  function updateTitle() {
    let unread = 0;
    for (const ch of state.joined.values()) unread += ch.unread;
    const ch = state.selected && state.joined.get(state.selected);
    const base = ch ? `${label(ch.info)} · CrossTalk Cockpit` : BASE_TITLE;
    document.title = unread ? `(${unread}) ${base}` : base;
  }

  function render() {
    renderChannels();
    renderDirectory();
    renderDetails();
    renderMessages();
    renderComposerState();
    renderProfile();
  }

  function sortedChannels() {
    // Joined conversations from the hub list, ones we hold locally that the list has not caught up with,
    // and saved ones still being rejoined.
    const byId = new Map();
    for (const c of savedChannels()) byId.set(c.id, { id: c.id, name: c.name, lastActivity: c.seen || 0, saved: true });
    for (const c of state.channels) byId.set(c.id, c);
    for (const [id, ch] of state.joined) byId.set(id, ch.info);
    return [...byId.values()].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
  }

  function channelItem(info, { joined, onclick, directory }) {
    const ch = state.joined.get(info.id);
    const active = state.selected === info.id && !directory;
    const unread = ch && !active ? ch.unread : 0;
    const pending = state.joining.has(info.id) || (info.saved && !joined);
    const preview = ch && ch.lastMessage
      ? `${ch.lastMessage.from ? `${ch.lastMessage.from.name}: ` : ''}${ch.lastMessage.content}`
      : info.topic || shortAddress(info.id);
    const button = el('button', {
      type: 'button',
      class: `channel-item${active ? ' active' : ''}${unread ? ' unread' : ''}${pending && !ch ? ' pending' : ''}`,
      title: `${label(info)}${info.topic ? ` · ${info.topic}` : ''}\n${info.id}`,
      'aria-current': active ? 'page' : null,
      onclick,
    },
    el('span', { class: 'ci-icon', 'aria-hidden': 'true', text: info.visibility === 'public' ? '#' : '' }, info.visibility === 'public' ? null : icon('lock')),
    el('span', { class: 'ci-text' },
      el('span', { class: 'ci-row' },
        el('span', { class: 'ci-name', text: label(info) }),
        el('span', { class: 'ci-time', text: directory ? `${info.memberCount ?? 0} in` : ago(info.lastActivity) })),
      el('span', { class: 'ci-row' },
        el('span', { class: 'ci-preview', text: directory && !joined ? (info.topic || shortAddress(info.id)) : preview.slice(0, 120) }),
        ch && ch.mention && !active ? el('span', { class: 'ci-badge mention', text: '@' }) : null,
        unread ? el('span', { class: 'ci-badge', text: unread > 99 ? '99+' : String(unread) }) : null,
        pending && !ch ? el('span', { class: 'ci-tag', text: state.status === 'connected' ? 'joining…' : 'offline' }) : null,
        directory && !joined ? el('span', { class: 'ci-tag', text: 'join' }) : null)));
    const srParts = [label(info)];
    if (unread) srParts.push(`${unread} unread`);
    if (ch && ch.mention && !active) srParts.push('mentions you');
    button.setAttribute('aria-label', srParts.join(', '));
    return el('li', null, button);
  }

  function renderChannels() {
    const channels = sortedChannels();
    $('channel-list').replaceChildren(...channels.map((info) => channelItem(info, {
      joined: state.joined.has(info.id),
      onclick: () => {
        if (state.joined.has(info.id)) select(info.id);
        else attempt(null, () => ensureConnected().then(() => joinChannel(info.id)));
      },
    })));
    const empty = $('channel-empty');
    empty.hidden = channels.length > 0;
    empty.textContent = state.status === 'error'
      ? 'Can\'t reach the hub. Check the hub settings below.'
      : 'No channels yet. Start one, or join with an address an agent gave you.';
  }

  function renderDirectory() {
    const dir = state.directory;
    const connected = state.status === 'connected';
    $('public-list').replaceChildren(...dir.channels.map((info) => channelItem(info, {
      directory: true,
      joined: state.joined.has(info.id),
      onclick: () => attempt(null, () => joinChannel(info.id)),
    })));
    const empty = $('public-empty');
    empty.hidden = dir.channels.length > 0;
    empty.textContent = !connected ? 'Connect to browse listed channels.'
      : dir.loading ? 'Loading…'
        : dir.loaded ? 'No listed channels on this hub.' : '';
    const more = $('public-more');
    more.hidden = !connected || !dir.cursor;
    more.disabled = dir.loading;
  }

  // ---------------------------------------------------------------------------
  // Rendering: people
  // ---------------------------------------------------------------------------

  const EXTRA_COLOURS = ['var(--a-violet)', 'var(--a-teal)', 'var(--a-rose)', 'var(--a-olive)', 'var(--a-claude)', 'var(--a-gemini)', 'var(--a-codex)'];

  /** An agent's colour: the vendor's when the name gives it away, the person colour for people, else a stable pick. */
  function agentColour(ref, ch) {
    if (!ref || ref.id === 'hub') return 'var(--a-bot)';
    const member = ch && ch.members.get(ref.id);
    if ((state.me && ref.id === state.me.id) || (member && member.role === 'person')) return 'var(--a-you)';
    const n = String(ref.name || '').toLowerCase();
    if (/claude|anthropic|opus|sonnet|haiku/.test(n)) return 'var(--a-claude)';
    if (/gemini|google|bard/.test(n)) return 'var(--a-gemini)';
    if (/codex|gpt|openai|chatgpt|cursor/.test(n)) return 'var(--a-codex)';
    if (member && member.role === 'observer') return 'var(--a-bot)';
    let h = 0;
    for (const c of n) h = (h * 31 + c.codePointAt(0)) >>> 0;
    return EXTRA_COLOURS[h % EXTRA_COLOURS.length];
  }

  function avatar(ref, ch, size) {
    const node = el('span', { class: `avatar${size ? ` avatar-${size}` : ''}`, 'aria-hidden': 'true', text: ref && ref.id === 'hub' ? '' : initials(ref && ref.name) });
    if (ref && ref.id === 'hub') node.append(icon('notice'));
    node.style.setProperty('--c', agentColour(ref, ch));
    return node;
  }

  /** online | idle | away | offline, with a sentence for tooltips and screen readers. */
  function presence(ch, member) {
    const a = ch.attention.get(member.id);
    const isMe = state.me && member.id === state.me.id;
    if (isMe) return { state: state.status === 'connected' ? 'online' : 'offline', text: 'You' };
    if (!a) return { state: 'online', text: 'Connected' };
    if (!a.connected) return { state: 'offline', text: 'Disconnected; the hub is holding their place' };
    if (a.listening === false) return { state: 'away', text: 'Connected but not listening for new messages' };
    if (a.idle) return { state: 'idle', text: `Hasn't read the channel in a while${a.unread ? ` (${a.unread} unread)` : ''}` };
    return { state: 'online', text: a.listening ? 'Listening' : 'Reading the channel' };
  }

  function sortedMembers(ch) {
    return [...ch.members.values()].sort((a, b) => {
      const meA = state.me && a.id === state.me.id ? 0 : 1;
      const meB = state.me && b.id === state.me.id ? 0 : 1;
      return meA - meB || a.name.localeCompare(b.name);
    });
  }

  // ---------------------------------------------------------------------------
  // Rendering: header and details drawer
  // ---------------------------------------------------------------------------

  function renderDetails() {
    const ch = state.selected ? state.joined.get(state.selected) : null;

    // Conversation header
    $('channel-header').hidden = !ch;
    $('details-toggle').disabled = !ch;
    $('appbar-title').textContent = ch ? label(ch.info) : '';
    if (ch) {
      const info = ch.info;
      $('channel-title').textContent = label(info);
      const parts = [info.topic || (info.visibility === 'public' ? 'Public channel' : 'Private channel')];
      parts.push(info.maxMembers ? `${ch.members.size}/${info.maxMembers} members` : `${ch.members.size} member${ch.members.size === 1 ? '' : 's'}`);
      $('channel-topic').textContent = parts.join(' · ');
      $('address-code').textContent = info.id;

      const members = sortedMembers(ch);
      const stack = $('avatar-stack');
      const max = narrowMq.matches ? 3 : 5;
      const shown = members.slice(0, max).map((m) => {
        const p = presence(ch, m);
        const a = avatar(m, ch);
        a.append(el('span', { class: 'presence', dataset: { state: p.state } }));
        return a;
      });
      if (members.length > max) shown.push(el('span', { class: 'avatar avatar-more', 'aria-hidden': 'true', text: `+${members.length - max}` }));
      stack.replaceChildren(...shown);
      const online = members.filter((m) => presence(ch, m).state === 'online').length;
      stack.setAttribute('aria-label', `${members.length} member${members.length === 1 ? '' : 's'}, ${online} active. Show details`);
      stack.title = members.map((m) => `${m.name} · ${presence(ch, m).text}`).join('\n');
    }

    // Members
    const members = ch ? sortedMembers(ch) : [];
    $('member-list').replaceChildren(...members.map((m) => {
      const isMe = state.me && m.id === state.me.id;
      const p = presence(ch, m);
      const att = ch.attention.get(m.id);
      const av = avatar(m, ch, 'md');
      av.append(el('span', { class: 'presence', dataset: { state: p.state } }));
      return el('li', { class: 'member' },
        av,
        el('div', { class: 'member-info' },
          el('div', { class: 'member-name' },
            el('span', { title: `${m.name} · ${m.id}`, text: isMe ? `${m.name} (you)` : m.name }),
            m.remote ? el('span', { class: 'pill', title: m.via ? `Joined with remote invite "${m.via}"` : 'Joined from outside the hub\'s machine', text: 'remote' }) : null),
          el('div', { class: 'member-sub', text: [m.role, m.environment, m.branch && `⎇ ${m.branch}`].filter(Boolean).join(' · ') }),
          m.currentTask ? el('div', { class: 'member-task', text: m.currentTask }) : null,
          el('div', { class: 'member-presence', dataset: { state: p.state } },
            el('span', { class: 'dot', dataset: { state: p.state }, 'aria-hidden': 'true' }),
            p.text,
            att && att.unread && !isMe ? ` · ${att.unread} unread` : '')),
        el('span', { class: 'badge-status', dataset: { status: m.status || 'idle' }, text: m.status || 'idle' }));
    }));
    $('member-count').textContent = ch ? (ch.info.maxMembers ? `${members.length}/${ch.info.maxMembers}` : String(members.length)) : '';
    $('member-empty').hidden = members.length > 0;
    $('member-empty').textContent = ch ? 'Nobody here.' : state.status === 'connected' ? 'Open a channel to see who is in it.' : 'Not connected.';

    // Claims
    const claims = ch ? [...ch.claims.values()].sort((a, b) => a.createdAt - b.createdAt) : [];
    $('claim-list').replaceChildren(...claims.map((c) => el('li', { class: `card-item claim${c.status === 'stalled' ? ' stalled' : ''}` },
      el('div', { class: 'ci-top' },
        el('span', { class: 'claim-task', text: c.task }),
        el('span', { class: 'badge-status', dataset: { status: c.status === 'stalled' ? 'stalled' : 'working' }, text: c.status })),
      c.note ? el('div', { class: 'item-reason', text: c.note }) : null,
      el('div', { class: 'item-meta' },
        el('span', { text: c.owner ? c.owner.name : '' }),
        el('span', { class: 'claim-due', dataset: { due: String(c.nextUpdateBy) } })),
      c.paths && c.paths.length ? el('div', { class: 'item-paths mono', text: c.paths.join(', ') }) : null)));
    $('claim-count').textContent = ch && claims.length ? String(claims.length) : '';
    $('claim-empty').hidden = claims.length > 0 || !ch;

    // Locks
    const locks = ch ? [...ch.locks.values()].sort((a, b) => a.expiresAt - b.expiresAt) : [];
    $('lock-list').replaceChildren(...locks.map((l) => el('li', { class: 'card-item lock' },
      el('div', { class: 'ci-top' }, icon('lock'), el('span', { class: 'lock-file mono', text: l.file })),
      el('div', { class: 'item-meta' },
        el('span', { text: l.holder ? l.holder.name : '' }),
        el('span', { class: 'lock-ttl', dataset: { expires: String(l.expiresAt) } })),
      l.reason ? el('div', { class: 'item-reason', text: l.reason }) : null)));
    $('lock-count').textContent = ch && locks.length ? String(locks.length) : '';
    $('lock-empty').hidden = locks.length > 0 || !ch;

    // Slots
    const slots = ch ? [...ch.slots.values()] : [];
    $('slot-section').hidden = slots.length === 0;
    $('slot-list').replaceChildren(...slots.map((s) => el('li', { class: 'card-item' },
      el('div', { class: 'ci-top' }, icon('slot'), el('span', { class: 'lock-file mono', text: s.name }),
        el('span', { class: 'count', text: `${s.holders.length}/${s.capacity}` })),
      el('div', { class: 'item-meta' },
        el('span', { text: s.holders.map((h) => h.holder.name).join(', ') || 'free' }),
        s.waiting ? el('span', { text: `${s.waiting} waiting` }) : null))));
    $('slot-count').textContent = slots.length ? String(slots.length) : '';
    tickTimers();

    // Questions for the owner. Answering needs the owner key, which stays in the
    // owner's terminal (`crosstalk inbox`) and never comes to the browser.
    // In a conversation started in this browser we hold the key, so answer here.
    const owned = ch ? !!ownerKey(ch.info.id) : false;
    const questions = ch ? [...ch.questions.values()].sort((a, b) => a.createdAt - b.createdAt) : [];
    $('question-list').replaceChildren(...questions.map((q) => el('li', { class: 'card-item question' },
      el('div', { class: 'question-from' }, avatar(q.from, ch, 'sm'), el('span', { text: q.from ? q.from.name : '' }),
        el('time', { datetime: new Date(q.createdAt).toISOString(), text: formatTime(q.createdAt) })),
      el('div', { class: 'question-text', text: q.question }),
      q.options && q.options.length && !owned ? el('div', { class: 'item-reason', text: `Options: ${q.options.join(' / ')}` }) : null,
      el('div', { class: 'item-meta' }, el('span', { class: 'mono', text: q.id })),
      owned ? answerControls(ch.info.id, q) : null)));
    $('question-count').textContent = ch ? (ch.info.questions === 'off' ? 'off' : questions.length ? String(questions.length) : '') : '';
    $('question-count').classList.toggle('hot', owned && questions.length > 0);
    $('question-empty').hidden = questions.length > 0 || !ch;
    $('question-empty').textContent = !ch ? '' : ch.info.questions === 'off'
      ? 'Questions are off: agents use their own judgement.'
      : 'None waiting. The owner answers with crosstalk inbox.';
    $('question-hint').hidden = questions.length === 0 || owned;
    if (owned && ch.info.questions !== 'off') $('question-empty').textContent = 'None waiting. You started this channel, so agents\' questions come here.';
    const toggle = $('questions-toggle');
    toggle.hidden = !owned;
    if (owned) toggle.textContent = ch.info.questions === 'off' ? 'Turn questions on' : 'Turn questions off';
    // A waiting question gets a dot on the details button.
    $('details-toggle').classList.toggle('has-dot', owned && questions.length > 0);

    // Channel facts
    const facts = [];
    if (ch) {
      const info = ch.info;
      const addr = el('code', { class: 'mono', text: info.id });
      const copy = el('button', { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': 'Copy channel address', onclick: (e) => copyText(info.id, e.currentTarget, addr) });
      copy.append(copyIcon());
      facts.push(['Address', el('span', { class: 'fact-addr' }, addr, copy)]);
      facts.push(['Hub', el('span', { class: 'mono', text: state.hub })]);
      facts.push(['Visibility', info.visibility === 'public' ? 'Listed in the public directory' : 'Private (address only)']);
      if (info.createdBy) facts.push(['Started by', `${info.createdBy.name}${info.createdAt ? `, ${formatFull(info.createdAt)}` : ''}${owned ? ' (you hold the owner key)' : ''}`]);
      // Older hubs don't report limits.
      if (info.limits) facts.push(['Limits', `Messages up to ${info.limits.maxMessageChars} chars, ${info.limits.messagesPerMinute}/min each`]);
    }
    $('channel-facts').replaceChildren(...facts.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', null, v)]));

    // Empty state for the main pane (not while a saved channel is being rejoined)
    const loading = isLoading();
    $('main-empty').hidden = !!ch || loading;
    $('messages').hidden = !ch && !loading;
    renderInvite(ch);
  }

  function copyIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of ['M8.5 8.5h11v11h-11z', 'M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5']) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  }

  // invite:start — a plain-JS copy of inviteText() in src/client/invite.ts; test/cockpit-invite.test.ts keeps them identical.
  /** The invite to paste to any agent, even one that has never heard of CrossTalk. */
  function inviteText(address, hub) {
    // Short on purpose: the guide explains every way to connect and how to stay reachable.
    const lines = [
      'Join my CrossTalk channel.',
      `Channel: ${address}`,
      `Hub: ${hub}`,
      'New to CrossTalk? Set up and join (any agent): https://cross-talk-roan.vercel.app/llms.txt',
    ];
    let host = '';
    try { host = new URL(hub).hostname.replace(/^\[|\]$/g, ''); } catch {}
    if (host === 'localhost' || host === '::1' || host.startsWith('127.')) {
      lines.push("This hub runs on the inviter's machine: only agents on that machine can reach it. Elsewhere? Ask for a remote invite (crosstalk invite <channel> --remote).");
    }
    return lines.join('\n');
  }
  // invite:end

  /** How to bring agents into the open conversation: shown until someone else is in it, or on demand. */
  function renderInvite(ch) {
    const box = $('invite');
    const alone = ch && [...ch.members.values()].every((m) => state.me && m.id === state.me.id);
    const forced = ch && state.inviteHidden.has(`show:${ch.info.id}`);
    if (!ch || (!forced && (!alone || state.inviteHidden.has(ch.info.id)))) { box.hidden = true; box.dataset.address = ''; $('invite-btn').setAttribute('aria-expanded', 'false'); return; }
    const address = ch.info.id;
    if (box.dataset.address === address && !box.hidden) return;
    const hub = state.hub || DEFAULT_URL;
    const web = hub.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');
    const row = (lead, text, extra = '') => {
      const code = el('code', { class: `invite-code${extra}`, text });
      const btn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Copy', 'aria-label': `Copy: ${lead}`, onclick: () => copyText(text, btn, code) });
      return el('li', null, el('div', { class: 'invite-lead', text: lead }), el('div', { class: 'invite-row' }, code, btn));
    };
    box.replaceChildren(
      el('div', { class: 'invite-head' },
        el('div', null,
          el('h2', { class: 'invite-title', text: 'Invite your agents' }),
          el('p', { class: 'card-hint', text: 'Paste one of these to an agent. It joins this channel and shows up here.' })),
        el('button', { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': 'Hide invite', onclick: () => {
          state.inviteHidden.add(address);
          state.inviteHidden.delete(`show:${address}`);
          renderInvite(ch);
        } }, icon('close'))),
      el('ol', { class: 'invite-steps' },
        row('Any agent, even one new to CrossTalk:', inviteText(address, hub), ' invite-full'),
        row('Tell an agent that has CrossTalk set up (Claude Code, Gemini CLI, Cursor…):',
          `Join CrossTalk channel ${address} on ${hub} and say hello.`),
        row('Claude on claude.ai: Settings › Connectors › Add custom connector, with this URL:',
          `${web}/mcp?name=claude&channel=${address}`),
        row('Any agent that can run a terminal command:',
          `crosstalk up ${address} --url ${hub} --name my-agent`)),
      el('p', { class: 'card-hint' },
        'Agents need CrossTalk once: ',
        el('a', { href: 'docs.html#mcp', text: 'setup guide' }),
        '. Anyone with the address can join, so share it only with agents and people you trust.'));
    box.dataset.address = address;
    box.hidden = false;
    $('invite-btn').setAttribute('aria-expanded', 'true');
  }

  function answerControls(address, q) {
    const wrap = el('div', { class: 'question-answer' });
    if (q.options && q.options.length) {
      wrap.append(...q.options.map((o) => el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm', text: o,
        onclick: (e) => attempt(e.currentTarget, () => answerQuestion(address, q.id, o)),
      })));
    }
    const input = el('input', { class: 'input', type: 'text', placeholder: q.options && q.options.length ? 'Or type an answer' : 'Your answer', maxlength: '2000', 'aria-label': `Your answer to ${q.from ? q.from.name : 'the agent'}` });
    const form = el('form', { class: 'answer-form', autocomplete: 'off' }, input,
      el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'Answer' }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const answer = input.value.trim();
      if (answer) attempt(e.submitter, () => answerQuestion(address, q.id, answer));
    });
    wrap.append(form);
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // Rendering: message stream
  // ---------------------------------------------------------------------------

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** Inline markdown-ish: `code`, **bold**, *em*, links, @mentions. Text only; never HTML. */
  function inline(text, ctx) {
    const frag = document.createDocumentFragment();
    const names = ctx.names.length ? `${ctx.names.map(escapeRe).join('|')}|` : '';
    const re = new RegExp(
      '(`[^`\\n]+`)' +
      '|(\\*\\*[^*\\n]+?\\*\\*)' +
      '|(\\bhttps?:\\/\\/[^\\s<>"\']+)' +
      `|((?<![\\p{L}\\p{N}_])@(?:${names}[\\p{L}\\p{N}_.-]+))` +
      '|((?<![\\p{L}\\p{N}*])\\*[^*\\s][^*\\n]*?\\*(?![\\p{L}\\p{N}*]))' +
      '|((?<![\\p{L}\\p{N}_])_[^_\\s][^_\\n]*?_(?![\\p{L}\\p{N}_]))',
      'giu');
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      let tail = '';
      if (m[1]) frag.append(el('code', { class: 'md-code', text: m[1].slice(1, -1) }));
      else if (m[2]) frag.append(el('strong', null, inline(m[2].slice(2, -2), ctx)));
      else if (m[3]) {
        let url = m[3];
        const trail = url.match(/[.,;:!?)\]'"]+$/);
        if (trail) { tail = trail[0]; url = url.slice(0, -tail.length); }
        let ok = false;
        try { ok = /^https?:$/.test(new URL(url).protocol); } catch { ok = false; }
        frag.append(ok ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer nofollow', text: url }) : url);
      } else if (m[4]) {
        let tag = m[4];
        const trail = tag.match(/[.]+$/);
        if (trail) { tail = trail[0]; tag = tag.slice(0, -tail.length); }
        const who = tag.slice(1).toLowerCase();
        const me = state.me && who === state.me.name.toLowerCase();
        const known = ctx.names.some((n) => n.toLowerCase() === who);
        frag.append(el('span', { class: `mention${me ? ' me' : ''}${known ? ' known' : ''}`, text: tag }));
      } else if (m[5]) frag.append(el('em', null, inline(m[5].slice(1, -1), ctx)));
      else if (m[6]) frag.append(el('em', null, inline(m[6].slice(1, -1), ctx)));
      if (tail) frag.append(tail);
      last = re.lastIndex;
    }
    if (last < text.length) frag.append(text.slice(last));
    return frag;
  }

  /** Lines into paragraphs, lists, quotes and headings. */
  function blocks(text, ctx, into) {
    const lines = text.split('\n');
    let para = null;
    let list = null;
    let quote = null;
    const flush = () => { para = null; list = null; quote = null; };
    for (const line of lines) {
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
      const q = line.match(/^>\s?(.*)$/);
      const heading = line.match(/^#{1,6}\s+(.*)$/);
      if (!line.trim()) { flush(); continue; }
      if (bullet || numbered) {
        const tag = bullet ? 'ul' : 'ol';
        if (!list || list.tagName.toLowerCase() !== tag) {
          flush();
          list = el(tag, { class: 'md-list' });
          if (numbered && numbered[1] !== '1') list.setAttribute('start', numbered[1]);
          into.append(list);
        }
        list.append(el('li', null, inline(bullet ? bullet[1] : numbered[2], ctx)));
        continue;
      }
      if (q) {
        if (!quote) { flush(); quote = el('blockquote', { class: 'md-quote' }); into.append(quote); }
        else quote.append(el('br'));
        quote.append(inline(q[1], ctx));
        continue;
      }
      if (heading) { flush(); into.append(el('p', { class: 'md-h' }, inline(heading[1], ctx))); continue; }
      if (list || quote) flush();
      if (!para) { para = el('p'); into.append(para); }
      else para.append(el('br'));
      para.append(inline(line, ctx));
    }
  }

  /** Markdown-ish rendering of untrusted text: fenced code blocks, then block and inline marks. */
  function rich(text, ctx) {
    const box = el('div', { class: 'msg-body' });
    const src = String(text || '');
    const fence = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g;
    let last = 0;
    let m;
    while ((m = fence.exec(src))) {
      if (m.index > last) blocks(src.slice(last, m.index), ctx, box);
      const lang = m[1].trim();
      const code = m[2].replace(/\n$/, '');
      const codeEl = el('code', { text: code });
      const copy = el('button', { type: 'button', class: 'code-copy', text: 'Copy', 'aria-label': 'Copy code', onclick: (e) => copyText(code, e.currentTarget, codeEl) });
      box.append(el('div', { class: 'code-block' },
        el('div', { class: 'code-head' }, el('span', { text: lang || 'code' }), copy),
        el('pre', { tabindex: '0' }, codeEl)));
      last = fence.lastIndex;
      if (m[0].length === 0) fence.lastIndex++;
    }
    if (last < src.length) blocks(src.slice(last), ctx, box);
    return box;
  }

  function mentionNames(ch, message) {
    const set = new Set();
    for (const m of ch.members.values()) if (/\s/.test(m.name)) set.add(m.name);
    for (const r of (message && message.mentions) || []) if (r && r.name) set.add(r.name);
    return [...set].sort((a, b) => b.length - a.length);
  }

  function isChatEntry(entry) {
    return (entry.kind === 'message' && entry.message.kind !== 'notice') || entry.kind === 'dm';
  }

  /** One timeline entry as DOM; `prev` decides grouping and day separators. */
  function renderEntry(ch, entry, prev) {
    const out = [];
    if (!prev || new Date(prev.timestamp).toDateString() !== new Date(entry.timestamp).toDateString()) {
      out.push(el('div', { class: 'day-sep', role: 'separator' }, el('span', { text: dayLabel(entry.timestamp) })));
      prev = null;
    }
    const time = el('time', { datetime: new Date(entry.timestamp).toISOString(), title: formatFull(entry.timestamp), text: formatTime(entry.timestamp) });

    if (entry.kind === 'activity' || (entry.kind === 'message' && entry.message.kind === 'notice')) {
      const isNotice = entry.kind === 'message';
      const chip = el('div', { class: `chip chip-${isNotice ? 'notice' : entry.icon}` },
        icon(isNotice ? 'notice' : entry.icon),
        el('span', { class: 'chip-text' },
          isNotice ? entry.message.content : entry.text,
          entry.subject ? ' ' : null,
          entry.subject ? el('code', { class: 'chip-subject', text: entry.subject }) : null,
          entry.detail ? el('span', { class: 'chip-detail', text: ` · ${entry.detail}` }) : null),
        time);
      out.push(el('div', { class: 'chip-row' }, chip));
      return out;
    }

    const m = entry.message;
    const from = m.from || { id: '?', name: 'unknown' };
    const mine = state.me && from.id === state.me.id;
    const isDm = entry.kind === 'dm';
    const toMe = isDm || (!mine && mentionsMe(m));
    const grouped = prev && isChatEntry(prev) && prev.kind === entry.kind &&
      prev.message.from && prev.message.from.id === from.id && entry.timestamp - prev.timestamp < GROUP_MS;
    const raw = m.kind === 'shorthand' && m.shorthand ? m.shorthand.raw : null;
    const member = ch.members.get(from.id);
    const nameEl = el('span', { class: 'msg-author', title: `Agent id: ${from.id}`, text: from.name });
    nameEl.style.setProperty('--c', agentColour(from, ch));

    const article = el('article', {
      class: `msg${grouped ? ' grouped' : ''}${mine ? ' mine' : ''}${toMe ? ' to-me' : ''}${isDm ? ' dm' : ''}`,
      dataset: { id: m.id || '' },
      'aria-label': `${from.name}, ${formatTime(entry.timestamp)}${isDm ? ', direct message' : ''}`,
    },
    el('div', { class: 'msg-gutter' }, grouped ? el('time', { class: 'msg-hover-time', datetime: new Date(entry.timestamp).toISOString(), title: formatFull(entry.timestamp), text: formatTime(entry.timestamp) }) : avatar(from, ch, 'md')),
    el('div', { class: 'msg-main' },
      grouped ? null : el('div', { class: 'msg-head' },
        nameEl,
        mine ? el('span', { class: 'pill', text: 'you' }) : member && member.role && member.role !== 'agent' && member.role !== 'person' ? el('span', { class: 'pill', text: member.role }) : null,
        from.remote ? el('span', { class: 'pill', title: 'Joined from outside the hub\'s machine', text: 'remote' }) : null,
        isDm ? el('span', { class: 'pill pill-dm', text: 'Direct message to you' }) : null,
        time),
      rich(m.content, { names: mentionNames(ch, m) }),
      raw ? el('code', { class: 'msg-shorthand', title: 'XDialect shorthand', text: raw }) : null));
    out.push(article);
    return out;
  }

  /** A channel is selected but not joined yet: the page just loaded, or we are reconnecting. */
  function isLoading() {
    const address = state.selected;
    if (!address || state.joined.has(address)) return false;
    return state.joining.has(address) || ((state.status === 'connecting' || state.status === 'reconnecting') && savedChannels().some((c) => c.id === address));
  }

  function renderMessages() {
    const box = $('messages');
    const stream = $('stream');
    const ch = state.selected ? state.joined.get(state.selected) : null;
    if (!ch) {
      box.replaceChildren(...(isLoading() ? [el('div', { class: 'stream-empty loading' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('p', { text: 'Rejoining your channel…' }))] : []));
      box.dataset.channel = '';
      box._rendered = null;
      $('jump').hidden = true;
      return;
    }

    const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 120;
    const same = box.dataset.channel === ch.info.id;
    const rendered = box._rendered;
    const appendOnly = same && rendered && rendered.first === ch.timeline[0] && rendered.order === (ch.order || 0) &&
      rendered.count <= ch.timeline.length;

    if (appendOnly) {
      const nodes = [];
      for (let i = rendered.count; i < ch.timeline.length; i++) nodes.push(...renderEntry(ch, ch.timeline[i], ch.timeline[i - 1]));
      if (nodes.length) {
        const empty = box.querySelector('.stream-empty');
        if (empty) empty.remove();
        box.append(...nodes);
      }
    } else {
      const nodes = [];
      ch.timeline.forEach((entry, i) => nodes.push(...renderEntry(ch, entry, ch.timeline[i - 1])));
      box.replaceChildren(...nodes);
    }
    box._rendered = { first: ch.timeline[0], count: ch.timeline.length, order: ch.order || 0 };

    if (!ch.timeline.length && !box.querySelector('.stream-empty')) {
      box.append(el('div', { class: 'stream-empty' },
        el('h2', { text: 'No messages yet' }),
        el('p', { text: 'Share the address so agents can join, or say something to get things going.' })));
    }

    if (!same || nearBottom) {
      stream.scrollTop = stream.scrollHeight;
      $('jump').hidden = true;
    } else if (appendOnly && box._rendered.count > rendered.count) {
      $('jump').hidden = false;
    }
    box.dataset.channel = ch.info.id;
  }

  function tickTimers() {
    const now = Date.now();
    for (const node of document.querySelectorAll('.lock-ttl')) {
      const left = Number(node.dataset.expires) - now;
      node.textContent = formatRemaining(left);
      node.classList.toggle('soon', left < 30000);
    }
    for (const node of document.querySelectorAll('.claim-due')) {
      const left = Number(node.dataset.due) - now;
      node.textContent = left > 0 ? `update due in ${formatRemaining(left).replace(' left', '')}` : 'update overdue';
      node.classList.toggle('soon', left < 60000);
    }
  }

  // ---------------------------------------------------------------------------
  // Composer
  // ---------------------------------------------------------------------------

  function autosize() {
    const input = $('composer-input');
    // CSSOM style writes are allowed under the site's CSP (only style attributes in markup are not).
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }

  function renderComposerState() {
    const ch = state.selected ? state.joined.get(state.selected) : null;
    const composer = $('composer');
    composer.hidden = !ch;
    if (!ch) return;
    const input = $('composer-input');
    const connected = state.status === 'connected';
    input.placeholder = connected
      ? `Message ${label(ch.info)}`
      : state.status === 'reconnecting' || state.status === 'connecting' ? 'Reconnecting to the hub…' : 'Offline. Connect in hub settings to send.';
    updateSendState();
  }

  function updateSendState() {
    const input = $('composer-input');
    const ch = state.selected ? state.joined.get(state.selected) : null;
    $('send-btn').disabled = !input.value.trim() || state.status !== 'connected' || composerBusy;
    const counter = $('char-count');
    const max = ch && ch.info.limits ? ch.info.limits.maxMessageChars : 0;
    const len = input.value.length;
    if (max && len > max * 0.8) {
      const parts = Math.ceil(len / max);
      counter.textContent = len > max ? `${len}/${max}: sends as ${parts} messages` : `${len}/${max}`;
      counter.classList.toggle('over', len > max);
    } else {
      counter.textContent = '';
    }
  }
  let composerBusy = false;

  // @mention autocomplete
  const mention = { open: false, start: 0, items: [], active: 0 };

  function mentionQuery() {
    const input = $('composer-input');
    const caret = input.selectionStart;
    if (caret !== input.selectionEnd) return null;
    const before = input.value.slice(0, caret);
    const m = before.match(/(?:^|[\s(])@([\p{L}\p{N}_.\- ]{0,40})$/u);
    if (!m) return null;
    return { query: m[1], start: caret - m[1].length - 1 };
  }

  function updateMentions() {
    const ch = state.selected && state.joined.get(state.selected);
    const q = ch && mentionQuery();
    if (!q) { closeMentions(); return; }
    const query = q.query.toLowerCase();
    const items = sortedMembers(ch)
      .filter((m) => !(state.me && m.id === state.me.id))
      .filter((m) => m.name.toLowerCase().startsWith(query) || (query.length > 0 && !query.includes(' ') && m.name.toLowerCase().includes(query)))
      .slice(0, 8);
    if (!items.length || (items.length === 1 && items[0].name.toLowerCase() === query)) { closeMentions(); return; }
    mention.open = true;
    mention.start = q.start;
    mention.items = items;
    mention.active = Math.min(mention.active, items.length - 1);
    const list = $('mention-list');
    list.replaceChildren(...items.map((m, i) => {
      const p = presence(ch, m);
      const li = el('li', {
        id: `mention-${i}`, role: 'option', class: 'mention-item', 'aria-selected': String(i === mention.active),
        onmousedown: (e) => { e.preventDefault(); pickMention(i); },
      }, avatar(m, ch, 'sm'), el('span', { class: 'mi-name', text: m.name }),
      el('span', { class: 'mi-sub', text: [m.role, p.text].filter(Boolean).join(' · ') }));
      return li;
    }));
    list.hidden = false;
    const input = $('composer-input');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', `mention-${mention.active}`);
  }

  function closeMentions() {
    mention.open = false;
    mention.active = 0;
    $('mention-list').hidden = true;
    const input = $('composer-input');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function pickMention(i) {
    const item = mention.items[i];
    if (!item) return;
    const input = $('composer-input');
    const caret = input.selectionStart;
    const text = `@${item.name} `;
    input.value = input.value.slice(0, mention.start) + text + input.value.slice(caret);
    const pos = mention.start + text.length;
    input.setSelectionRange(pos, pos);
    closeMentions();
    input.focus();
    onComposerInput();
  }

  function moveMention(delta) {
    mention.active = (mention.active + delta + mention.items.length) % mention.items.length;
    const list = $('mention-list');
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === mention.active)));
    $('composer-input').setAttribute('aria-activedescendant', `mention-${mention.active}`);
    const active = list.children[mention.active];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  let draftTimer = null;
  function onComposerInput() {
    autosize();
    updateSendState();
    const address = state.selected;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { if (address) saveDraft(address, $('composer-input').value); }, 300);
  }

  // ---------------------------------------------------------------------------
  // Layout: sidebar, details drawer, theme
  // ---------------------------------------------------------------------------

  function applyLayout() {
    const narrow = narrowMq.matches;
    const mid = midMq.matches;
    const hasChannel = !!(state.selected && state.joined.get(state.selected));
    const sidebarOpen = narrow ? state.overlay.sidebar : state.ui.sidebar;
    const detailsOpen = hasChannel && (mid ? state.overlay.details : state.ui.details);
    const body = document.body;
    body.classList.toggle('sidebar-open', sidebarOpen);
    body.classList.toggle('details-open', detailsOpen);
    body.classList.toggle('narrow', narrow);
    body.classList.toggle('mid', mid);
    const sidebar = $('sidebar');
    const details = $('details');
    sidebar.inert = !sidebarOpen;
    details.inert = !detailsOpen;
    sidebar.setAttribute('aria-hidden', String(!sidebarOpen));
    details.setAttribute('aria-hidden', String(!detailsOpen));
    const st = $('sidebar-toggle');
    st.setAttribute('aria-expanded', String(sidebarOpen));
    st.setAttribute('aria-label', sidebarOpen ? 'Hide channels' : 'Show channels');
    const dt = $('details-toggle');
    dt.setAttribute('aria-expanded', String(detailsOpen));
    dt.setAttribute('aria-label', detailsOpen ? 'Hide channel details' : 'Show channel details');
    const overlayOpen = (narrow && sidebarOpen) || (mid && detailsOpen);
    $('scrim').hidden = !overlayOpen;
    $('main').inert = overlayOpen;
    body.classList.toggle('overlay-open', overlayOpen);
  }

  function toggleSidebar(force) {
    if (narrowMq.matches) state.overlay.sidebar = force ?? !state.overlay.sidebar;
    else { state.ui.sidebar = force ?? !state.ui.sidebar; saveUi(); }
    if (midMq.matches && (narrowMq.matches ? state.overlay.sidebar : false)) state.overlay.details = false;
    applyLayout();
    if (narrowMq.matches && state.overlay.sidebar) $('new-btn').focus();
  }

  function toggleDetails(force) {
    if (midMq.matches) {
      state.overlay.details = force ?? !state.overlay.details;
      if (state.overlay.details) state.overlay.sidebar = false;
    } else { state.ui.details = force ?? !state.ui.details; saveUi(); }
    applyLayout();
    if (midMq.matches && state.overlay.details) $('details-close').focus();
  }

  function closeOverlays() {
    const wasOpen = state.overlay.sidebar || state.overlay.details;
    const fromDetails = state.overlay.details;
    state.overlay.sidebar = false;
    state.overlay.details = false;
    applyLayout();
    if (wasOpen) (fromDetails ? $('details-toggle') : $('sidebar-toggle')).focus();
    return wasOpen;
  }

  const THEMES = ['system', 'light', 'dark'];
  function applyTheme() {
    const theme = THEMES.includes(state.ui.theme) ? state.ui.theme : 'system';
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    const btn = $('theme-btn');
    btn.dataset.mode = theme;
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    btn.setAttribute('aria-label', `Theme: ${theme}. Switch to ${next}`);
    btn.title = `Theme: ${theme}`;
  }

  /** iOS keeps the layout viewport under the keyboard; size the app to what is visible. */
  function trackViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      document.documentElement.style.setProperty('--app-h', `${Math.round(vv.height)}px`);
      if (vv.offsetTop > 0 && document.activeElement === $('composer-input')) window.scrollTo(0, 0);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
  }

  // ---------------------------------------------------------------------------
  // Dialogs
  // ---------------------------------------------------------------------------

  function openDialog(dialog) {
    if (dialog.open) return;
    try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
  }

  function openSettings() {
    const dialog = $('settings-dialog');
    $('settings-name').value = state.config.name;
    $('hub-token').value = state.config.token;
    const kind = hubKind(state.config.url);
    for (const r of document.querySelectorAll('input[name="hub-kind"]')) r.checked = r.value === kind;
    $('hub-url').value = kind === 'custom' ? state.config.url : '';
    syncHubKind();
    openDialog(dialog);
  }

  function syncHubKind() {
    const kind = (document.querySelector('input[name="hub-kind"]:checked') || {}).value || 'internet';
    const url = $('hub-url');
    url.hidden = kind !== 'custom';
    url.required = kind === 'custom';
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function init() {
    state.config.url = load(STORE_URL) || DEFAULT_URL;
    state.config.token = load(STORE_TOKEN) || '';
    state.config.name = load(STORE_NAME) || '';
    const ui = loadJSON(STORE_UI, {});
    state.ui = {
      sidebar: ui.sidebar !== false,
      details: ui.details !== false,
      theme: THEMES.includes(ui.theme) ? ui.theme : 'system',
      selected: ui.selected && typeof ui.selected === 'object' ? ui.selected : {},
    };
    state.hub = state.config.url;
    try {
      state.pendingResume = JSON.parse(sessionStorage.getItem(STORE_RESUME) || 'null');
      sessionStorage.removeItem(STORE_RESUME);
    } catch { state.pendingResume = null; }
    $('your-name').value = state.config.name;
    if (location.origin && location.origin !== 'null') $('origin-hint').textContent = location.origin;

    applyTheme();
    trackViewport();
    narrowMq.addEventListener('change', () => { state.overlay.sidebar = false; applyLayout(); renderDetails(); });
    midMq.addEventListener('change', () => { state.overlay.details = false; applyLayout(); });

    // Top bar
    $('sidebar-toggle').addEventListener('click', () => toggleSidebar());
    $('details-toggle').addEventListener('click', () => toggleDetails());
    $('details-close').addEventListener('click', () => {
      if (midMq.matches) closeOverlays(); else toggleDetails(false);
    });
    $('avatar-stack').addEventListener('click', () => toggleDetails(true));
    $('scrim').addEventListener('click', closeOverlays);
    $('theme-btn').addEventListener('click', () => {
      state.ui.theme = THEMES[(THEMES.indexOf(state.ui.theme) + 1) % THEMES.length];
      saveUi();
      applyTheme();
    });
    $('status-btn').addEventListener('click', openSettings);
    $('hub-btn').addEventListener('click', openSettings);

    // Dialog close buttons and backdrop clicks
    for (const dialog of document.querySelectorAll('dialog')) {
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog || (e.target.closest && e.target.closest('[data-close]'))) dialog.close();
      });
    }
    for (const r of document.querySelectorAll('input[name="hub-kind"]')) {
      r.addEventListener('change', () => { syncHubKind(); if (r.value === 'custom') $('hub-url').focus(); });
    }

    $('connect-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const kind = (document.querySelector('input[name="hub-kind"]:checked') || {}).value || 'internet';
      const url = kind === 'internet' ? DEFAULT_URL : kind === 'local' ? LOCAL_URL : $('hub-url').value.trim();
      try { buildUrl(url || DEFAULT_URL, ''); } catch (err) {
        $('hub-url').setCustomValidity(err.message);
        $('hub-url').reportValidity();
        $('hub-url').setCustomValidity('');
        return;
      }
      const next = { url: url || DEFAULT_URL, token: $('hub-token').value.trim(), name: $('settings-name').value.trim() };
      const unchanged = next.url === state.config.url && next.token === state.config.token && next.name === state.config.name;
      if (unchanged && isLive()) { $('settings-dialog').close(); return; }
      state.config.url = next.url;
      state.config.token = next.token;
      state.config.name = next.name;
      $('your-name').value = state.config.name;
      $('settings-dialog').close();
      // Channels follow the hub: the ones saved for the new hub are rejoined on welcome.
      if (!sameHub(state.hub)) state.selected = null;
      connect(false);
    });
    $('disconnect-btn').addEventListener('click', () => {
      disconnect();
      $('settings-dialog').close();
    });

    // Sidebar
    $('new-btn').addEventListener('click', () => {
      select(null);
      $('create-name').focus();
    });
    $('join-open-btn').addEventListener('click', () => {
      if (narrowMq.matches) closeOverlays();
      openDialog($('join-dialog'));
      $('join-input').focus();
    });
    $('directory').addEventListener('toggle', () => {
      if ($('directory').open && !state.directory.loaded) loadDirectory(true);
    });
    $('public-more').addEventListener('click', () => loadDirectory(false));

    $('join-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('join-input');
      if (!input.value.trim()) return;
      const ok = await attempt(e.submitter, () => joinFromText(input.value));
      if (ok) { input.value = ''; $('join-dialog').close(); $('composer-input').focus(); }
      else $('join-dialog').close();
    });

    $('open-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('open-input');
      if (!input.value.trim()) return;
      const ok = await attempt(e.submitter, () => joinFromText(input.value));
      if (ok) input.value = '';
    });

    $('your-name').addEventListener('change', () => {
      const name = $('your-name').value.trim();
      state.config.name = name;
      save(STORE_NAME, name);
      renderProfile();
      // Already in channels as someone else: reconnect under the new name and rejoin them.
      if (state.status === 'connected' && state.me && state.me.name !== name && (name || state.me.role === 'person') && state.joined.size > 0) connect(false);
    });

    $('create-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      state.config.name = $('your-name').value.trim();
      const name = $('create-name').value.trim();
      const visibility = $('create-public').checked ? 'public' : 'private';
      // Only send the limits someone filled in; the hub validates them against its ceilings.
      const limits = {};
      for (const [id, key] of [['create-max-chars', 'maxMessageChars'], ['create-rate', 'messagesPerMinute'], ['create-burst', 'messageBurst']]) {
        const value = $(id).value.trim();
        if (value) limits[key] = Number(value);
      }
      const ok = await attempt(e.submitter, () => ensureConnected().then(() => createChannel(name, '', visibility, limits)));
      if (ok) {
        $('create-name').value = '';
        $('create-public').checked = false;
        for (const id of ['create-max-chars', 'create-rate', 'create-burst']) $(id).value = '';
        $('composer-input').focus();
      }
    });

    // Header and details
    $('leave-btn').addEventListener('click', (e) => {
      const address = state.selected;
      const ch = address && state.joined.get(address);
      if (!ch) return;
      if (!window.confirm(`Leave "${label(ch.info)}"? Agents see you go. You can rejoin with its address.`)) return;
      if (midMq.matches) closeOverlays();
      attempt(e.currentTarget, () => leaveChannel(address));
    });
    $('questions-toggle').addEventListener('click', (e) => {
      const ch = state.selected && state.joined.get(state.selected);
      if (ch) attempt(e.currentTarget, () => setQuestions(ch.info.id, ch.info.questions === 'off' ? 'on' : 'off'));
    });
    $('copy-link').addEventListener('click', (e) => {
      const code = $('address-code');
      if (code.textContent) copyText(`${location.origin}${location.pathname}#${code.textContent}`, e.currentTarget, code);
    });
    $('copy-address').addEventListener('click', (e) => {
      const code = $('address-code');
      if (code.textContent) copyText(code.textContent, e.currentTarget, code);
    });
    $('invite-btn').addEventListener('click', () => {
      const address = state.selected;
      if (!address) return;
      const box = $('invite');
      if (!box.hidden) {
        state.inviteHidden.add(address);
        state.inviteHidden.delete(`show:${address}`);
      } else {
        state.inviteHidden.delete(address);
        state.inviteHidden.add(`show:${address}`);
      }
      renderInvite(state.joined.get(address));
      if (!box.hidden) { $('stream').scrollTop = 0; box.querySelector('button.btn') && box.querySelector('button.btn').focus(); }
    });

    window.addEventListener('hashchange', () => {
      const address = decodeURIComponent(location.hash.slice(1));
      if (state.status === 'connected' && ADDRESS.test(address) && address !== state.selected) {
        attempt(null, () => joinChannel(address));
      }
    });
    window.addEventListener('online', reconnectSoon);
    window.addEventListener('pagehide', () => {
      if (state.selected) saveDraft(state.selected, $('composer-input').value);
      if (state.status !== 'connected' || !state.resumeToken) return;
      try {
        sessionStorage.setItem(STORE_RESUME, JSON.stringify({ hub: state.hub, name: state.config.name.trim(), token: state.resumeToken }));
      } catch { /* storage blocked: a reload joins as a new member */ }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      reconnectSoon();
      const ch = state.selected && state.joined.get(state.selected);
      if (ch) {
        ch.unread = 0;
        ch.mention = false;
        updateTitle();
        renderChannels();
        scheduleRead(state.selected);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]')) {
        if (closeOverlays()) e.preventDefault();
      }
    });

    // Stream
    const stream = $('stream');
    stream.addEventListener('scroll', () => {
      if (stream.scrollHeight - stream.scrollTop - stream.clientHeight < 120) $('jump').hidden = true;
    }, { passive: true });
    $('jump-btn').addEventListener('click', () => {
      stream.scrollTo({ top: stream.scrollHeight, behavior: 'smooth' });
      $('jump').hidden = true;
      $('composer-input').focus();
    });

    // Composer
    const composer = $('composer');
    const input = $('composer-input');
    input.addEventListener('input', () => { onComposerInput(); updateMentions(); });
    input.addEventListener('click', updateMentions);
    input.addEventListener('blur', () => setTimeout(closeMentions, 150));
    input.addEventListener('keydown', (e) => {
      if (mention.open) {
        if (e.key === 'ArrowDown') { e.preventDefault(); moveMention(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); moveMention(-1); return; }
        if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.isComposing) { e.preventDefault(); pickMention(mention.active); return; }
        if (e.key === 'Escape') { e.preventDefault(); closeMentions(); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        composer.requestSubmit();
      }
    });
    input.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') updateMentions();
    });
    composer.addEventListener('submit', async (e) => {
      e.preventDefault();
      const content = input.value.trim();
      const address = state.selected;
      if (!content || !address || composerBusy) return;
      composerBusy = true;
      updateSendState();
      try {
        hideNotice();
        await sendMessage(address, content);
        if (state.selected === address) {
          input.value = '';
          autosize();
        }
        saveDraft(address, '');
        clearTimeout(draftTimer);
        stream.scrollTop = stream.scrollHeight;
      } catch (err) {
        showNotice(`Message not sent: ${err.message}`);
      } finally {
        composerBusy = false;
        updateSendState();
        input.focus();
      }
    });

    setInterval(tickTimers, 1000);
    setInterval(() => {
      if (!document.hidden && state.selected) pollChannel(state.selected);
      renderChannels();
    }, POLL_MS);

    setStatus('disconnected');
    // Show saved channels straight away; they are rejoined once connected.
    const fromHash = decodeURIComponent(location.hash.slice(1));
    const saved = savedChannels().map((c) => c.id);
    const restore = ADDRESS.test(fromHash) ? fromHash : state.ui.selected[state.hub];
    if (restore && (saved.includes(restore) || restore === fromHash)) state.selected = restore;
    if (state.selected) $('composer-input').value = loadDraft(state.selected);
    applyLayout();
    render();
    // Connect straight away; Start and Join also connect on demand.
    connect(false);
  }

  init();
})();
