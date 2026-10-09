/**
 * CrossTalk Portal & Telemetry Hub
 * Handles Cal.com-style interactive agent pairing studio across branches/subnets,
 * WebSocket copy/ping, XDialect compiler playground, bilingual translation,
 * and live bounded ring-buffer synchronization.
 */

let currentLanguage = 'en';
let currentPairingOption = 'relay';
let generatedSessionCode = '';

// Toast notification helper
function showToast(message, isSuccess = true) {
  const toast = document.getElementById('toastNotification');
  const toastMsg = document.getElementById('toastMsg');
  const toastIcon = document.getElementById('toastIcon');

  if (!toast) return;

  toastMsg.textContent = message;
  toastIcon.textContent = isSuccess ? '✔' : '✖';
  toastIcon.style.color = isSuccess ? 'var(--cal-emerald, #10b981)' : 'var(--cal-rose, #f43f5e)';

  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2800);
}

// Global copyText utility
window.copyText = function(text, successMsg = 'Copied to clipboard!') {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMsg, true);
    }).catch(() => {
      fallbackCopy(text, successMsg);
    });
  } else {
    fallbackCopy(text, successMsg);
  }
};

function fallbackCopy(text, successMsg) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast(successMsg, true);
  } catch (e) {
    showToast('Failed to copy', false);
  }
  document.body.removeChild(ta);
}

// Copy Code from Tab
window.copyTabCode = function(codeElementId) {
  const el = document.getElementById(codeElementId);
  if (el) {
    window.copyText(el.innerText || el.textContent, 'Code snippet copied!');
  }
};

// Set Language Toggle (en / zh)
window.setLanguage = function(lang) {
  currentLanguage = lang;
  const btnEn = document.getElementById('langBtnEn');
  const btnZh = document.getElementById('langBtnZh');
  if (btnEn && btnZh) {
    if (lang === 'zh') {
      btnZh.classList.add('active');
      btnEn.classList.remove('active');
    } else {
      btnEn.classList.add('active');
      btnZh.classList.remove('active');
    }
  }
  translatePlayground();
};

// Set XDialect Playground text
window.setPlayground = function(dialectSnippet) {
  const inputEl = document.getElementById('dialectInput');
  if (inputEl) {
    inputEl.value = dialectSnippet;
    translatePlayground();
  }
};

// Socket Copy & Live Ping Manager
function initSocketControls() {
  const input = document.getElementById('socketAddressInput');
  const btnCopy = document.getElementById('btnCopySocket');
  const btnPing = document.getElementById('btnPingSocket');
  const dot = document.getElementById('socketPingDot');
  const text = document.getElementById('socketPingText');

  if (!input || !btnCopy || !btnPing) return;

  btnCopy.addEventListener('click', () => {
    const addr = input.value.trim();
    if (!addr) {
      showToast('Socket address is empty', false);
      return;
    }
    window.copyText(addr, `Copied endpoint: ${addr}`);
    
    const span = btnCopy.querySelector('span') || btnCopy;
    const originalText = span.textContent;
    span.textContent = 'Copied!';
    setTimeout(() => {
      span.textContent = originalText;
    }, 1500);
  });

  btnPing.addEventListener('click', () => {
    testPingEndpoint(input.value.trim());
  });

  setTimeout(() => {
    testPingEndpoint(input.value.trim(), true);
  }, 400);

  function testPingEndpoint(targetUrl, isInitial = false) {
    if (!targetUrl) {
      showToast('Please enter a valid socket address', false);
      return;
    }

    if (dot) dot.className = 'endpoint-dot dot-testing';
    if (text) text.textContent = 'Pinging...';

    const t0 = performance.now();
    let socket;
    let didFinish = false;

    const timer = setTimeout(() => {
      if (didFinish) return;
      didFinish = true;
      if (socket) {
        try { socket.close(); } catch (_) {}
      }
      setPingResult(false, 'Timeout (>3000ms)', null, isInitial);
    }, 3000);

    try {
      socket = new WebSocket(targetUrl);
      socket.onopen = () => {
        if (didFinish) return;
        didFinish = true;
        clearTimeout(timer);
        const latency = Math.round(performance.now() - t0);
        socket.close();
        setPingResult(true, `Connected (${latency}ms)`, latency, isInitial);
      };
      socket.onerror = () => {
        if (didFinish) return;
        didFinish = true;
        clearTimeout(timer);
        setPingResult(false, 'Unreachable', null, isInitial);
      };
    } catch (e) {
      clearTimeout(timer);
      setPingResult(false, 'Invalid URL', null, isInitial);
    }
  }

  function setPingResult(isOk, statusMsg, latency, isInitial) {
    if (dot) {
      dot.className = isOk ? 'endpoint-dot dot-online' : 'endpoint-dot dot-offline';
    }
    if (text) {
      text.textContent = isOk ? (latency !== null ? `Online (${latency}ms)` : 'Online') : statusMsg;
    }
    if (!isInitial) {
      showToast(isOk ? `Ping successful (${latency}ms)` : `Ping failed: ${statusMsg}`, isOk);
    }
  }
}

