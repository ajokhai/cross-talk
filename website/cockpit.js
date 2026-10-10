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
 * All user content is rendered with textContent; nothing is ever assigned to
 * innerHTML. No inline scripts or style attributes (the site sends a strict CSP).
 */
(function () {
  'use strict';

  const PROTOCOL_VERSION = 2;
  // The public hub works from any browser. A hub on your own machine is
  // ws://localhost:4488 (offered in the address box's suggestions).
  const DEFAULT_URL = 'wss://hub-production-a114.up.railway.app';
  const REQUEST_TIMEOUT_MS = 15000;
  const HELLO_TIMEOUT_MS = 10000;
  const MAX_TIMELINE = 500;
  const PUBLIC_PAGE = 50;
  const ADDRESS = /^xt_[A-Za-z0-9_-]{16,}$/;
  const STORE_URL = 'crosstalk.cockpit.url';
  const STORE_TOKEN = 'crosstalk.cockpit.token';

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

  function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString()} ${time}`;
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
  const label = (info) => (info && info.name) || 'Untitled conversation';
  const shortAddress = (id) => (id && id.length > 10 ? `${id.slice(0, 7)}…${id.slice(-4)}` : id || '');
  const lockGlyph = (info) => (info.visibility === 'public' ? '#' : '🔒');

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const state = {
    ws: null,
    /** 'disconnected' | 'connecting' | 'connected' | 'error' */
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
     * address -> { info, members: Map<id, AgentInfo>, locks: Map<file, FileLock>,
     *              timeline: Array<{kind:'message', message} | {kind:'activity', text, timestamp}>,
     *              seen: Set<messageId> }
     */
    joined: new Map(),
    /** Selected conversation address. */
    selected: null,
  };

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

  function connect() {
    const rawUrl = $('hub-url').value.trim() || DEFAULT_URL;
    const token = $('hub-token').value.trim();

    let url;
    try { url = buildUrl(rawUrl, token); } catch (err) { showNotice(err.message); return; }

    save(STORE_URL, rawUrl);
    save(STORE_TOKEN, token);
    disconnect();
    hideNotice();
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
        agent: { name: `cockpit-${suffix}`, role: 'observer', environment: 'web', currentTask: 'Watching conversations' },
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
      resetSession();
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
    if (token) return [`${lead} Check that the token is right.`];
    if (!origin) return [`${lead} Enter the hub's token above.`];
    return [`${lead} Enter the hub's token above, or allow this page's origin when starting the hub:`,
      `crosstalk serve --allow-origin ${origin}`];
  }

  function disconnect() {
    const ws = state.ws;
    state.ws = null;
    resetSession();
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, 'cockpit disconnect');
    setStatus('disconnected');
    render();
  }

  function resetSession() {
    state.ws = state.ws && state.ws.readyState <= WebSocket.OPEN ? state.ws : null;
    for (const p of state.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Disconnected'));
    }
    state.pending.clear();
    state.me = null;
    state.channels = [];
    state.directory = { loaded: false, channels: [], cursor: undefined, loading: false };
    state.joined.clear();
    state.selected = null;
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
    setStatus('connected');
    hideNotice();
    render();
    refreshChannels();
    if ($('directory').open) loadDirectory(true);

    // Deep link: cockpit.html#xt_… joins that conversation.
    const fromHash = decodeURIComponent(location.hash.slice(1));
    if (ADDRESS.test(fromHash)) attempt(null, () => joinChannel(fromHash));
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
        if (!known) addActivity(ch, `${frame.agent.name} joined`);
        syncMemberCount(ch);
        renderIfSelected(frame.channel, true);
        return;
      }
      case 'member.left': {
        const ch = state.joined.get(frame.channel);
        if (!ch || !frame.agent) return;
        ch.members.delete(frame.agent.id);
        addActivity(ch, `${frame.agent.name} ${frame.reason === 'disconnected' ? 'disconnected' : 'left'}`);
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
        addActivity(ch, `${lock.holder.name} locked ${lock.file}${lock.reason ? ` (${lock.reason})` : ''}`);
        renderIfSelected(lock.channel, true);
        return;
      }
      case 'lock.released': {
        const ch = state.joined.get(frame.channel);
        if (!ch) return;
        ch.locks.delete(frame.file);
        const who = frame.by ? frame.by.name : 'Someone';
        addActivity(ch, frame.reason === 'expired'
          ? `Lock on ${frame.file} expired`
          : frame.reason === 'disconnected'
            ? `${who} disconnected; ${frame.file} unlocked`
            : `${who} released ${frame.file}`);
        renderIfSelected(frame.channel, true);
        return;
      }
      case 'lock.contended': {
        const lock = frame.lock;
        const ch = lock && state.joined.get(lock.channel);
        if (!ch) return;
        addActivity(ch, `${frame.requester ? frame.requester.name : 'Someone'} is waiting on ${lock.file}${frame.reason ? `: ${frame.reason}` : ''}`);
        renderIfSelected(lock.channel, true);
        return;
      }
      default:
        // 'dm' and future event types are not shown in the conversation view.
        return;
    }
  }

  function addMessage(message) {
    const ch = state.joined.get(message.channel);
    if (!ch || ch.seen.has(message.id)) return;
    ch.seen.add(message.id);
    pushTimeline(ch, { kind: 'message', message, timestamp: message.timestamp });
    renderIfSelected(message.channel, true);
  }

  function addActivity(ch, text) {
    pushTimeline(ch, { kind: 'activity', text, timestamp: Date.now() });
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
      renderChannels();
    } catch (err) {
      showNotice(`Could not list conversations: ${err.message}`);
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

  function adoptSnapshot(snap) {
    const address = snap.channel.id;
    const ch = {
      info: snap.channel,
      members: new Map((snap.members || []).map((m) => [m.id, m])),
      locks: new Map((snap.locks || []).map((l) => [l.file, l])),
      timeline: [],
      seen: new Set(),
    };
    const messages = (snap.messages || []).slice().sort((a, b) => a.timestamp - b.timestamp);
    for (const m of messages) {
      if (ch.seen.has(m.id)) continue;
      ch.seen.add(m.id);
      ch.timeline.push({ kind: 'message', message: m, timestamp: m.timestamp });
    }
    state.joined.set(address, ch);
    select(address);
  }

  function select(address) {
    state.selected = address;
    try {
      const hash = address ? `#${address}` : '';
      if (location.hash !== hash) history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
    } catch { /* sandboxed frames may forbid history changes */ }
    render();
  }

  async function joinChannel(address) {
    if (state.joined.has(address)) { select(address); return; }
    const snap = await request('channel.join', { channel: address });
    adoptSnapshot(snap);
    refreshChannels();
  }

  async function createChannel(name, topic, visibility) {
    const params = { visibility };
    if (name) params.name = name;
    if (topic) params.topic = topic;
    const snap = await request('channel.create', params);
    adoptSnapshot(snap);
    refreshChannels();
    if (visibility === 'public' && state.directory.loaded) loadDirectory(true);
  }

  async function leaveChannel(address) {
    await request('channel.leave', { channel: address });
    state.joined.delete(address);
    if (state.selected === address) select(state.joined.keys().next().value || null);
    else render();
    refreshChannels();
  }

  async function sendMessage(address, content) {
    // The hub does not echo our own message back as an event; use the result.
    const message = await request('message.send', { channel: address, content });
    if (message && message.id) addMessage(message);
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
      if (button) button.disabled = state.status !== 'connected';
    }
  }

  async function copyText(text, button, sourceNode) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(sourceNode);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try { document.execCommand('copy'); } catch { /* the user can copy the selection */ }
    }
    const original = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = original; }, 1500);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function setStatus(status) {
    state.status = status;
    const pill = $('conn-status');
    pill.dataset.state = status;
    $('conn-status-text').textContent = {
      connected: state.me ? `Connected as ${state.me.name}` : 'Connected',
      connecting: 'Connecting…',
      error: 'Connection failed',
      disconnected: 'Disconnected',
    }[status];
    pill.title = status === 'connected' && state.serverVersion ? `Hub ${state.serverVersion}` : '';

    const live = status === 'connected' || status === 'connecting';
    $('connect-btn').textContent = live ? 'Disconnect' : 'Connect';
    $('hub-url').disabled = live;
    $('hub-token').disabled = live;

    const ready = status === 'connected';
    $('refresh-channels').disabled = !ready;
    for (const b of document.querySelectorAll('#join-form button, #create-form button')) b.disabled = !ready;
  }

  /** Shows an error notice; an optional command is rendered as copyable code. */
  function showNotice(text, command) {
    const n = $('notice');
    n.replaceChildren(el('span', { text }));
    if (command) {
      const code = el('code', { class: 'notice-cmd', text: command });
      const btn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Copy', onclick: () => copyText(command, btn, code) });
      n.append(el('div', { class: 'notice-row' }, code, btn));
    }
    n.hidden = false;
  }

  function hideNotice() {
    const n = $('notice');
    n.replaceChildren();
    n.hidden = true;
  }

  function render() {
    renderChannels();
    renderDirectory();
    renderDetails();
    renderMessages();
  }

  function channelButton(info, { joined, onclick }) {
    return el('li', null, el('button', {
      type: 'button',
      class: `channel-item${state.selected === info.id ? ' active' : ''}`,
      title: `${label(info)}${info.topic ? ` · ${info.topic}` : ''}\n${info.id}`,
      onclick,
    },
    el('span', { class: 'hash', text: lockGlyph(info) }),
    el('span', { class: 'label-wrap' },
      el('span', { class: 'name', text: label(info) }),
      el('span', { class: 'addr', text: shortAddress(info.id) })),
    joined ? null : el('span', { class: 'tag', text: 'join' }),
    el('span', { class: 'meta', text: info.maxMembers ? `${info.memberCount}/${info.maxMembers}` : String(info.memberCount ?? '') })));
  }

  function renderChannels() {
    const connected = state.status === 'connected';
    // Joined conversations from the hub list plus any we hold locally that the list has not caught up with.
    const byId = new Map(state.channels.map((c) => [c.id, c]));
    for (const [id, ch] of state.joined) if (!byId.has(id)) byId.set(id, ch.info);
    const channels = [...byId.values()].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));

    $('channel-list').replaceChildren(...channels.map((info) => channelButton(info, {
      joined: state.joined.has(info.id),
      onclick: () => {
        if (state.joined.has(info.id)) select(info.id);
        else attempt(null, () => joinChannel(info.id));
      },
    })));

    const empty = $('channel-empty');
    empty.hidden = channels.length > 0;
    empty.textContent = connected
      ? 'You are not in any conversation yet. Start one below, or paste an address to join one.'
      : 'Connect to a hub to see your conversations.';
  }

  function renderDirectory() {
    const dir = state.directory;
    const connected = state.status === 'connected';
    $('public-list').replaceChildren(...dir.channels.map((info) => channelButton(info, {
      joined: state.joined.has(info.id),
      onclick: () => attempt(null, () => joinChannel(info.id)),
    })));
    const empty = $('public-empty');
    empty.hidden = dir.channels.length > 0;
    empty.textContent = !connected ? 'Connect to browse listed conversations.'
      : dir.loading ? 'Loading…'
        : dir.loaded ? 'No listed conversations on this hub.' : '';
    const more = $('public-more');
    more.hidden = !connected || !dir.cursor;
    more.disabled = dir.loading;
  }

  function renderDetails() {
    const ch = state.selected ? state.joined.get(state.selected) : null;

    // Conversation header
    $('channel-header').hidden = !ch;
    $('composer').hidden = !ch;
    if (ch) {
      const info = ch.info;
      $('channel-title').textContent = `${lockGlyph(info)} ${label(info)}`;
      const parts = [info.topic || (info.visibility === 'public' ? 'Listed in the public directory' : 'Private: only people with the address can join')];
      if (info.maxMembers) parts.push(`${ch.members.size}/${info.maxMembers} members`);
      $('channel-topic').textContent = parts.join(' · ');
      $('address-box').hidden = false;
      $('address-code').textContent = info.id;
    }

    // Members
    const members = ch ? [...ch.members.values()].sort((a, b) => a.name.localeCompare(b.name)) : [];
    $('member-list').replaceChildren(...members.map((m) => {
      const isMe = state.me && m.id === state.me.id;
      return el('li', { class: 'member' },
        el('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(m.name) }),
        el('div', { class: 'member-info' },
          el('div', { class: 'member-name', title: `${m.name} · ${m.id}`, text: isMe ? `${m.name} (you)` : m.name }),
          el('div', { class: 'member-sub', text: [m.role, m.environment, m.branch && `⎇ ${m.branch}`].filter(Boolean).join(' · ') }),
          m.currentTask ? el('div', { class: 'member-task', text: m.currentTask }) : null),
        el('span', { class: 'badge-status', dataset: { status: m.status || 'idle' }, text: m.status || 'idle' }));
    }));
    $('member-count').textContent = ch ? (ch.info.maxMembers ? `${members.length}/${ch.info.maxMembers}` : String(members.length)) : '';
    $('member-empty').hidden = members.length > 0;
    $('member-empty').textContent = ch ? 'Nobody here.' : state.status === 'connected' ? 'Open a conversation to see who is in it.' : 'Not connected.';

    // Locks
    const locks = ch ? [...ch.locks.values()].sort((a, b) => a.expiresAt - b.expiresAt) : [];
    $('lock-list').replaceChildren(...locks.map((l) => el('li', { class: 'lock' },
      el('div', { class: 'lock-file', text: l.file }),
      el('div', { class: 'lock-meta' },
        el('span', { text: l.holder ? l.holder.name : '' }),
        el('span', { class: 'lock-ttl', dataset: { expires: String(l.expiresAt) } })),
      l.reason ? el('div', { class: 'lock-reason', text: l.reason }) : null)));
    $('lock-count').textContent = ch ? String(locks.length) : '';
    $('lock-empty').hidden = locks.length > 0;
    tickLocks();

    // Empty state for the main pane
    const empty = $('main-empty');
    empty.hidden = !!ch;
    if (!ch) {
      const connected = state.status === 'connected';
      $('main-empty-title').textContent = connected ? 'No conversation open' : 'Not connected';
      $('main-empty-text').textContent = connected
        ? 'Every conversation has its own address. Start a new one and share its address with the agents you want in it, or paste an address to join.'
        : 'Enter a hub URL above and connect. Then open a conversation to follow the agents in it.';
    }
  }

  function renderMessages() {
    const box = $('messages');
    const ch = state.selected ? state.joined.get(state.selected) : null;
    if (!ch) { box.replaceChildren(); return; }

    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;

    const nodes = ch.timeline.map((entry) => {
      if (entry.kind === 'activity') {
        return el('div', { class: 'msg-system' },
          entry.text, ' · ', el('time', { datetime: new Date(entry.timestamp).toISOString(), text: formatTime(entry.timestamp) }));
      }
      const m = entry.message;
      const mine = state.me && m.from && m.from.id === state.me.id;
      const raw = m.kind === 'shorthand' && m.shorthand ? m.shorthand.raw : null;
      return el('article', { class: `msg${mine ? ' mine' : ''}` },
        el('div', { class: 'msg-head' },
          el('span', { class: 'msg-author', title: m.from ? `Agent id: ${m.from.id}` : null, text: m.from ? m.from.name : 'unknown' }),
          el('time', { class: 'msg-time', datetime: new Date(m.timestamp).toISOString(), text: formatTime(m.timestamp) })),
        el('div', { class: 'msg-body', text: m.content }),
        raw ? el('code', { class: 'msg-shorthand', title: 'XDialect shorthand', text: raw }) : null);
    });

    if (!nodes.length) {
      nodes.push(el('div', { class: 'msg-system', text: 'No messages yet. Share the address above so agents can join, or say something.' }));
    }
    box.replaceChildren(...nodes);
    if (nearBottom || box.dataset.channel !== ch.info.id) box.scrollTop = box.scrollHeight;
    box.dataset.channel = ch.info.id;
  }

  function tickLocks() {
    const now = Date.now();
    for (const node of document.querySelectorAll('.lock-ttl')) {
      const left = Number(node.dataset.expires) - now;
      node.textContent = formatRemaining(left);
      node.classList.toggle('soon', left < 30000);
    }
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function init() {
    $('hub-url').value = load(STORE_URL) || DEFAULT_URL;
    $('hub-token').value = load(STORE_TOKEN) || '';

    $('connect-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (state.status === 'connected' || state.status === 'connecting') disconnect();
      else connect();
    });

    $('refresh-channels').addEventListener('click', () => {
      refreshChannels();
      if ($('directory').open) loadDirectory(true);
    });

    $('directory').addEventListener('toggle', () => {
      if ($('directory').open && !state.directory.loaded) loadDirectory(true);
    });
    $('public-more').addEventListener('click', () => loadDirectory(false));

    const joinInput = $('join-input');
    $('join-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      // Accept a bare address or a pasted cockpit link ending in #xt_…
      const value = joinInput.value.trim().replace(/^.*#/, '');
      if (!value) return;
      if (!ADDRESS.test(value)) {
        showNotice('That does not look like a conversation address. Addresses start with "xt_".');
        return;
      }
      const ok = await attempt(e.submitter, () => joinChannel(value));
      if (ok) joinInput.value = '';
    });

    $('create-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('create-name').value.trim();
      const topic = $('create-topic').value.trim();
      const visibility = document.querySelector('input[name="create-visibility"]:checked').value;
      const ok = await attempt(e.submitter, () => createChannel(name, topic, visibility));
      if (ok) { $('create-name').value = ''; $('create-topic').value = ''; }
    });

    $('leave-btn').addEventListener('click', (e) => {
      if (state.selected) attempt(e.currentTarget, () => leaveChannel(state.selected));
    });

    $('copy-address').addEventListener('click', (e) => {
      const code = $('address-code');
      if (code.textContent) copyText(code.textContent, e.currentTarget, code);
    });

    window.addEventListener('hashchange', () => {
      const address = decodeURIComponent(location.hash.slice(1));
      if (state.status === 'connected' && ADDRESS.test(address) && address !== state.selected) {
        attempt(null, () => joinChannel(address));
      }
    });

    const composer = $('composer');
    const input = $('composer-input');
    // CSSOM style writes are allowed under the site's CSP (only style attributes in markup are not).
    const autosize = () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; };
    input.addEventListener('input', autosize);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        composer.requestSubmit();
      }
    });
    composer.addEventListener('submit', async (e) => {
      e.preventDefault();
      const content = input.value.trim();
      const address = state.selected;
      if (!content || !address) return;
      const btn = composer.querySelector('button');
      btn.disabled = true;
      try {
        hideNotice();
        await sendMessage(address, content);
        input.value = '';
        autosize();
      } catch (err) {
        showNotice(`Message not sent: ${err.message}`);
      } finally {
        btn.disabled = false;
        input.focus();
      }
    });

    setInterval(tickLocks, 1000);
    setStatus('disconnected');
    render();
  }

  init();
})();
