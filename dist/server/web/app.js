// CrossTalk Dashboard Client with Gibberlink Audio Signal & Spectrogram
(function() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  let ws = null;
  let currentChannel = 'default';
  let agents = [];
  let locks = [];
  let messages = [];
  let activeFilter = 'all';

  // Audio Context for optional Gibberlink audio demodulation / playback
  let audioCtx = null;
  let audioEnabled = false;

  // DOM Elements
  const netStatusLabel = document.getElementById('netStatusLabel');
  const statAgentCount = document.getElementById('statAgentCount');
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
  const btnRefresh = document.getElementById('btnRefresh');
  const btnManualLock = document.getElementById('btnManualLock');
  const manualLockFile = document.getElementById('manualLockFile');
  const manualLockReason = document.getElementById('manualLockReason');
  const audioToggleBadge = document.getElementById('audioToggleBadge');
  const audioIcon = document.getElementById('audioIcon');
  const audioToggleText = document.getElementById('audioToggleText');
  const spectrogramCanvas = document.getElementById('spectrogramCanvas');
  const btnEmitSignalDemo = document.getElementById('btnEmitSignalDemo');

  // Spectrogram Canvas State
  const specCtx = spectrogramCanvas ? spectrogramCanvas.getContext('2d') : null;
  let waterfallColumns = [];
  const MAX_HISTORY = 120;

  // Setup Spectrogram animation loop
  function initSpectrogram() {
    if (!specCtx) return;
    const w = spectrogramCanvas.width;
    const h = spectrogramCanvas.height;

    // Initialize with low baseline noise
    for (let x = 0; x < MAX_HISTORY; x++) {
      waterfallColumns.push(new Array(16).fill(0.05));
    }

    function renderLoop() {
      // Fade/Shift canvas to left (waterfall effect)
      specCtx.fillStyle = '#05070c';
      specCtx.fillRect(0, 0, w, h);

      // Draw grid lines
      specCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      specCtx.lineWidth = 1;
      for (let y = 0; y < h; y += 22) {
        specCtx.beginPath();
        specCtx.moveTo(0, y);
        specCtx.lineTo(w, y);
        specCtx.stroke();
      }

      // Draw active waterfall columns
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

      requestAnimationFrame(renderLoop);
    }

    renderLoop();
  }

  // Push tone frequencies into waterfall display
  function pushSignalToWaterfall(tones) {
    if (!tones || tones.length === 0) return;
    tones.forEach((toneIdx) => {
      const col = new Array(16).fill(0.03);
      const safeIdx = Math.max(0, Math.min(15, toneIdx));
      col[safeIdx] = 0.95; // High intensity burst
      waterfallColumns.push(col);
      if (waterfallColumns.length > MAX_HISTORY) {
        waterfallColumns.shift();
      }
    });
  }

  // Play acoustic Gibberlink tones if enabled
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

      // Envelope to avoid popping
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

  // Audio Toggle
  audioToggleBadge.addEventListener('click', () => {
    audioEnabled = !audioEnabled;
    if (audioEnabled) {
      audioIcon.textContent = '🔊';
      audioToggleText.textContent = 'Audio: ON';
      audioToggleBadge.style.borderColor = 'var(--accent-emerald)';
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      audioCtx.resume();
    } else {
      audioIcon.textContent = '🔇';
      audioToggleText.textContent = 'Audio: Muted';
      audioToggleBadge.style.borderColor = 'var(--border-subtle)';
    }
  });

  // Client-side quick Gibberlink FSK encoder for demo
  function encodeGibberlinkSignal(text) {
    const bytes = new TextEncoder().encode(text);
    const tones = [];
    const baseHz = 1875;
    const stepHz = 93.75;

    // Sync preamble
    tones.push(15, 0, 15, 0);

    for (let i = 0; i < bytes.length; i++) {
      tones.push((bytes[i] >> 4) & 0x0f);
      tones.push(bytes[i] & 0x0f);
    }

    // Sync postamble
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

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      netStatusLabel.textContent = 'CONNECTED TO MESH';
      netStatusLabel.style.color = '#10b981';

      ws.send(JSON.stringify({
        type: 'register',
        channel: currentChannel,
        agent: {
          id: 'dashboard-human',
          name: 'Human Operator',
          role: 'supervisor',
          environment: 'web',
          currentTask: 'Monitoring multi-agent mesh & signal stream',
          gibberlinkCapable: true
        }
      }));
    };

    ws.onclose = () => {
      netStatusLabel.textContent = 'DISCONNECTED (RETRYING...)';
      netStatusLabel.style.color = '#f43f5e';
      setTimeout(connect, 2000);
    };

    ws.onerror = (err) => {
      console.error('WebSocket Error:', err);
    };

    ws.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        handleServerPacket(packet);
      } catch (err) {
        console.error('Error parsing packet:', err);
      }
    };
  }

  function handleServerPacket(packet) {
    switch (packet.type) {
      case 'registered':
      case 'state_snapshot': {
        const mesh = packet.mesh || packet;
        agents = (mesh.agents || []).filter(a => a.id !== 'dashboard-human');
        locks = mesh.locks || [];
        messages = mesh.recentMessages || [];
        renderAll();
        break;
      }
      case 'agent_joined': {
        if (packet.agent.id !== 'dashboard-human') {
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
        const existingIdx = locks.findIndex(l => l.file === packet.lock.file);
        if (existingIdx >= 0) locks[existingIdx] = packet.lock;
        else locks.push(packet.lock);
        renderLocks();
        break;
      }
      case 'lock_released': {
        locks = locks.filter(l => l.file !== packet.file);
        renderLocks();
        break;
      }
      case 'lock_denied': {
        addMessage({
          id: 'denied-' + Date.now(),
          type: 'system',
          content: `⚠️ Lock contention: File "${packet.file}" is currently locked by ${packet.holder.name} ("${packet.reason}").`,
          timestamp: Date.now()
        });
        break;
      }
      case 'lock_conflict_warning': {
        addMessage({
          id: 'warn-' + Date.now(),
          type: 'system',
          content: `🚨 Conflict Warning: Agent ${packet.requester.name} requested "${packet.file}" held by ${packet.holder.name} (Reason: ${packet.reason})`,
          timestamp: Date.now()
        });
        break;
      }
      case 'gibberlink_signal': {
        // Trigger Spectrogram visualization and optional Web Audio
        const sig = packet.signal;
        if (sig) {
          pushSignalToWaterfall(sig.payloadTones || []);
          playGibberlinkAudio(sig.frequencies, sig.symbolDurationMs);
        }
        addMessage(packet.message);
        break;
      }
      case 'broadcast':
      case 'direct_message': {
        addMessage(packet.message);
        break;
      }
    }
  }

  function addMessage(msg) {
    messages.push(msg);
    if (messages.length > 200) messages.shift();
    renderMessages();
    messageFeed.scrollTop = messageFeed.scrollHeight;
  }

  function renderAll() {
    renderAgents();
    renderLocks();
    renderMessages();
    updateRecipientSelect();
    messageFeed.scrollTop = messageFeed.scrollHeight;
  }

  function renderAgents() {
    statAgentCount.textContent = agents.length;
    agentCountBadge.textContent = `${agents.length} Online`;

    if (agents.length === 0) {
      agentList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🛰️</div>
          <p>Listening for agents on the mesh...</p>
          <span class="empty-hint">Start an agent with MCP, CLI, or SDK to see it appear here</span>
        </div>
      `;
      return;
    }

    agentList.innerHTML = agents.map(agent => {
      const statusClass = `status-${agent.status || 'idle'}`;
      const env = agent.environment || 'bot';
      const role = agent.role || 'agent';
      const hasLocks = agent.lockedFiles && agent.lockedFiles.length > 0;

      return `
        <div class="agent-card ${statusClass}">
          <div class="agent-card-header">
            <div class="agent-name-group">
              <div class="agent-avatar">${getAvatarIcon(env)}</div>
              <div>
                <span class="agent-name">${escapeHtml(agent.name)}</span>
                <span class="env-tag">${escapeHtml(role)} · ${env}</span>
              </div>
            </div>
            ${agent.gibberlinkCapable ? `<span class="signal-chip" title="Gibberlink Signal Capable">GLINK</span>` : ''}
          </div>
          <div class="agent-task">
            <strong>Task:</strong> ${escapeHtml(agent.currentTask || 'Idle')}
          </div>
          <div class="agent-meta-row">
            <span>Status: <strong style="color: ${getStatusColor(agent.status)}">${agent.status.toUpperCase()}</strong></span>
            ${hasLocks ? `<span class="locked-badge">🔒 ${agent.lockedFiles.length} file(s) held</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderLocks() {
    statLockCount.textContent = locks.length;
    lockCountBadge.textContent = `${locks.length} Claims`;

    if (locks.length === 0) {
      locksContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">✨</div>
          <p>No active file locks</p>
          <span class="empty-hint">Files claimed by agents will appear with real-time countdowns</span>
        </div>
      `;
      return;
    }

    const now = Date.now();
    locksContainer.innerHTML = locks.map(lock => {
      const remainingSec = Math.max(0, Math.round((lock.expiresAt - now) / 1000));
      return `
        <div class="lock-card">
          <div class="lock-card-header">
            <div class="lock-file-path">
              <span>📄</span>
              <span>${escapeHtml(lock.file)}</span>
            </div>
          </div>
          <div class="lock-holder">
            Held by <strong>${escapeHtml(lock.holderName)}</strong>
          </div>
          <div class="lock-reason">
            "${escapeHtml(lock.reason || 'Editing')}"
          </div>
          <div class="lock-footer">
            <div class="lock-timer">Expires in: ⏱️ ${remainingSec}s</div>
            <button class="btn-unlock" onclick="window.unlockFile('${escapeHtml(lock.file)}')">Release</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderMessages() {
    const filtered = messages.filter(m => {
      if (activeFilter === 'all') return true;
      if (activeFilter === 'broadcast') return m.type === 'broadcast';
      if (activeFilter === 'gibberlink_signal') return m.type === 'gibberlink_signal';
      if (activeFilter === 'dm') return m.type === 'direct_message';
      if (activeFilter === 'system') return m.type === 'system';
      return true;
    });

    if (filtered.length === 0) {
      messageFeed.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">💭</div>
          <p>No messages in stream yet</p>
          <span class="empty-hint">Broadcast messages, Gibberlink signal bursts, and conflict warnings will stream here</span>
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
      const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const sig = msg.gibberlinkSignal;

      return `
        <div class="message-item ${msg.type}">
          <div class="message-header">
            <div class="sender-group">
              <span class="sender-name">${escapeHtml(senderName)}</span>
              ${!isSystem ? `<span class="sender-role">${escapeHtml(senderRole)}</span>` : ''}
              ${isDm ? `<span class="env-tag" style="color: var(--accent-purple)">DM</span>` : ''}
              ${isSignal ? `<span class="signal-chip">⚡ GIBBERLINK SIGNAL</span>` : ''}
            </div>
            <span class="message-time">${timeStr}</span>
          </div>
          <div class="message-content">${escapeHtml(msg.content)}</div>
          ${isSignal && sig ? `
            <div class="signal-tones-preview">
              <span>📡 ${sig.frequencies.length} FSK tones (${sig.totalDurationMs}ms)</span>
              <span>Band: ${sig.baseFrequencyHz}Hz · 16-FSK</span>
              <button class="btn-xs-signal" onclick="window.replaySignal('${msg.id}')">▶ Replay</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  function updateRecipientSelect() {
    const currentVal = composerRecipient.value;
    composerRecipient.innerHTML = '<option value="broadcast">📢 Broadcast to All Agents</option>';
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

  // Send Message from Dashboard
  function sendMessage() {
    const text = composerInput.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

    const recipient = composerRecipient.value;
    const format = composerFormat.value;

    if (format === 'gibberlink') {
      const sig = encodeGibberlinkSignal(text);
      ws.send(JSON.stringify({
        type: 'gibberlink_signal',
        signal: sig,
        to: recipient === 'broadcast' ? undefined : recipient
      }));
    } else {
      if (recipient === 'broadcast') {
        ws.send(JSON.stringify({
          type: 'broadcast',
          content: text
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'direct_message',
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

  // Test Signal Burst Button
  btnEmitSignalDemo.addEventListener('click', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const samplePayload = {
      action: 'CLAIM_LOCK',
      file: 'src/components/Navigation.tsx',
      reason: 'Updating navigation links via Gibberlink signal'
    };
    const sig = encodeGibberlinkSignal(JSON.stringify(samplePayload));
    ws.send(JSON.stringify({
      type: 'gibberlink_signal',
      signal: sig
    }));
  });

  // Replay Signal Helper
  window.replaySignal = function(msgId) {
    const msg = messages.find(m => m.id === msgId);
    if (msg && msg.gibberlinkSignal) {
      pushSignalToWaterfall(msg.gibberlinkSignal.payloadTones);
      playGibberlinkAudio(msg.gibberlinkSignal.frequencies, msg.gibberlinkSignal.symbolDurationMs);
    }
  };

  // Filter Buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderMessages();
    });
  });

  // Manual Lock Tester
  btnManualLock.addEventListener('click', () => {
    const file = manualLockFile.value.trim();
    const reason = manualLockReason.value.trim() || 'Claimed by Human Operator';
    if (!file || !ws) return;

    ws.send(JSON.stringify({
      type: 'lock_acquire',
      file,
      reason,
      ttlSeconds: 180
    }));

    manualLockFile.value = '';
    manualLockReason.value = '';
  });

  window.unlockFile = function(file) {
    if (!ws) return;
    ws.send(JSON.stringify({
      type: 'lock_release',
      file
    }));
  };

  btnRefresh.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'query_state' }));
    }
  });

  setInterval(() => {
    if (locks.length > 0) renderLocks();
  }, 1000);

  function getAvatarIcon(env) {
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

  initSpectrogram();
  connect();
})();