// Cal.com Interactive Agent Pairing Studio
function generateRandomCode(branch) {
  const chars = '0123456789ABCDEF';
  let rand = '';
  for (let i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  const branchTag = (branch || 'MAIN').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8).toUpperCase() || 'MAIN';
  return `XT-${rand}-${branchTag}`;
}

function updatePairingStudio() {
  const myBranchInput = document.getElementById('inputMyBranch');
  const peerBranchInput = document.getElementById('inputPeerBranch');
  const subnetSelect = document.getElementById('selectSubnetLock');
  const customSubnetInput = document.getElementById('inputCustomSubnet');

  const myBranch = (myBranchInput ? myBranchInput.value.trim() : '') || 'main';
  const peerBranch = (peerBranchInput ? peerBranchInput.value.trim() : '') || 'feature-ui';
  let subnet = subnetSelect ? subnetSelect.value : 'any';
  if (subnet === 'custom' && customSubnetInput) {
    customSubnetInput.classList.remove('hidden');
    subnet = customSubnetInput.value.trim() || '192.168.1.0/24';
  } else if (customSubnetInput) {
    customSubnetInput.classList.add('hidden');
  }

  const branchUpper = myBranch.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8).toUpperCase() || 'MAIN';
  if (!generatedSessionCode || !generatedSessionCode.endsWith(branchUpper)) {
    generatedSessionCode = generateRandomCode(myBranch);
  }

  const host = window.location.host || 'localhost:4488';
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  const codeEl = document.getElementById('sessionCodeDisplay');
  const promptEl = document.getElementById('agentPromptSnippet');
  const cliEl = document.getElementById('agentCliSnippet');
  const webEl = document.getElementById('agentWebSnippet');

  const explainerIcon = document.getElementById('explainerIcon');
  const explainerTitle = document.getElementById('explainerTitle');
  const explainerText = document.getElementById('explainerText');

  if (codeEl) codeEl.textContent = generatedSessionCode;

  if (currentPairingOption === 'relay') {
    if (explainerIcon) explainerIcon.textContent = '🏢';
    if (explainerTitle) explainerTitle.textContent = 'Option 1: Central Hosted Relay (Zero-Config · Recommended)';
    if (explainerText) explainerText.textContent = 'Connects both agents through this website relay. 100% reliable across separate Wi-Fi networks, home routers, and corporate NATs. No port forwarding required.';

    if (promptEl) promptEl.textContent = `Join CrossTalk session ${generatedSessionCode} on branch ${peerBranch}`;
    if (cliEl) cliEl.textContent = `crosstalk join ${generatedSessionCode} --branch ${peerBranch}`;
    if (webEl) webEl.textContent = `${protocol}//${host}/?room=${generatedSessionCode}&branch=${myBranch}`;
  } else if (currentPairingOption === 'mesh') {
    const topic = `mesh://open/repo-${myBranch.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase()}`;
    if (explainerIcon) explainerIcon.textContent = '🌐';
    if (explainerTitle) explainerTitle.textContent = 'Option 2: Open Mesh (Discovery Topic Rendezvous)';
    if (explainerText) explainerText.textContent = `Broadcasts a discovery signal on the open topic "${topic}". Peer agents discover each other directly without a central server. Note: direct P2P rendezvous has higher failure rates across symmetric NATs without a relay.`;

    if (promptEl) promptEl.textContent = `Connect to open mesh channel 'team-${myBranch.toLowerCase()}' on branch ${peerBranch}`;
    if (cliEl) cliEl.textContent = `crosstalk up team-${myBranch.toLowerCase()} --mode mesh --branch ${peerBranch}`;
    if (webEl) webEl.textContent = `${topic}`;
  } else if (currentPairingOption === 'direct') {
    const socketAddr = `${wsProtocol}//${host}`;
    if (explainerIcon) explainerIcon.textContent = '🔒';
    if (explainerTitle) explainerTitle.textContent = `Option 3: Direct Computer-to-Computer (Subnet Lock: ${subnet})`;
    if (explainerText) explainerText.textContent = `Direct TCP socket between computers. Hardened by SubnetGuard: only IP addresses within "${subnet}" are accepted. Packets from external networks or unintended subnets are immediately rejected (code 4003).`;

    if (promptEl) promptEl.textContent = `Connect directly to peer ${socketAddr} on branch ${peerBranch} with subnet lock ${subnet}`;
    if (cliEl) cliEl.textContent = `crosstalk join ${socketAddr} --branch ${peerBranch} --subnet ${subnet}`;
    if (webEl) webEl.textContent = `${socketAddr} (Subnet: ${subnet})`;
  }
}

