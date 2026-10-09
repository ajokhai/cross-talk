// CrossTalk Live Mesh Cockpit — 100% Real-Life Telemetry & Multi-Agent State
(function() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  let ws = null;
  let currentScope = 'default'; // 'default', '*', or specific channel ID
  let activeView = 'matrix'; // 'matrix', 'topology', 'sentinel'
  let activeTier = 'all'; // 'all', 'ide', 'terminal', 'bot'
  let activeFilter = 'all'; // 'all', 'current', 'locks', 'gibberlink_signal', 'dm'

  // Live mesh state (strictly populated from real server packets)
  let agents = [];
  let locks = [];
  let messages = [];
  let knownChannels = new Set(['default']);
  let liveMetrics = {
    connectedAgents: 0,
    activeLocks: 0,
    activeSessionsCount: 1,
    totalMessagesRouted: 0,
    totalBytesTransferred: 0,
    totalPacketsReceived: 0,
    totalPacketsSent: 0,
    totalConflictsBlocked: 0,
    uptimeSeconds: 0,
    memoryRssBytes: 0,
    memoryHeapUsedBytes: 0
  };

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
  const statTotalMessages = document.getElementById('statTotalMessages');
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
  const activeScopeLabel = document.getElementById('activeScopeLabel');
  const tabSubtext = document.getElementById('tabSubtext');
  const agentPanelDesc = document.getElementById('agentPanelDesc');
  const agentSubnetLabel = document.getElementById('agentSubnetLabel');

  // Live Telemetry strip elements
  const telemetryHubStatus = document.getElementById('telemetryHubStatus');
  const telemetryBytesCount = document.getElementById('telemetryBytesCount');
  const telemetryConflictsCount = document.getElementById('telemetryConflictsCount');
  const telemetryUptime = document.getElementById('telemetryUptime');
  const telemetryMemory = document.getElementById('telemetryMemory');

  // Topology elements
  const topoPeerCount = document.getElementById('topoPeerCount');
  const topoChannelCount = document.getElementById('topoChannelCount');
  const topoLockCount = document.getElementById('topoLockCount');
  const topoMsgCount = document.getElementById('topoMsgCount');
  const topologyCanvas = document.getElementById('topologyCanvas');
  const topoCtx = topologyCanvas ? topologyCanvas.getContext('2d') : null;
  let topoAnimFrame = null;

  // Sentinel elements
  const sentinelLocksList = document.getElementById('sentinelLocksList');

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

  // =========================================================================
  // 1. WEBSOCKET MESH & REAL-LIFE DATA INGESTION
  // =========================================================================

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log(`[Cockpit] Connected to CrossTalk Hub. Registering supervisor on channel: ${currentScope}`);
      if (telemetryHubStatus) {
        telemetryHubStatus.textContent = `CONNECTED (${wsUrl})`;
        telemetryHubStatus.style.color = '#10b981';
      }

      ws.send(JSON.stringify({
        type: 'register',
        channel: currentScope,
        agent: {
          id: 'cockpit-mission-control',
          name: 'Mission Control Supervisor',
          role: 'supervisor',
          environment: 'web',
          currentTask: 'Live peer monitoring & collision guard',
          gibberlinkCapable: true
        }
      }));

      // Immediately pull real state and telemetry
      fetchRealTelemetry();
    };

    ws.onclose = () => {
      console.warn('[Cockpit] Disconnected from mesh. Reconnecting in 2s...');
      if (telemetryHubStatus) {
        telemetryHubStatus.textContent = 'DISCONNECTED (RETRYING...)';
        telemetryHubStatus.style.color = '#f43f5e';
      }
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
        
        // Discover channels from real agents
        agents.forEach(a => {
          if (a.channel) knownChannels.add(a.channel);
        });
        locks.forEach(l => {
          if (l.channel) knownChannels.add(l.channel);
        });
        updateChannelDropdown();

        renderAll();
        fetchRealTelemetry();
        break;
      }

      case 'agent_joined': {
        if (packet.agent && packet.agent.id !== 'cockpit-mission-control') {
          const idx = agents.findIndex(a => a.id === packet.agent.id);
          if (idx >= 0) agents[idx] = packet.agent;
          else agents.push(packet.agent);
          
          if (packet.agent.channel) {
            knownChannels.add(packet.agent.channel);
            updateChannelDropdown();
          }

          renderAgents();
          updateRecipientSelect();
          fetchRealTelemetry();
        }
        break;
      }

      case 'agent_left': {
        agents = agents.filter(a => a.id !== packet.agentId);
        locks = locks.filter(l => l.holderId !== packet.agentId);
        renderAgents();
        renderLocks();
        updateRecipientSelect();
        fetchRealTelemetry();
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
        
        if (packet.lock.channel) {
          knownChannels.add(packet.lock.channel);
          updateChannelDropdown();
        }

        renderLocks();
        fetchRealTelemetry();
        break;
      }

      case 'lock_released': {
        locks = locks.filter(l => !(l.file === packet.file && (l.channel === packet.channel || !packet.channel)));
        renderLocks();
        fetchRealTelemetry();
        break;
      }

      case 'lock_denied': {
        addMessage({
          id: 'denied-' + Date.now(),
          type: 'system',
          channel: currentScope,
          content: `⚠️ Lock contention: File "${packet.file}" is currently locked by ${packet.holder ? packet.holder.name : 'another agent'} ("${packet.reason || 'Editing'}").`,
          timestamp: Date.now()
        });
        fetchRealTelemetry();
        break;
      }

      case 'lock_conflict_warning': {
        addMessage({
          id: 'warn-' + Date.now(),
          type: 'system',
          channel: currentScope,
          content: `🚨 Conflict Warning: Agent ${packet.requester ? packet.requester.name : 'Unknown'} requested "${packet.file}" held by ${packet.holder ? packet.holder.name : 'Peer'} (Reason: "${packet.reason}")`,
          timestamp: Date.now()
        });
        fetchRealTelemetry();
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

  // Fetch 100% real server telemetry from /api/sessions and /api/stats
  async function fetchRealTelemetry() {
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) {
        const data = await res.json();
        
        if (data.activeSessions) {
          data.activeSessions.forEach(s => knownChannels.add(s.channel));
          updateChannelDropdown();
        }

        if (data.metrics) {
          liveMetrics = data.metrics;
          updateTelemetryUI(data.metrics);
        }
      }
    } catch (e) {
      console.warn('[Cockpit] Could not fetch real telemetry:', e);
    }
  }

  function updateTelemetryUI(m) {
    if (statGlobalSessions) statGlobalSessions.textContent = (m.activeSessionsCount || knownChannels.size).toString();
    if (statTotalMessages) statTotalMessages.textContent = (m.totalMessagesRouted || messages.length).toString();

    if (telemetryBytesCount) {
      telemetryBytesCount.textContent = formatBytes(m.totalBytesTransferred || 0);
    }
    if (telemetryConflictsCount) {
      telemetryConflictsCount.textContent = `${m.totalConflictsBlocked || 0} prevented`;
    }
    if (telemetryUptime) {
      telemetryUptime.textContent = formatUptime(m.uptimeSeconds || 0);
    }
    if (telemetryMemory) {
      telemetryMemory.textContent = `${Math.round((m.memoryRssBytes || 0) / 1024 / 1024)} MB`;
    }

    if (topoPeerCount) topoPeerCount.textContent = agents.length.toString();
    if (topoChannelCount) topoChannelCount.textContent = knownChannels.size.toString();
    if (topoLockCount) topoLockCount.textContent = locks.length.toString();
    if (topoMsgCount) topoMsgCount.textContent = (m.totalMessagesRouted || messages.length).toString();
  }

  function updateChannelDropdown() {
    const currentVal = sessionSelector.value;
    
    // Cleanly re-populate dropdown with ONLY real discovered channels
    const fragment = document.createDocumentFragment();

    const optAll = document.createElement('option');
    optAll.value = '*';
    optAll.textContent = '🌐 ALL CHANNELS (Global Mesh Stream)';
    fragment.appendChild(optAll);

    knownChannels.forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch;
      const count = agents.filter(a => (a.channel || 'default') === ch).length;
      opt.textContent = `🟢 #${ch} (${count} agent${count === 1 ? '' : 's'})`;
      fragment.appendChild(opt);
    });

    sessionSelector.innerHTML = '';
    sessionSelector.appendChild(fragment);
    sessionSelector.value = knownChannels.has(currentVal) || currentVal === '*' ? currentVal : 'default';

    // Update manual lock session select
    if (manualLockSession) {
      const manualFrag = document.createDocumentFragment();
      knownChannels.forEach(ch => {
        const opt = document.createElement('option');
        opt.value = ch;
        opt.textContent = `#${ch}`;
        manualFrag.appendChild(opt);
      });
      manualLockSession.innerHTML = '';
      manualLockSession.appendChild(manualFrag);
    }
  }

  // Switch Active Channel Scope
  function switchChannelScope(newScope) {
    currentScope = newScope;
    if (sessionSelector.value !== newScope) {
      sessionSelector.value = newScope;
    }

    if (newScope === '*') {
      activeScopeLabel.textContent = '🌐 All Channels (Global Stream)';
      statAgentScope.textContent = 'All Channels';
      agentPanelDesc.textContent = 'All connected peers across active channels';
    } else {
      activeScopeLabel.textContent = `#${newScope}`;
      statAgentScope.textContent = `#${newScope}`;
      agentPanelDesc.textContent = `Connected peers in #${newScope}`;
    }

    // Inform server to filter or provide state
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'switch_channel',
        channel: newScope
      }));
    }

    renderAll();
  }

  sessionSelector.addEventListener('change', () => {
    switchChannelScope(sessionSelector.value);
  });

  // =========================================================================
  // 2. RENDERING AGENTS, LOCKS & STREAM
  // =========================================================================

  function renderAll() {
    renderAgents();
    renderLocks();
    renderMessages();
    renderSentinelLedger();
    updateRecipientSelect();
    if (activeView === 'topology') renderTopology();
  }

  function renderAgents() {
    let displayAgents = agents.filter(a => {
      if (currentScope === '*') return true;
      return (a.channel || 'default') === currentScope;
    });

    // Filter by environment tier
    if (activeTier !== 'all') {
      displayAgents = displayAgents.filter(a => {
        const env = (a.environment || '').toLowerCase();
        if (activeTier === 'ide') return env === 'ide';
        if (activeTier === 'terminal') return env === 'terminal';
        if (activeTier === 'bot') return env === 'bot' || env === 'worker';
        return true;
      });
    }

    statAgentCount.textContent = displayAgents.length.toString();
    agentCountBadge.textContent = `${displayAgents.length} Online`;

    if (displayAgents.length > 0 && agentSubnetLabel) {
      agentSubnetLabel.textContent = displayAgents[0].subnet || '127.0.0.1';
    }

    if (displayAgents.length === 0) {
      agentList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🛰️</div>
          <p>No active agents in #${currentScope}</p>
          <span class="empty-hint">Start an agent with MCP, CLI (<code>crosstalk who</code>), or Python SDK</span>
        </div>
      `;
      return;
    }

    agentList.innerHTML = displayAgents.map(agent => {
      const statusClass = `status-${agent.status || 'idle'}`;
      const env = agent.environment || 'bot';
      const role = agent.role || 'agent';
      const hasLocks = agent.lockedFiles && agent.lockedFiles.length > 0;
      const channelTag = agent.channel || 'default';

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
              <span class="env-tag" style="color: var(--accent-cyan); font-weight: 600;">#${escapeHtml(channelTag)}</span>
              ${agent.gibberlinkCapable ? `<span class="signal-chip" title="Gibberlink Capable">GLINK</span>` : ''}
            </div>
          </div>
          <div class="agent-task">
            <strong>Task:</strong> ${escapeHtml(agent.currentTask || 'Connected to CrossTalk mesh')}
          </div>
          <div class="agent-meta-row">
            <span>Status: <strong style="color: ${getStatusColor(agent.status)}">${escapeHtml(agent.status || 'idle').toUpperCase()}</strong></span>
            <span>Subnet: <strong>${escapeHtml(agent.subnet || '127.0.0.1')}</strong></span>
            ${hasLocks ? `<span class="locked-badge">🔒 ${agent.lockedFiles.length} file(s) held</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderLocks() {
    let displayLocks = locks.filter(l => {
      if (currentScope === '*') return true;
      return (l.channel || 'default') === currentScope;
    });

    statLockCount.textContent = displayLocks.length.toString();
    lockCountBadge.textContent = `${displayLocks.length} Claims`;

    if (displayLocks.length === 0) {
      locksContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✨</div>
          <p>No active file locks</p>
          <span class="empty-hint">When an agent claims a file with <code>crosstalk lock</code> or SDK, it appears here</span>
        </div>
      `;
      return;
    }

    const now = Date.now();
    locksContainer.innerHTML = displayLocks.map(lock => {
      const remainingSec = Math.max(0, Math.round(((lock.expiresAt || (now + 180000)) - now) / 1000));
      const channelTag = lock.channel || 'default';
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
            Held by <strong>${escapeHtml(lock.holderName || (lock.holder && lock.holder.name) || 'Peer Agent')}</strong>
          </div>
          <div class="lock-reason">
            "${escapeHtml(lock.reason || 'Active editing')}"
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
      if (activeFilter === 'current') return (m.channel || 'default') === currentScope || currentScope === '*';
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
      const channelTag = msg.channel || 'default';
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

  function renderSentinelLedger() {
    if (!sentinelLocksList) return;
    if (locks.length === 0) {
      sentinelLocksList.innerHTML = `
        <div style="padding: 16px; text-align: center; color: #10b981; font-weight: 500;">
          ✨ All files and workspaces are currently unlocked. Zero collision hazards.
        </div>
      `;
      return;
    }

    sentinelLocksList.innerHTML = locks.map(lock => {
      return `
        <div class="demo-ns-row">
          <span class="ns-tag">#${escapeHtml(lock.channel || 'default')}</span>
          <span class="ns-file">📄 ${escapeHtml(lock.file)}</span>
          <span class="ns-status locked">🔒 LOCKED by ${escapeHtml(lock.holderName || (lock.holder && lock.holder.name) || 'Peer')} ("${escapeHtml(lock.reason || '')}")</span>
        </div>
      `;
    }).join('');
  }

  function addMessage(msg) {
    messages.push(msg);
    if (messages.length > 250) messages.shift();
    renderMessages();
    fetchRealTelemetry();
  }

  function updateRecipientSelect() {
    const currentVal = composerRecipient.value;
    composerRecipient.innerHTML = '<option value="broadcast">📢 Broadcast to Channel</option>';
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
    const targetScope = composerTargetSession.value === '*' ? '*' : (currentScope === '*' ? 'default' : currentScope);

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

  btnManualLock.addEventListener('click', () => {
    const file = manualLockFile.value.trim();
    const reason = manualLockReason.value.trim() || 'Claimed by Mission Control Supervisor';
    const targetChan = manualLockSession.value || (currentScope === '*' ? 'default' : currentScope);
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
      channel: channel || (currentScope === '*' ? 'default' : currentScope),
      file
    }));
  };

  btnRefresh.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'query_state', channel: currentScope }));
    }
    fetchRealTelemetry();
  });

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
        renderTopology();
      }
    });
  });

  document.querySelectorAll('.agent-tier-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.agent-tier-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTier = btn.dataset.tier;
      renderAgents();
    });
  });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderMessages();
    });
  });

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

    knownChannels.add(sName);
    updateChannelDropdown();
    switchChannelScope(sName);

    addMessage({
      id: 'chan-created-' + Date.now(),
      type: 'system',
      channel: sName,
      content: `⚡ Channel #${sName} created. Ready for agents to connect with --channel ${sName}.`,
      timestamp: Date.now()
    });

    spawnSessionModal.style.display = 'none';
    newSessionName.value = '';
    newSessionPurpose.value = '';
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

      specCtx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      specCtx.lineWidth = 1;
      for (let y = 0; y < h; y += 20) {
        specCtx.beginPath();
        specCtx.moveTo(0, y);
        specCtx.lineTo(w, y);
        specCtx.stroke();
      }

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

    tones.push(15, 0, 15, 0);
    for (let i = 0; i < bytes.length; i++) {
      tones.push((bytes[i] >> 4) & 0x0f);
      tones.push(bytes[i] & 0x0f);
    }
    tones.push(0, 15);

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
        action: 'DIALECT_PING',
        sender: 'Mission Control',
        timestamp: Date.now()
      };
      const sig = encodeGibberlinkSignal(JSON.stringify(samplePayload));
      pushSignalToWaterfall(sig.payloadTones);
      playGibberlinkAudio(sig.frequencies, sig.symbolDurationMs);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'gibberlink_signal',
          channel: currentScope === '*' ? 'default' : currentScope,
          signal: sig
        }));
      }
    });
  }

  // =========================================================================
  // 6. REAL LIVE TOPOLOGY VISUALIZER
  // =========================================================================

  function renderTopology() {
    if (!topoCtx || !topologyCanvas) return;
    const w = topologyCanvas.width;
    const h = topologyCanvas.height;

    if (topoAnimFrame) cancelAnimationFrame(topoAnimFrame);

    let angle = 0;
    function draw() {
      topoCtx.fillStyle = '#06080d';
      topoCtx.fillRect(0, 0, w, h);

      const centerX = w / 2;
      const centerY = h / 2;

      // Draw concentric radar lines
      topoCtx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
      topoCtx.lineWidth = 1;
      [80, 160, 240].forEach(r => {
        topoCtx.beginPath();
        topoCtx.arc(centerX, centerY, r, 0, Math.PI * 2);
        topoCtx.stroke();
      });

      // Central Hub Server Node
      topoCtx.fillStyle = '#a855f7';
      topoCtx.shadowColor = '#a855f7';
      topoCtx.shadowBlur = 20;
      topoCtx.beginPath();
      topoCtx.arc(centerX, centerY, 22, 0, Math.PI * 2);
      topoCtx.fill();
      topoCtx.shadowBlur = 0;

      topoCtx.fillStyle = '#ffffff';
      topoCtx.font = 'bold 11px "JetBrains Mono"';
      topoCtx.textAlign = 'center';
      topoCtx.fillText('CrossTalk Hub (:4488)', centerX, centerY - 28);
      topoCtx.fillStyle = '#94a3b8';
      topoCtx.font = '9px "JetBrains Mono"';
      topoCtx.fillText(`${agents.length} active peer(s)`, centerX, centerY + 36);

      // Plot REAL connected agents orbiting the hub
      const realAgents = agents.filter(a => a.id !== 'cockpit-mission-control');
      const numAgents = realAgents.length;

      if (numAgents === 0) {
        topoCtx.fillStyle = '#64748b';
        topoCtx.font = 'italic 11px "JetBrains Mono"';
        topoCtx.fillText('Waiting for agents to connect...', centerX, centerY + 80);
      } else {
        const orbitRadius = 180;
        angle += 0.003;

        realAgents.forEach((agent, i) => {
          const aAngle = angle + (i * (Math.PI * 2 / numAgents));
          const ax = centerX + Math.cos(aAngle) * orbitRadius;
          const ay = centerY + Math.sin(aAngle) * orbitRadius;

          const hasLock = (agent.lockedFiles && agent.lockedFiles.length > 0) ||
                          locks.some(l => l.holderId === agent.id);

          // Connection line to hub
          topoCtx.strokeStyle = hasLock ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.25)';
          topoCtx.lineWidth = 1.5;
          topoCtx.beginPath();
          topoCtx.moveTo(centerX, centerY);
          topoCtx.lineTo(ax, ay);
          topoCtx.stroke();

          // Agent Node
          const nodeColor = hasLock ? '#f59e0b' : '#10b981';
          topoCtx.fillStyle = nodeColor;
          topoCtx.shadowColor = nodeColor;
          topoCtx.shadowBlur = 15;
          topoCtx.beginPath();
          topoCtx.arc(ax, ay, 14, 0, Math.PI * 2);
          topoCtx.fill();
          topoCtx.shadowBlur = 0;

          // Agent Label
          topoCtx.fillStyle = '#f1f5f9';
          topoCtx.font = 'bold 10px "JetBrains Mono"';
          topoCtx.fillText(agent.name, ax, ay - 18);

          topoCtx.fillStyle = '#38bdf8';
          topoCtx.font = '9px "JetBrains Mono"';
          topoCtx.fillText(`#${agent.channel || 'default'} · ${agent.environment || 'ide'}`, ax, ay + 24);
        });
      }

      topoAnimFrame = requestAnimationFrame(draw);
    }

    draw();
  }

  // =========================================================================
  // 7. UTILITY HELPERS
  // =========================================================================

  function getAvatarIcon(env, name = '') {
    const n = (name || '').toLowerCase();
    if (n.includes('claude')) return '🧠';
    if (n.includes('deepseek')) return '🔮';
    if (n.includes('gemini')) return '⚡';
    if (n.includes('grok')) return '🚀';
    if (n.includes('subby') || n.includes('builder')) return '💻';
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

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatUptime(sec) {
    if (!sec || sec < 60) return `${sec || 0}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
  }

  // Periodic polling of real telemetry every 3 seconds
  setInterval(fetchRealTelemetry, 3000);

  // Auto-refresh lock countdowns every 1 second
  setInterval(() => {
    if (locks.length > 0) renderLocks();
  }, 1000);

  // Initialize
  initSpectrogram();
  connect();
})();
