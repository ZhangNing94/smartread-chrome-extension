// SmartRead - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  // --- Load saved settings ---
  loadSettings();
  loadUsage();

  // --- Tab switching ---
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).style.display = 'block';
    });
  });

  // --- Toggle API Key visibility ---
  document.getElementById('toggleApiKey').addEventListener('click', () => {
    const input = document.getElementById('apiKey');
    if (input.type === 'password') {
      input.type = 'text';
    } else {
      input.type = 'password';
    }
  });

  // --- Save settings ---
  document.getElementById('saveBtn').addEventListener('click', () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    const defaultMode = document.getElementById('defaultMode').value;

    if (!apiKey) {
      showMsg('请输入 API Key', 'error');
      return;
    }

    if (!apiKey.startsWith('sk-')) {
      showMsg('API Key 格式错误，应以 sk- 开头', 'error');
      return;
    }

    chrome.storage.sync.set({
      apiKey: apiKey,
      defaultMode: defaultMode
    }, () => {
      showMsg('✅ 设置已保存', 'success');
    });
  });

  // --- Reset usage ---
  document.getElementById('usageCount').addEventListener('dblclick', () => {
    chrome.storage.local.set({ usageCount: 0, lastResetDate: '' }, () => {
      loadUsage();
      showMsg('✅ 用量已重置', 'success');
    });
  });
});

// --- Load settings ---
function loadSettings() {
  chrome.storage.sync.get(['apiKey', 'defaultMode'], (result) => {
    if (result.apiKey) {
      document.getElementById('apiKey').value = result.apiKey;
    }
    if (result.defaultMode) {
      document.getElementById('defaultMode').value = result.defaultMode;
    }
  });
}

// --- Load usage stats ---
function loadUsage() {
  chrome.storage.local.get(['usageCount', 'lastResetDate'], (result) => {
    const today = new Date().toDateString();
    const isToday = result.lastResetDate === today;
    const count = isToday ? (result.usageCount || 0) : 0;
    const remaining = Math.max(0, 10 - count);

    document.getElementById('usageCount').textContent = count;
    document.getElementById('usageRemaining').textContent = remaining;
    document.getElementById('progressFill').style.width = `${(count / 10) * 100}%`;
  });
}

// --- Show message ---
function showMsg(text, type) {
  const msgEl = document.getElementById('saveMsg');
  msgEl.textContent = text;
  msgEl.className = `save-msg ${type}`;
  setTimeout(() => {
    msgEl.textContent = '';
    msgEl.className = 'save-msg';
  }, 3000);
}