window.copyGeneratedPrompt = function() {
  const el = document.getElementById('agentPromptSnippet');
  if (el) window.copyText(el.textContent, 'Agent prompt copied! Paste into your friend\'s IDE chat.');
};

window.copyGeneratedCli = function() {
  const el = document.getElementById('agentCliSnippet');
  if (el) window.copyText(el.textContent, 'CLI command copied!');
};

window.copyGeneratedWebLink = function() {
  const el = document.getElementById('agentWebSnippet');
  if (el) window.copyText(el.textContent, 'Link copied!');
};

function initPairingStudio() {
  const segBtns = document.querySelectorAll('.cal-segmented-control .seg-btn');
  segBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      segBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPairingOption = btn.getAttribute('data-option') || 'relay';
      updatePairingStudio();
    });
  });

  ['inputMyBranch', 'inputPeerBranch', 'selectSubnetLock', 'inputCustomSubnet'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updatePairingStudio);
      el.addEventListener('change', updatePairingStudio);
    }
  });

  updatePairingStudio();
}

// XDialect Token Map
const DIALECT_MAP = {
  actions: {
    '!LCK': { en: 'I am claiming lock on', zh: '申请独占锁定文件', color: '#10b981' },
    '!REL': { en: 'I have finished and released', zh: '已完成并释放文件锁定', color: '#3b82f6' },
    '!WARN': { en: 'Conflict alert on', zh: '冲突风险警报', color: '#f59e0b' },
    '!BCST': { en: 'Broadcasting announcement', zh: '广播状态通告', color: '#a855f7' },
    '!PASS': { en: 'Handoff task to peer agent', zh: '工作移交下游智能体', color: '#06b6d4' }
  },
  intents: {
    '#REF': { en: 'refactoring', zh: '重构代码' },
    '#FEAT': { en: 'implementing new feature', zh: '开发新功能' },
    '#FIX': { en: 'bug fixing', zh: '修复缺陷' },
    '#TEST': { en: 'running test suite', zh: '执行测试用例' },
    '#MIG': { en: 'migrating schema', zh: '数据结构迁移' },
    '#DOC': { en: 'updating documentation', zh: '编写文档注释' }
  },
  flows: {
    '&WAIT': { en: 'Hang on for me to finish before touching it.', zh: '请稍候，等我修改完成再操作。' },
    '&ACK': { en: 'Understood, holding off.', zh: '已确认，暂停修改并保持等待。' },
    '&DONE': { en: 'Task completed.', zh: '操作已完成。' },
    '&PROCEED': { en: 'Clear for peer agents to proceed.', zh: '其他智能体现在可以继续推进。' },
    '&URGENT': { en: 'High priority request.', zh: '高优先级紧急请求。' }
  }
};

