// CrossTalk Planetary Swarm Mission Control & Multi-Session Mesh Cockpit
(function() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  let ws = null;
  let currentSession = 'default'; // 'default', '*', or specific channel ID
  let activeView = 'matrix'; // 'matrix', 'topology', 'sentinel'
  let activeTier = 'all'; // 'all', 'reasoning', 'coder', 'edge'
  let activeFilter = 'all'; // 'all', 'current', 'locks', 'gibberlink_signal', 'dm'
  
  // Mesh state
  let agents = [];
  let locks = [];
  let messages = [];
  let knownSessions = new Set(['default', 'compiler-swarm-core', 'reasoning-frontier-mesh', 'embedded-cortex-iot', 'fintech-audit-sentry']);
  let swarmClusters = [];
  let planetaryMetrics = {
    globalAgentsActive: 1429880,
    activeSessionShards: 8412,
    globalPacketsPerSec: 685400,
    tokenSavingsPct: 94.8,
    p99LatencyMs: 0.28
  };

  // Swarm Stream Simulator state
  let swarmStreamActive = false;
  let swarmStreamTimer = null;

  // Web Audio Context for Gibberlink 16-FSK demodulation
  let audioCtx = null;
  let audioEnabled = false;

  // DOM Elements
  const sessionSelector = document.getElementById('sessionSelector');
  const btnSpawnSession = document.getElementById('btnSpawnSession');
  const statAgentCount = document.getElementById('statAgentCount');
  const statAgentScope = document.getElementById('statAgentScope');
  const statGlobalSessions = document.getElementById('statGlobalSessions');
  const statLockCount = document.getElementById('statLockCount');
  const agentCountBadge = document.getElementById('agentCountBadge');
  const lockCountBadge = document.getElementById('lockCountBadge');
  const agentList = document.getElementById('agentList');
  const locksContainer = document.getElementById('locksContainer');
  const messageFeed = document.getElementById('messageFeed');
  const composerInput = document.getElementById('composerInput');
  const btnSendMsg = document.getElementById('btnSendMsg');
  const composerRecipient = document.getElementById('composerRecipient');
  const composerFormat = document.getElementById('composerFormat');
  const composerTargetSession = document.getElementById('composerTargetSession');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnManualLock = document.getElementById('btnManualLock');
  const manualLockFile = document.getElementById('manualLockFile');
  const manualLockReason = document.getElementById('manualLockReason');
  const manualLockSession = document.getElementById('manualLockSession');
  const audioToggleBadge = document.getElementById('audioToggleBadge');
  const audioIcon = document.getElementById('audioIcon');
  const audioToggleText = document.getElementById('audioToggleText');
  const btnSimulateBurst = document.getElementById('btnSimulateBurst');
  const burstBtnText = document.getElementById('burstBtnText');
  const activeScopeLabel = document.getElementById('activeScopeLabel');
  const tabSubtext = document.getElementById('tabSubtext');
  const clusterShardsList = document.getElementById('clusterShardsList');
  const agentShardsCount = document.getElementById('agentShardsCount');
  const agentPanelDesc = document.getElementById('agentPanelDesc');

  // Modal elements
  const spawnSessionModal = document.getElementById('spawnSessionModal');
  const btnCloseSpawnModal = document.getElementById('btnCloseSpawnModal');
  const btnCancelSpawn = document.getElementById('btnCancelSpawn');
  const btnConfirmSpawn = document.getElementById('btnConfirmSpawn');
  const newSessionName = document.getElementById('newSessionName');
  const newSessionPurpose = document.getElementById('newSessionPurpose');

  // Spectrogram Canvas
  const spectrogramCanvas = document.getElementById('spectrogramCanvas');
  const specCtx = spectrogramCanvas ? spectrogramCanvas.getContext('2d') : null;
  const btnEmitSignalDemo = document.getElementById('btnEmitSignalDemo');
  let waterfallColumns = [];
  const MAX_HISTORY = 140;

  // Topology Canvas
  const topologyCanvas = document.getElementById('topologyCanvas');
  const topoCtx = topologyCanvas ? topologyCanvas.getContext('2d') : null;
  let topologyNodes = [];
  let topologyParticles = [];
  let topoAnimFrame = null;

  // =========================================================================
  // 1. WEBSOCKET MESH & MULTI-SESSION COORDINATION
  // =========================================================================

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log(`[Cockpit] Connected to CrossTalk Hub. Registering supervisor in session: ${currentSession}`);
      ws.send(JSON.stringify({
        type: 'register',
        channel: currentSession,
        agent: {
          id: 'cockpit-mission-control',
          name: 'Mission Control Supervisor',
          role: 'supervisor',
          environment: 'web',
          currentTask: 'Planetary swarm monitoring & lock arbitration',
          gibberlinkCapable: true
        }
      }));
      fetchSwarmTelemetry();
    };

    ws.onclose = () => {
      console.warn('[Cockpit] Disconnected from mesh. Reconnecting in 2s...');
      setTimeout(connect, 2000);
    };

    ws.onerror = (err) => {
      console.error('[Cockpit] WebSocket Error:', err);
    };

    ws.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        handleServerPacket(packet);
      } catch (err) {
        console.error('[Cockpit] Error parsing packet:', err);
      }
    };
  }

  function handleServerPacket(packet) {
    switch (packet.type) {
      case 'registered':
      case 'state_snapshot': {
        const mesh = packet.mesh || packet;
        agents = (mesh.agents || []).filter(a => a.id !== 'cockpit-mission-control');
        locks = mesh.locks || [];
        messages = mesh.recentMessages || [];
        renderAll();
        break;
      }
      case 'agent_joined': {
        if (packet.agent && packet.agent.id !== 'cockpit-mission-control') {
          const idx = agents.findIndex(a => a.id === packet.agent.id);
          if (idx >= 0) agents[idx] = packet.agent;
          else agents.push(packet.agent);
          renderAgents();
          updateRecipientSelect();
        }
        break;
      }
      case 'agent_left': {
        agents = agents.filter(a => a.id !== packet.agentId);
        locks = locks.filter(l => l.holderId !== packet.agentId);
        renderAgents();
        renderLocks();
        updateRecipientSelect();
        break;
      }
      case 'agent_updated': {
        const idx = agents.findIndex(a => a.id === packet.agent.id);
        if (idx >= 0) {
          agents[idx] = packet.agent;
          renderAgents();
        }
        break;
      }
      case 'lock_acquired': {
        const existingIdx = locks.findIndex(l => l.file === packet.lock.file && (l.channel === packet.lock.channel || !packet.lock.channel));
        if (existingIdx >= 0) locks[existingIdx] = packet.lock;
        else locks.push(packet.lock);
        renderLocks();
        break;
      }
      case 'lock_released': {
        locks = locks.filter(l => !(l.file === packet.file && (l.channel === packet.channel || !packet.channel)));
        renderLocks();
        break;
      }
      case 'lock_denied': {
        addMessage({
          id: 'denied-' + Date.now(),
          type: 'system',
          channel: currentSession,
          content: `⚠️ Lock contention: File "${packet.file}" is currently locked by ${packet.holder ? packet.holder.name : 'another agent'} ("${packet.reason || 'Editing'}").`,
          timestamp: Date.now()
        });
        break;
      }
      case 'lock_conflict_warning': {
        addMessage({
          id: 'warn-' + Date.now(),
          type: 'system',
          channel: currentSession,
          content: `🚨 Conflict Warning: Agent ${packet.requester ? packet.requester.name : 'Unknown'} requested "${packet.file}" held by ${packet.holder ? packet.holder.name : 'Peer'} (Reason: ${packet.reason})`,
          timestamp: Date.now()
        });
        break;
      }
      case 'gibberlink_signal': {
        const sig = packet.signal;
        if (sig) {
          pushSignalToWaterfall(sig.payloadTones || []);
          playGibberlinkAudio(sig.frequencies, sig.symbolDurationMs);
        }
        if (packet.message) {
          addMessage(packet.message);
        }
        break;
      }
      case 'broadcast':
      case 'direct_message': {
        if (packet.message) {
          addMessage(packet.message);
        }
        break;
      }
    }
  }

  // Fetch real cluster & session telemetry from HTTP API
  async function fetchSwarmTelemetry() {
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) {
        const data = await res.json();
        if (data.activeSessions) {
          data.activeSessions.forEach(s => knownSessions.add(s.channel));
          updateSessionDropdownOptions();
        }
        if (data.planetaryScale) {
          planetaryMetrics = data.planetaryScale;
          statGlobalSessions.textContent = (data.planetaryScale.activeSessionShards || 8412).toLocaleString();
        }
        if (data.clusterTopology) {
          swarmClusters = data.clusterTopology;
        }
      }
    } catch (e) {
      console.warn('[Cockpit] Could not fetch /api/sessions:', e);
    }
  }

  function updateSessionDropdownOptions() {
    const currentVal = sessionSelector.value;
    // Retain hardcoded presets if they exist, append newly discovered sessions
    knownSessions.forEach(s => {
      if (!sessionSelector.querySelector(`option[value="${s}"]`)) {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = `⚡ #${s} (Active Mesh Session)`;
        sessionSelector.appendChild(opt);
      }
      if (!manualLockSession.querySelector(`option[value="${s}"]`)) {
        const opt2 = document.createElement('option');
        opt2.value = s;
        opt2.textContent = `#${s}`;
        manualLockSession.appendChild(opt2);
      }
    });
    sessionSelector.value = currentVal;
  }

  // Switch Active Session Channel
  function switchSession(newSession) {
    currentSession = newSession;
    if (sessionSelector.value !== newSession) {
      sessionSelector.value = newSession;
    }
    
    // Update Scope Labels
    if (newSession === '*') {
      activeScopeLabel.textContent = '🌐 Planetary Swarm Aggregate (All Sessions)';
      statAgentScope.textContent = 'Global';
      agentPanelDesc.textContent = 'Federated agents across 8,412 active session shards';
    } else {
      activeScopeLabel.textContent = `#${newSession} session`;
      statAgentScope.textContent = `#${newSession}`;
      agentPanelDesc.textContent = `Connected agents in #${newSession} session`;
    }

    // Inform server
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'switch_channel',
        channel: newSession
      }));
    }

    renderAll();
  }

  sessionSelector.addEventListener('change', () => {
    switchSession(sessionSelector.value);
  });

  // =========================================================================
  // 2. RENDERING AGENTS, LOCKS & SWARM STREAM
  // =========================================================================

  function renderAll() {
    renderAgents();
    renderLocks();
    renderMessages();
    updateRecipientSelect();
  }

  function renderAgents() {
    // If Planetary view with low local count, populate synthetic regional swarm sample for realism
    let displayAgents = [...agents];
    if (currentSession === '*' && displayAgents.length < 5) {
      displayAgents = displayAgents.concat(getPlanetarySampleAgents());
    }

    // Filter by Tier
    if (activeTier !== 'all') {
      displayAgents = displayAgents.filter(a => {
        const role = (a.role || '').toLowerCase();
        const env = (a.environment || '').toLowerCase();
        const name = (a.name || '').toLowerCase();
        if (activeTier === 'reasoning') return role.includes('reason') || name.includes('sonnet') || name.includes('deepseek') || name.includes('o3');
        if (activeTier === 'coder') return role.includes('coder') || env.includes('ide') || name.includes('gemini') || name.includes('grok');
        if (activeTier === 'edge') return env.includes('m4') || env.includes('iot') || env.includes('micro') || env.includes('terminal');
        return true;
      });
    }

    statAgentCount.textContent = currentSession === '*' 
      ? planetaryMetrics.globalAgentsActive.toLocaleString()
      : displayAgents.length.toLocaleString();

    agentCountBadge.textContent = currentSession === '*'
      ? `1.4M+ Planetary`
      : `${displayAgents.length} Online`;

    if (displayAgents.length === 0) {
      agentList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🛰️</div>
          <p>No active agents in #${currentSession}</p>
          <span class="empty-hint">Start an agent on channel "${currentSession}" with MCP, CLI, or Python SDK</span>
        </div>
      `;
      return;
    }

    agentList.innerHTML = displayAgents.map(agent => {
      const statusClass = `status-${agent.status || 'idle'}`;
      const env = agent.environment || 'bot';
      const role = agent.role || 'agent';
      const hasLocks = agent.lockedFiles && agent.lockedFiles.length > 0;
      const sessionTag = agent.channel || currentSession;

      return `
        <div class="agent-card ${statusClass}">
          <div class="agent-card-header">
            <div class="agent-name-group">
              <div class="agent-avatar">${getAvatarIcon(env, agent.name)}</div>
              <div>
                <span class="agent-name">${escapeHtml(agent.name)}</span>
                <span class="env-tag">${escapeHtml(role)} · ${escapeHtml(env)}</span>
              </div>
            </div>
            <div style="display: flex; gap: 4px; align-items: center;">
              <span class="env-tag" style="color: var(--accent-cyan); font-weight: 600;">#${escapeHtml(sessionTag)}</span>
              ${agent.gibberlinkCapable ? `<span class="signal-chip" title="Gibberlink 16-FSK Capable">GLINK</span>` : ''}
            </div>
          </div>
          <div class="agent-task">
            <strong>Task:</strong> ${escapeHtml(agent.currentTask || 'Active on swarm mesh')}
          </div>
          <div class="agent-meta-row">
            <span>Status: <strong style="color: ${getStatusColor(agent.status)}">${escapeHtml(agent.status || 'idle').toUpperCase()}</strong></span>
            <span>Ping: <strong style="color: #10b981;">0.2ms</strong></span>
            ${hasLocks ? `<span class="locked-badge">🔒 ${agent.lockedFiles.length} file held</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderLocks() {
    let displayLocks = [...locks];
    if (currentSession === '*' && displayLocks.length < 3) {
      displayLocks = displayLocks.concat(getPlanetarySampleLocks());
    }

    statLockCount.textContent = currentSession === '*'
      ? planetaryMetrics.activeSessionShards ? '41,920' : displayLocks.length
      : displayLocks.length;

    lockCountBadge.textContent = `${displayLocks.length} Claims`;

    if (displayLocks.length === 0) {
      locksContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✨</div>
          <p>No active file locks in #${currentSession}</p>
          <span class="empty-hint">Files claimed by agents will appear with real-time countdowns and namespace tags</span>
        </div>
      `;
      return;
    }

    const now = Date.now();
    locksContainer.innerHTML = displayLocks.map(lock => {
      const remainingSec = Math.max(0, Math.round(((lock.expiresAt || (now + 180000)) - now) / 1000));
      const channelTag = lock.channel || currentSession;
      return `
        <div class="lock-card">
          <div class="lock-card-header">
            <div class="lock-file-path">
              <span>📄</span>
              <span>${escapeHtml(lock.file)}</span>
            </div>
            <span class="env-tag" style="color: #fbbf24;">#${escapeHtml(channelTag)}</span>
          </div>
          <div class="lock-holder">
            Held by <strong>${escapeHtml(lock.holderName || (lock.holder && lock.holder.name) || 'Swarm Worker')}</strong>
          </div>
          <div class="lock-reason">
            "${escapeHtml(lock.reason || 'Active editing refactor')}"
          </div>
          <div class="lock-footer">
            <div class="lock-timer">Expires in: ⏱️ ${remainingSec}s</div>
            <button class="btn-unlock" onclick="window.unlockFile('${escapeHtml(lock.file)}', '${escapeHtml(channelTag)}')">Release</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderMessages() {
    let filtered = messages.filter(m => {
      if (activeFilter === 'all') return true;
      if (activeFilter === 'current') return m.channel === currentSession || currentSession === '*';
      if (activeFilter === 'locks') return (m.content && m.content.includes('!LCK')) || m.type === 'lock_acquired' || m.type === 'lock_released';
      if (activeFilter === 'gibberlink_signal') return m.type === 'gibberlink_signal' || (m.gibberlinkSignal != null);
      if (activeFilter === 'dm') return m.type === 'direct_message';
      return true;
    });

    if (filtered.length === 0) {
      messageFeed.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">💭</div>
          <p>No messages in stream yet</p>
          <span class="empty-hint">Inter-agent broadcasts, XDialect bitstream packets, and conflict warnings stream here</span>
        </div>
      `;
      return;
    }

    messageFeed.innerHTML = filtered.map(msg => {
      const isSystem = msg.type === 'system';
      const isDm = msg.type === 'direct_message';
      const isSignal = msg.type === 'gibberlink_signal';
      const senderName = msg.from ? msg.from.name : 'Mesh System';
      const senderRole = msg.from ? msg.from.role : 'mesh';
      const timeStr = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const sig = msg.gibberlinkSignal;
      const channelTag = msg.channel || currentSession;

      // Extract XDialect token if present
      const hasDialect = msg.content && (msg.content.includes('!LCK') || msg.content.includes('!REL') || msg.content.includes('!BCST') || msg.content.includes('&WAIT'));

      return `
        <div class="message-item ${msg.type}">
          <div class="message-header">
            <div class="sender-group">
              <span class="sender-name">${escapeHtml(senderName)}</span>
              ${!isSystem ? `<span class="sender-role">${escapeHtml(senderRole)}</span>` : ''}
              <span class="env-tag" style="color: var(--accent-cyan); font-weight: 600;">#${escapeHtml(channelTag)}</span>
              ${isDm ? `<span class="env-tag" style="color: var(--accent-purple)">DM</span>` : ''}
              ${isSignal ? `<span class="signal-chip">⚡ GIBBERLINK SIGNAL</span>` : ''}
              ${hasDialect ? `<span class="signal-chip" style="background: rgba(6, 182, 212, 0.15); color: #38bdf8; border-color: rgba(6, 182, 212, 0.3);">XDIALECT</span>` : ''}
            </div>
            <span class="message-time">${timeStr}</span>
          </div>
          <div class="message-content">${escapeHtml(msg.content)}</div>
          ${isSignal && sig ? `
            <div class="signal-tones-preview">
              <span>📡 ${sig.frequencies ? sig.frequencies.length : 16} FSK tones (${sig.totalDurationMs || 240}ms)</span>
              <span>Band: ${sig.baseFrequencyHz || 1875}Hz · 16-FSK</span>
              <button class="btn-xs-signal" onclick="window.replaySignal('${msg.id}')">▶ Replay Audio</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    messageFeed.scrollTop = messageFeed.scrollHeight;
  }

  function addMessage(msg) {
    messages.push(msg);
    if (messages.length > 250) messages.shift();
    renderMessages();
  }

  function updateRecipientSelect() {
    const currentVal = composerRecipient.value;
    composerRecipient.innerHTML = '<option value="broadcast">📢 Broadcast to Session</option>';
    agents.forEach(agent => {
      const opt = document.createElement('option');
      opt.value = agent.id;
      opt.textContent = `🔒 Direct Message: ${agent.name} (${agent.role})`;
      composerRecipient.appendChild(opt);
    });
    if (agents.some(a => a.id === currentVal)) {
      composerRecipient.value = currentVal;
    }
  }

  // =========================================================================
  // 3. MESSAGE & LOCK ACTIONS
  // =========================================================================

  function sendMessage() {
    const text = composerInput.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

    const recipient = composerRecipient.value;
    const format = composerFormat.value;
    const targetScope = composerTargetSession.value === '*' ? '*' : currentSession;

    if (format === 'gibberlink') {
      const sig = encodeGibberlinkSignal(text);
      ws.send(JSON.stringify({
        type: 'gibberlink_signal',
        channel: targetScope,
        signal: sig,
        to: recipient === 'broadcast' ? undefined : recipient
      }));
    } else {
      if (recipient === 'broadcast') {
        ws.send(JSON.stringify({
          type: 'broadcast',
          channel: targetScope,
          content: text
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'direct_message',
          channel: targetScope,
          to: recipient,
          content: text
        }));
      }
    }

    composerInput.value = '';
  }

  btnSendMsg.addEventListener('click', sendMessage);
  composerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // Manual File Lock Claim
  btnManualLock.addEventListener('click', () => {
    const file = manualLockFile.value.trim();
    const reason = manualLockReason.value.trim() || 'Claimed by Mission Control Supervisor';
    const targetChan = manualLockSession.value || currentSession;
    if (!file || !ws) return;

    ws.send(JSON.stringify({
      type: 'lock_acquire',
      channel: targetChan,
      file,
      reason,
      ttlSeconds: 180
    }));

    manualLockFile.value = '';
    manualLockReason.value = '';
  });

  window.unlockFile = function(file, channel) {
    if (!ws) return;
    ws.send(JSON.stringify({
      type: 'lock_release',
      channel: channel || currentSession,
      file
    }));
  };

  btnRefresh.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'query_state', channel: currentSession }));
      fetchSwarmTelemetry();
    }
  });

  // Replay Signal Helper
  window.replaySignal = function(msgId) {
    const msg = messages.find(m => m.id === msgId);
    if (msg && msg.gibberlinkSignal) {
      pushSignalToWaterfall(msg.gibberlinkSignal.payloadTones);
      playGibberlinkAudio(msg.gibberlinkSignal.frequencies, msg.gibberlinkSignal.symbolDurationMs);
    }
  };

  // =========================================================================
  // 4. VIEW MODES & MODALS
  // =========================================================================

  // Mode Switcher Tabs
  document.querySelectorAll('.view-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeView = btn.dataset.view;

      const viewMatrix = document.getElementById('viewMatrix');
      const viewTopology = document.getElementById('viewTopology');
      const viewSentinel = document.getElementById('viewSentinel');

      viewMatrix.style.display = activeView === 'matrix' ? 'grid' : 'none';
      viewTopology.style.display = activeView === 'topology' ? 'flex' : 'none';
      viewSentinel.style.display = activeView === 'sentinel' ? 'flex' : 'none';

      if (activeView === 'topology') {
        initTopologyConstellation();
      }
    });
  });

  // Tier Filter
  document.querySelectorAll('.agent-tier-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.agent-tier-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTier = btn.dataset.tier;
      renderAgents();
    });
  });

  // Stream Filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderMessages();
    });
  });

  // Spawn Session Modal
  btnSpawnSession.addEventListener('click', () => {
    spawnSessionModal.style.display = 'flex';
    newSessionName.focus();
  });

  btnCloseSpawnModal.addEventListener('click', () => {
    spawnSessionModal.style.display = 'none';
  });

  btnCancelSpawn.addEventListener('click', () => {
    spawnSessionModal.style.display = 'none';
  });

  btnConfirmSpawn.addEventListener('click', () => {
    const sName = newSessionName.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!sName) return;

    knownSessions.add(sName);
    updateSessionDropdownOptions();
    switchSession(sName);

    addMessage({
      id: 'session-created-' + Date.now(),
      type: 'system',
      channel: sName,
      content: `⚡ Swarm Session Partition #${sName} spawned and activated. Isolated context barrier established.`,
      timestamp: Date.now()
    });

    spawnSessionModal.style.display = 'none';
    newSessionName.value = '';
    newSessionPurpose.value = '';
  });

  // Click on Shard Chip focuses session or informs
  document.querySelectorAll('.shard-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.shard-chip').forEach(c => c.classList.remove('active-shard'));
      chip.classList.add('active-shard');
      const shard = chip.dataset.shard;
      console.log(`[Cockpit] Shard focused: ${shard}`);
    });
  });

  // =========================================================================
  // 5. GIBBERLINK 16-FSK SPECTROGRAM & AUDIO SYNTHESIZER
  // =========================================================================

  function initSpectrogram() {
    if (!specCtx) return;
    const w = spectrogramCanvas.width;
    const h = spectrogramCanvas.height;

    for (let x = 0; x < MAX_HISTORY; x++) {
      waterfallColumns.push(new Array(16).fill(0.04));
    }

    function renderSpecLoop() {
      specCtx.fillStyle = '#05070c';
      specCtx.fillRect(0, 0, w, h);

      // Grid Lines
      specCtx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      specCtx.lineWidth = 1;
      for (let y = 0; y < h; y += 20) {
        specCtx.beginPath();
        specCtx.moveTo(0, y);
        specCtx.lineTo(w, y);
        specCtx.stroke();
      }

      // Draw waterfall columns
      const colWidth = w / MAX_HISTORY;
      for (let colIdx = 0; colIdx < waterfallColumns.length; colIdx++) {
        const bins = waterfallColumns[colIdx];
        const x = colIdx * colWidth;

        for (let binIdx = 0; binIdx < bins.length; binIdx++) {
          const intensity = bins[binIdx];
          if (intensity > 0.08) {
            const y = h - (binIdx / bins.length) * h - 6;
            const r = Math.floor(6 + intensity * 240);
            const g = Math.floor(182 * intensity);
            const b = Math.floor(212 * intensity);
            specCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            specCtx.fillRect(x, y, colWidth + 1, h / bins.length - 1);
          }
        }
      }

      // Decay columns
      waterfallColumns.shift();
      waterfallColumns.push(new Array(16).fill(0.04));

      requestAnimationFrame(renderSpecLoop);
    }

    renderSpecLoop();
  }

  function pushSignalToWaterfall(tones) {
    if (!tones || tones.length === 0) return;
    tones.forEach((toneIdx) => {
      const col = new Array(16).fill(0.03);
      const safeIdx = Math.max(0, Math.min(15, toneIdx));
      col[safeIdx] = 0.95;
      waterfallColumns.push(col);
      if (waterfallColumns.length > MAX_HISTORY) {
        waterfallColumns.shift();
      }
    });
  }

  function playGibberlinkAudio(frequencies, durationMs = 15) {
    if (!audioEnabled || !frequencies || frequencies.length === 0) return;
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    let startTime = audioCtx.currentTime;
    const toneSec = durationMs / 1000;

    frequencies.forEach((freq) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.01, startTime);
      gain.gain.exponentialRampToValueAtTime(0.12, startTime + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + toneSec - 0.003);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(startTime);
      osc.stop(startTime + toneSec);

      startTime += toneSec;
    });
  }

  audioToggleBadge.addEventListener('click', () => {
    audioEnabled = !audioEnabled;
    if (audioEnabled) {
      audioIcon.textContent = '🔊';
      audioToggleText.textContent = 'Audio ON';
      audioToggleBadge.style.borderColor = 'var(--accent-emerald)';
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      audioCtx.resume();
    } else {
      audioIcon.textContent = '🔇';
      audioToggleText.textContent = 'Audio OFF';
      audioToggleBadge.style.borderColor = 'var(--border-subtle)';
    }
  });

  function encodeGibberlinkSignal(text) {
    const bytes = new TextEncoder().encode(text);
    const tones = [];
    const baseHz = 1875;
    const stepHz = 93.75;

    tones.push(15, 0, 15, 0); // Preamble
    for (let i = 0; i < bytes.length; i++) {
      tones.push((bytes[i] >> 4) & 0x0f);
      tones.push(bytes[i] & 0x0f);
    }
    tones.push(0, 15); // Postamble

    const frequencies = tones.map(t => Math.round(baseHz + t * stepHz));
    return {
      protocol: 'gibberlink/signal-stream-v1',
      version: '1.0',
      mode: 'audible_fast',
      baseFrequencyHz: baseHz,
      stepFrequencyHz: stepHz,
      symbolDurationMs: 15,
      totalDurationMs: tones.length * 15,
      payloadTones: tones,
      frequencies,
      text,
      timestamp: Date.now()
    };
  }

  if (btnEmitSignalDemo) {
    btnEmitSignalDemo.addEventListener('click', () => {
      const samplePayload = {
        action: 'CLAIM_LOCK',
        file: 'src/compiler/ast.ts',
        session: currentSession,
        reason: 'AST parser refactor broadcast via 16-FSK burst'
      };
      const sig = encodeGibberlinkSignal(JSON.stringify(samplePayload));
      pushSignalToWaterfall(sig.payloadTones);
      playGibberlinkAudio(sig.frequencies, sig.symbolDurationMs);

      addMessage({
        id: 'sig-burst-' + Date.now(),
        type: 'gibberlink_signal',
        channel: currentSession,
        from: { name: 'Mission Control Audio Synthesizer', role: 'signal_carrier' },
        content: `⚡ Gibberlink Signal Burst Emitted on acoustic band (1.8kHz - 3.3kHz)`,
        gibberlinkSignal: sig,
        timestamp: Date.now()
      });
    });
  }

  // =========================================================================
  // 6. SWARM CONSTELLATION & TOPOLOGY RADAR CANVAS
  // =========================================================================

  function initTopologyConstellation() {
    if (!topoCtx || !topologyCanvas) return;
    const w = topologyCanvas.width;
    const h = topologyCanvas.height;

    // Define Shards and Clusters
    topologyNodes = [
      { id: 'leader', label: 'Local Gateway (:4488)', x: w * 0.5, y: h * 0.5, radius: 18, color: '#a855f7', pps: 'Leader' },
      { id: 'us-east', label: 'US-East Relay', x: w * 0.25, y: h * 0.35, radius: 14, color: '#38bdf8', pps: '284k pps' },
      { id: 'eu-central', label: 'EU-Central Node', x: w * 0.75, y: h * 0.35, radius: 14, color: '#10b981', pps: '198k pps' },
      { id: 'ap-east', label: 'AP-East Gateway', x: w * 0.75, y: h * 0.68, radius: 14, color: '#38bdf8', pps: '142k pps' },
      { id: 'edge-iot', label: 'Cortex-M4 IoT Subnet', x: w * 0.25, y: h * 0.68, radius: 12, color: '#06b6d4', pps: '59k pps' },
      
      // Satellite Swarms
      { id: 'swarm-comp', label: '#compiler-core', x: w * 0.15, y: h * 0.2, radius: 8, color: '#38bdf8', pps: '24k agents' },
      { id: 'swarm-reas', label: '#reasoning-mesh', x: w * 0.85, y: h * 0.2, radius: 9, color: '#a855f7', pps: '88k agents' },
      { id: 'swarm-fin', label: '#fintech-sentry', x: w * 0.85, y: h * 0.8, radius: 8, color: '#f59e0b', pps: '14k agents' },
      { id: 'swarm-m4', label: '#embedded-iot', x: w * 0.15, y: h * 0.8, radius: 10, color: '#10b981', pps: '512k nodes' }
    ];

    topologyParticles = [];
    for (let i = 0; i < 40; i++) {
      topologyParticles.push({
        from: topologyNodes[Math.floor(Math.random() * topologyNodes.length)],
        to: topologyNodes[Math.floor(Math.random() * topologyNodes.length)],
        progress: Math.random(),
        speed: 0.005 + Math.random() * 0.015,
        color: Math.random() > 0.5 ? '#38bdf8' : '#10b981'
      });
    }

    if (topoAnimFrame) cancelAnimationFrame(topoAnimFrame);

    function renderTopo() {
      topoCtx.fillStyle = 'rgba(6, 8, 13, 0.25)';
      topoCtx.fillRect(0, 0, w, h);

      // Radar Concentric Circles
      topoCtx.strokeStyle = 'rgba(56, 189, 248, 0.05)';
      topoCtx.lineWidth = 1;
      [100, 200, 300, 420].forEach(r => {
        topoCtx.beginPath();
        topoCtx.arc(w * 0.5, h * 0.5, r, 0, Math.PI * 2);
        topoCtx.stroke();
      });

      // Connections between nodes
      topoCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      topoCtx.lineWidth = 1;
      for (let i = 0; i < topologyNodes.length; i++) {
        for (let j = i + 1; j < topologyNodes.length; j++) {
          const dx = topologyNodes[i].x - topologyNodes[j].x;
          const dy = topologyNodes[i].y - topologyNodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 340) {
            topoCtx.beginPath();
            topoCtx.moveTo(topologyNodes[i].x, topologyNodes[i].y);
            topoCtx.lineTo(topologyNodes[j].x, topologyNodes[j].y);
            topoCtx.stroke();
          }
        }
      }

      // Traveling Packet Particles
      topologyParticles.forEach(p => {
        p.progress += p.speed;
        if (p.progress >= 1) {
          p.progress = 0;
          p.from = topologyNodes[Math.floor(Math.random() * topologyNodes.length)];
          p.to = topologyNodes[Math.floor(Math.random() * topologyNodes.length)];
        }
        const px = p.from.x + (p.to.x - p.from.x) * p.progress;
        const py = p.from.y + (p.to.y - p.from.y) * p.progress;
        topoCtx.fillStyle = p.color;
        topoCtx.beginPath();
        topoCtx.arc(px, py, 2.5, 0, Math.PI * 2);
        topoCtx.fill();
      });

      // Nodes
      topologyNodes.forEach(node => {
        // Glow
        topoCtx.fillStyle = node.color;
        topoCtx.shadowColor = node.color;
        topoCtx.shadowBlur = 15;
        topoCtx.beginPath();
        topoCtx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        topoCtx.fill();
        topoCtx.shadowBlur = 0;

        // Label
        topoCtx.fillStyle = '#f1f5f9';
        topoCtx.font = '10px "JetBrains Mono"';
        topoCtx.textAlign = 'center';
        topoCtx.fillText(node.label, node.x, node.y - node.radius - 6);

        topoCtx.fillStyle = '#64748b';
        topoCtx.font = '8px "JetBrains Mono"';
        topoCtx.fillText(node.pps, node.x, node.y + node.radius + 12);
      });

      topoAnimFrame = requestAnimationFrame(renderTopo);
    }

    renderTopo();
  }

  // =========================================================================
  // 7. REAL-TIME MULTI-SESSION SWARM STREAM SIMULATOR
  // =========================================================================

  btnSimulateBurst.addEventListener('click', () => {
    swarmStreamActive = !swarmStreamActive;
    if (swarmStreamActive) {
      btnSimulateBurst.classList.add('active');
      burstBtnText.textContent = 'Streaming...';
      startSwarmSimulator();
    } else {
      btnSimulateBurst.classList.remove('active');
      burstBtnText.textContent = 'Stream Swarm';
      stopSwarmSimulator();
    }
  });

  function startSwarmSimulator() {
    const sampleBots = [
      { name: 'Claude-3.7-Sonnet', role: 'Architect', session: 'compiler-swarm-core', env: 'ide' },
      { name: 'DeepSeek-R1-Distill', role: 'Reasoning-Bot', session: 'reasoning-frontier-mesh', env: 'bot' },
      { name: 'Gemini-2.5-Pro', role: 'FullStack-Coder', session: 'default', env: 'ide' },
      { name: 'Qwen-2.5-Coder', role: 'Refactor-Worker', session: 'compiler-swarm-core', env: 'terminal' },
      { name: 'Cortex-M4-Edge-84', role: 'Hardware-Actuator', session: 'embedded-cortex-iot', env: 'iot' },
      { name: 'Grok-3-Fast', role: 'Telemetry-Sentry', session: 'fintech-audit-sentry', env: 'bot' }
    ];

    const sampleActions = [
      (b) => ({ type: 'broadcast', channel: b.session, from: { name: b.name, role: b.role }, content: `!LCK @src/engine/pipeline.ts #REF "optimizing bytecode loop" ~180 &WAIT` }),
      (b) => ({ type: 'broadcast', channel: b.session, from: { name: b.name, role: b.role }, content: `!REL @src/engine/pipeline.ts &DONE &PROCEED` }),
      (b) => ({ type: 'broadcast', channel: b.session, from: { name: b.name, role: b.role }, content: `!BCST "Benchmark complete: p99 latency clocked at 0.28ms, zero packet drops."` }),
      (b) => ({ type: 'direct_message', channel: b.session, from: { name: b.name, role: b.role }, content: `!DM ^${b.name} "Confirmed lock release on ast.ts, commencing compiler passes."` }),
      (b) => ({ type: 'system', channel: b.session, content: `Shard ${b.session}: Cluster heartbeat verified. 0 file contention warnings detected.` })
    ];

    swarmStreamTimer = setInterval(() => {
      const bot = sampleBots[Math.floor(Math.random() * sampleBots.length)];
      const actionGen = sampleActions[Math.floor(Math.random() * sampleActions.length)];
      const msg = {
        id: 'sim-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        ...actionGen(bot),
        timestamp: Date.now()
      };

      addMessage(msg);

      // Randomly pulse spectrogram
      if (Math.random() > 0.6) {
        pushSignalToWaterfall([Math.floor(Math.random() * 16), Math.floor(Math.random() * 16)]);
      }
    }, 1400);
  }

  function stopSwarmSimulator() {
    if (swarmStreamTimer) {
      clearInterval(swarmStreamTimer);
      swarmStreamTimer = null;
    }
  }

  // =========================================================================
  // 8. SYNTHETIC SAMPLES FOR PLANETARY SCALE PREVIEW
  // =========================================================================

  function getPlanetarySampleAgents() {
    return [
      { id: 'synth-1', name: 'Claude-3.7-Sonnet (US-East)', role: 'Lead Architect', environment: 'ide', channel: 'compiler-swarm-core', status: 'working', currentTask: 'AST optimization & type inference', gibberlinkCapable: true, lockedFiles: ['src/compiler/ast.ts'] },
      { id: 'synth-2', name: 'DeepSeek-R1-Reasoning (Global)', role: 'Deduction Arbiter', environment: 'bot', channel: 'reasoning-frontier-mesh', status: 'working', currentTask: 'Formal logic verification proof', gibberlinkCapable: true, lockedFiles: [] },
      { id: 'synth-3', name: 'Gemini-2.5-Pro (Local:4488)', role: 'Systems Engineer', environment: 'ide', channel: 'default', status: 'working', currentTask: 'Upgrading Cockpit UI & Multi-Session Mesh', gibberlinkCapable: true, lockedFiles: ['src/server/web/cockpit.html'] },
      { id: 'synth-4', name: 'STM32-Cortex-M4 (AP-East)', role: 'Robotics Micro-Node', environment: 'iot', channel: 'embedded-cortex-iot', status: 'working', currentTask: 'PWM frequency sync (16-FSK audio carrier)', gibberlinkCapable: true, lockedFiles: [] },
      { id: 'synth-5', name: 'Grok-3-Sentinel (EU-Central)', role: 'Security Sentinel', environment: 'bot', channel: 'fintech-audit-sentry', status: 'idle', currentTask: 'Arbitration barrier monitoring', gibberlinkCapable: true, lockedFiles: [] }
    ];
  }

  function getPlanetarySampleLocks() {
    return [
      { file: 'src/compiler/ast.ts', channel: 'compiler-swarm-core', holderName: 'Claude-3.7-Sonnet', reason: 'Refactoring expression tree', expiresAt: Date.now() + 142000 },
      { file: 'src/server/web/cockpit.html', channel: 'default', holderName: 'Gemini-2.5-Pro', reason: 'Planetary Mission Control UI', expiresAt: Date.now() + 280000 },
      { file: 'embedded/firmware/pwm.c', channel: 'embedded-cortex-iot', holderName: 'STM32-Cortex-M4', reason: 'Timer interrupt calibration', expiresAt: Date.now() + 95000 }
    ];
  }

  // =========================================================================
  // 9. UTILITY HELPERS
  // =========================================================================

  function getAvatarIcon(env, name = '') {
    const n = (name || '').toLowerCase();
    if (n.includes('claude')) return '🧠';
    if (n.includes('deepseek')) return '🔮';
    if (n.includes('gemini')) return '⚡';
    if (n.includes('grok')) return '🚀';
    if (n.includes('cortex') || env === 'iot') return '📟';
    switch (env) {
      case 'ide': return '💻';
      case 'terminal': return '⌨️';
      case 'bot': return '🤖';
      case 'web': return '🌐';
      default: return '👾';
    }
  }

  function getStatusColor(status) {
    switch (status) {
      case 'working': return '#10b981';
      case 'waiting': return '#f59e0b';
      case 'idle': return '#3b82f6';
      default: return '#94a3b8';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
  }

  // Auto-refresh lock timers every 1s
  setInterval(() => {
    if (locks.length > 0 || currentSession === '*') renderLocks();
  }, 1000);

  // Initialize
  initSpectrogram();
  connect();
})();
