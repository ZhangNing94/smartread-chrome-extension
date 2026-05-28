// SmartRead — Popup UI with License integration

function encodeApiKey(key) { try { return btoa(key); } catch (e) { return ''; } }
function decodeApiKey(encoded) { try { return atob(encoded); } catch (e) { return ''; } }
function showMsg(id, text, isError) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'save-msg ' + (isError ? 'error' : 'success');
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

let lm = null;
let usageRemainingEl, usageCountEl, progressFillEl;

document.addEventListener('DOMContentLoaded', async () => {
  usageRemainingEl = document.getElementById('usageRemaining');
  usageCountEl = document.getElementById('usageCount');
  progressFillEl = document.getElementById('progressFill');

  // Init LicenseManager
  if (window.LicenseManager) {
    lm = new LicenseManager(window.LICENSE_CONFIG);
  }

  await loadSettings();
  await loadLicenseStatus();

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      document.getElementById('tab-' + tab.dataset.tab).style.display = '';
    });
  });

  // Save settings
  document.getElementById('saveBtn').addEventListener('click', saveSettings);

  // Toggle API key visibility
  document.getElementById('toggleApiKey').addEventListener('click', () => {
    const el = document.getElementById('apiKey');
    el.type = el.type === 'password' ? 'text' : 'password';
    document.getElementById('toggleApiKey').textContent = el.type === 'password' ? '👁️' : '🙈';
  });

  // Activate License
  const activateBtn = document.getElementById('activateBtn');
  if (activateBtn) {
    activateBtn.addEventListener('click', activateLicense);
  }

  // Dev: double-click remaining to reset trial
  if (usageRemainingEl) {
    usageRemainingEl.addEventListener('dblclick', async () => {
      if (lm) { await lm.resetTrial(); }
      await loadLicenseStatus();
      showMsg('licenseMsg', '🔄 试用已重置（开发模式）', false);
    });
  }
});

async function loadSettings() {
  const { apiKey, defaultMode } = await chrome.storage.sync.get(['apiKey', 'defaultMode']);
  if (apiKey) {
    document.getElementById('apiKey').value = decodeApiKey(apiKey);
  }
  if (defaultMode) {
    document.getElementById('defaultMode').value = defaultMode;
  }
}

async function saveSettings() {
  const key = document.getElementById('apiKey').value.trim();
  if (key && !key.startsWith('sk-')) {
    showMsg('saveMsg', '❌ API Key 必须以 sk- 开头', true);
    return;
  }

  const defaultMode = document.getElementById('defaultMode').value;
  await chrome.storage.sync.set({
    apiKey: key ? encodeApiKey(key) : '',
    defaultMode
  });
  showMsg('saveMsg', '✅ 设置已保存', false);
}

async function loadLicenseStatus() {
  if (!lm) return;

  const activated = await lm.isActivated();
  const counts = await lm.getUsageCounts();

  const activatedEl = document.getElementById('license-activated');
  const trialEl = document.getElementById('license-trial');
  const inputEl = document.getElementById('license-input');

  if (activated) {
    if (activatedEl) activatedEl.style.display = '';
    if (trialEl) trialEl.style.display = 'none';
    if (inputEl) inputEl.style.display = 'none';
    if (usageRemainingEl) usageRemainingEl.textContent = '∞';
    if (usageCountEl) usageCountEl.textContent = '—';
    if (progressFillEl) progressFillEl.style.width = '100%';
  } else {
    if (activatedEl) activatedEl.style.display = 'none';
    if (trialEl) trialEl.style.display = '';
    if (inputEl) inputEl.style.display = '';

    const used = counts.used || 0;
    const total = counts.limit || 5;
    const remaining = Math.max(0, total - used);
    const pct = Math.min(100, Math.round((used / total) * 100));

    document.getElementById('trialRemaining').textContent = remaining;
    if (usageRemainingEl) usageRemainingEl.textContent = remaining;
    if (usageCountEl) usageCountEl.textContent = used;
    if (progressFillEl) progressFillEl.style.width = pct + '%';
  }
}

async function activateLicense() {
  const key = document.getElementById('licenseKey').value.trim();
  if (!key) {
    showMsg('licenseMsg', '❌ 请输入 License Key', true);
    return;
  }
  if (!/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(key)) {
    showMsg('licenseMsg', '❌ License Key 格式错误，应为 XXXX-XXXX-XXXX-XXXX', true);
    return;
  }

  document.getElementById('activateBtn').disabled = true;
  document.getElementById('activateBtn').textContent = '⏳ 验证中...';
  showMsg('licenseMsg', '⏳ 正在验证 License...', false);

  try {
    const result = await chrome.runtime.sendMessage({ action: 'verifyLicense', licenseKey: key });
    if (result.success) {
      showMsg('licenseMsg', '✅ License 激活成功！Pro 版已解锁', false);
      setTimeout(() => loadLicenseStatus(), 500);
    } else {
      showMsg('licenseMsg', '❌ ' + (result.error || '激活失败，请检查 License Key'), true);
    }
  } catch (e) {
    showMsg('licenseMsg', '❌ 验证失败：' + e.message, true);
  } finally {
    document.getElementById('activateBtn').disabled = false;
    document.getElementById('activateBtn').textContent = '🔓 激活 Pro';
  }
}