function translatePlayground() {
  const inputEl = document.getElementById('dialectInput');
  const outputEl = document.getElementById('humanTranslationOutput');
  const meterEl = document.getElementById('wireSizeMeter');

  if (!inputEl || !outputEl) return;

  const raw = inputEl.value.trim();
  if (!raw) {
    outputEl.innerHTML = '<span style="color:var(--cal-text-dim)">Type an XDialect shorthand or English/Chinese command...</span>';
    if (meterEl) meterEl.textContent = '0 Wire Bytes';
    return;
  }

  if (raw.startsWith('!') || raw.includes('#') || raw.includes('@') || raw.includes('&')) {
    renderShorthandToLanguage(raw, outputEl, meterEl, currentLanguage);
  } else {
    renderNaturalToShorthand(raw, outputEl, meterEl);
  }
}

function renderShorthandToLanguage(raw, outputEl, meterEl, lang = 'en') {
  const tokens = raw.match(/"[^"]*"|[^\s]+/g) || [];
  let action = '';
  let file = '';
  let intent = '';
  let reason = '';
  let ttl = '';
  let flow = '';
  let badgesHtml = '<div class="dialect-token-stream">';

  for (const t of tokens) {
    if (t.startsWith('!')) {
      const match = DIALECT_MAP.actions[t];
      action = match ? (lang === 'zh' ? match.zh : match.en) : `Action (${t})`;
      badgesHtml += `<span class="dialect-chip action" style="border-color:${match?.color || '#10b981'}">${t}</span>`;
    } else if (t.startsWith('@')) {
      file = t.slice(1);
      badgesHtml += `<span class="dialect-chip file">${t}</span>`;
    } else if (t.startsWith('#')) {
      const match = DIALECT_MAP.intents[t];
      intent = match ? (lang === 'zh' ? match.zh : match.en) : t.slice(1);
      badgesHtml += `<span class="dialect-chip intent">${t}</span>`;
    } else if (t.startsWith('~')) {
      ttl = t.slice(1) + (lang === 'zh' ? '秒' : 's');
      badgesHtml += `<span class="dialect-chip ttl">${t}</span>`;
    } else if (t.startsWith('&')) {
      const match = DIALECT_MAP.flows[t];
      flow = match ? (lang === 'zh' ? match.zh : match.en) : t.slice(1);
      badgesHtml += `<span class="dialect-chip flow">${t}</span>`;
    } else if (t.startsWith('"') && t.endsWith('"')) {
      reason = t.slice(1, -1);
      badgesHtml += `<span class="dialect-chip reason">${t}</span>`;
    }
  }
  badgesHtml += '</div>';

  let sentence = '';
  if (lang === 'zh') {
    if (action) sentence += action;
    if (file) sentence += ` "${file}"`;
    if (intent) sentence += `，进行${intent}`;
    if (reason) sentence += `（${reason}）`;
    if (ttl) sentence += `。（锁定 ${ttl}）`;
    if (flow) sentence += ` ${flow}`;
  } else {
    if (action) sentence += action;
    if (file) sentence += ` "${file}"`;
    if (intent) sentence += `, ${intent}`;
    if (reason) sentence += ` (${reason})`;
    if (ttl) sentence += `. (Holding lock for ${ttl})`;
    if (flow) sentence += ` ${flow}`;
  }
  if (!sentence) sentence = raw;

  const wireBytes = 10 + (file ? file.length : 0) + (reason ? Math.min(reason.length, 16) : 0);

  if (meterEl) {
    meterEl.innerHTML = `<strong>${wireBytes} Wire Bytes</strong>`;
  }

  outputEl.innerHTML = `
    ${badgesHtml}
    <div class="human-sentence">"${sentence.trim()}"</div>
  `;
}

function renderNaturalToShorthand(raw, outputEl, meterEl) {
  let action = '!LCK';
  let intent = '#REF';
  let flow = '&WAIT';
  let file = 'src/index.ts';

  const lower = raw.toLowerCase();
  if (lower.includes('release') || lower.includes('done') || lower.includes('unlock') ||
      raw.includes('释放') || raw.includes('解锁') || raw.includes('完成')) {
    action = '!REL';
    flow = '&DONE &PROCEED';
  } else if (lower.includes('warn') || lower.includes('conflict') || raw.includes('冲突') || raw.includes('警告')) {
    action = '!WARN';
  } else if (lower.includes('broadcast') || lower.includes('announce') || raw.includes('广播')) {
    action = '!BCST';
  }

  if (lower.includes('feat') || lower.includes('feature') || raw.includes('新功能') || raw.includes('开发')) intent = '#FEAT';
  if (lower.includes('fix') || lower.includes('bug') || raw.includes('修复') || raw.includes('缺陷')) intent = '#FIX';
  if (lower.includes('test') || raw.includes('测试')) intent = '#TEST';

  const fileMatch = raw.match(/([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)/);
  if (fileMatch) {
    file = fileMatch[1];
  }

  const generated = `${action} @${file} ${action === '!REL' ? '' : intent} "${raw.slice(0, 24)}" ${flow}`.replace(/\s+/g, ' ');
  const wireBytes = 10 + file.length + 12;

  if (meterEl) {
    meterEl.innerHTML = `<strong>${wireBytes} Wire Bytes</strong>`;
  }

  outputEl.innerHTML = `
    <div class="human-sentence" style="color:var(--cal-emerald); font-family:var(--font-mono); font-size:0.95rem;">
      ${generated}
    </div>
  `;
}

// Live Mesh Stats & Context Ring Buffer Polling
async function fetchMeshStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const data = await res.json();

    const elTotal = document.getElementById('metricTotalMessages');
    const elPeers = document.getElementById('metricActivePeers');
    const elLocks = document.getElementById('metricActiveLocks');
    const elBuffer = document.getElementById('metricBufferLimit');
    const elStorageBadge = document.getElementById('metricStorageBadge');

    if (elTotal) {
      elTotal.textContent = (data.totalMessagesRouted || 0).toLocaleString();
    }
    if (elPeers) elPeers.textContent = data.activePeers || 1;
    if (elLocks) elLocks.textContent = data.activeLocks || 0;
    if (elBuffer) elBuffer.textContent = `${data.recentHistoryCount || 0} / 100`;
    if (elStorageBadge) {
      if (data.storageMode === 'mongodb') {
        elStorageBadge.textContent = 'MongoDB Capped Ring';
      } else {
        elStorageBadge.textContent = 'Bounded Ring (<25KB)';
      }
    }
  } catch (_) {}
}

window.fetchRecentHistory = async function() {
  const feedList = document.getElementById('recentFeedList');
  const countBadge = document.getElementById('feedCountBadge');
  if (!feedList) return;

  try {
    const res = await fetch('/api/history?limit=100');
    if (!res.ok) return;
    const data = await res.json();
    const messages = data.messages || [];

    if (countBadge) {
      countBadge.textContent = `${messages.length} / 100 in Ring`;
    }

    if (messages.length === 0) {
      feedList.innerHTML = '<div class="feed-empty-item">Mesh channel is quiet. No recent message events.</div>';
      return;
    }

    feedList.innerHTML = messages.slice().reverse().map(m => {
      const timeStr = new Date(m.timestamp).toLocaleTimeString();
      const fromName = m.from ? m.from.name : 'Mesh System';
      const fromRole = m.from ? m.from.role : 'system';
      const isLock = m.content.includes('!LCK') || m.content.includes('locked');
      const isRel = m.content.includes('!REL') || m.content.includes('released');

      let chip = '<span class="cal-chip">EVENT</span>';
      if (isLock) chip = '<span class="cal-chip chip-lock">LOCK CLAIM</span>';
      if (isRel) chip = '<span class="cal-chip chip-rel">RELEASE</span>';

      return `
        <div class="feed-event-row">
          <div class="feed-row-top">
            <div class="feed-agent-info">
              <span class="feed-agent-name">${fromName}</span>
              <span class="feed-agent-role">${fromRole}</span>
              ${chip}
            </div>
            <span class="feed-time">${timeStr}</span>
          </div>
          <div class="feed-content-line"><code>${escapeHtml(m.content)}</code></div>
        </div>
      `;
    }).join('');
  } catch (_) {}
};

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Tab Switching Component
function initGuideTabs() {
  const tabs = document.querySelectorAll('.guide-tab-btn');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-tab');
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPane = document.getElementById(targetId);
      if (targetPane) {
        targetPane.classList.add('active');
      }
    });
  });
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initSocketControls();
  initPairingStudio();
  initGuideTabs();

  const dialectInput = document.getElementById('dialectInput');
  if (dialectInput) {
    dialectInput.addEventListener('input', translatePlayground);
    translatePlayground();
  }

  fetchMeshStats();
  window.fetchRecentHistory();

  setInterval(fetchMeshStats, 3000);
  setInterval(window.fetchRecentHistory, 5000);
});
