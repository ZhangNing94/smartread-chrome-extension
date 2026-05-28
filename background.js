// SmartRead - Background Service Worker
// Creates context menu, handles DeepSeek API streaming calls, License verification

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const TRIAL_LIMIT = 5;
const GUMROAD_URL = 'https://api.gumroad.com/v2/licenses/verify';
const PRODUCT_PERMALINK = 'kdmkah';

// --- Built-in API Key (base64 obfuscated) ---
const BUILT_IN_KEY_B64 = 'c2stODc4Nzc1YmQtaXdXNHI5MXhBRGk3WktZVlQ4WDFZeTRjSGY2ZE9qbA==';
function _builtinKey() { return atob(BUILT_IN_KEY_B64); }

// --- Get effective API key (user's key in chrome.storage.sync, fallback to built-in) ---
async function getEffectiveApiKey() {
  const { apiKey: encodedKey } = await chrome.storage.sync.get('apiKey');
  if (encodedKey) {
    try { return atob(encodedKey); } catch(e) { return _builtinKey(); }
  }
  return _builtinKey();
}

// --- Context Menu Setup ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'smartread-parent',
    title: '📖 SmartRead - AI 分析',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'smartread-tldr',
    parentId: 'smartread-parent',
    title: '📝 TL;DR 一句话总结',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'smartread-keypoints',
    parentId: 'smartread-parent',
    title: '📌 提取要点',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'smartread-analysis',
    parentId: 'smartread-parent',
    title: '🔍 详细分析',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'smartread-plain',
    parentId: 'smartread-parent',
    title: '💡 通俗解释',
    contexts: ['selection']
  });
});

// --- Prompt Templates ---
const PROMPTS = {
  'smartread-tldr': (text) => `你是一个专业的文章摘要助手。对以下网页内容，用1-2句话做TL;DR总结，直接给出总结结果，不要有任何前缀说明：\n\n${text}`,
  'smartread-keypoints': (text) => `你是一个专业的文章分析助手。对以下网页内容，提取3-5个核心要点，用bullet points列出，每个要点不超过一句话。用Markdown格式输出：\n\n${text}`,
  'smartread-analysis': (text) => `你是一个专业的文章分析助手。对以下网页内容，做一个详细分析，包括：主要观点、支撑论据、结论和潜在影响。用Markdown格式输出，层次分明：\n\n${text}`,
  'smartread-plain': (text) => `你是一个科普助手。请把以下网页内容，用小学生都能理解的通俗语言解释清楚。避免专业术语，如果必须用则加括号解释。用友好的语气输出：\n\n${text}`
};

// --- License Verification (inline in service worker) ---
async function isLicenseActivated() {
  const { lm_activated, lm_dispute_checked } = await chrome.storage.local.get(['lm_activated', 'lm_dispute_checked']);
  if (!lm_activated || !lm_activated.licenseKey) return false;

  // Periodic dispute check (every 7 days)
  const now = Date.now();
  const lastCheck = lm_dispute_checked || 0;
  if (now - lastCheck > 7 * 24 * 60 * 60 * 1000) {
    const stillValid = await checkGumroadLicense(lm_activated.licenseKey);
    if (!stillValid) {
      await chrome.storage.local.remove(['lm_activated', 'lm_trial_count']);
      await chrome.storage.local.set({ lm_dispute_checked: now });
      return false;
    }
    await chrome.storage.local.set({ lm_dispute_checked: now });
  }
  return true;
}

async function checkGumroadLicense(licenseKey) {
  try {
    const resp = await fetch(GUMROAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_permalink: PRODUCT_PERMALINK, license_key: licenseKey, increment_uses_count: false })
    });
    const data = await resp.json();
    return data.success && !data.uses.cancelled_at && !data.uses.refunded_at;
  } catch {
    return false;
  }
}

async function verifyLicenseKey(licenseKey) {
  try {
    const resp = await fetch(GUMROAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_permalink: PRODUCT_PERMALINK, license_key: licenseKey, increment_uses_count: true })
    });
    const data = await resp.json();
    if (!data.success) {
      return { success: false, error: data.error || '无效的 License Key' };
    }
    if (data.uses.cancelled_at) return { success: false, error: '此 License 已被取消' };
    if (data.uses.refunded_at) return { success: false, error: '此 License 已退款' };

    // Count unique devices
    const deviceId = generateDeviceId();
    const { lm_device_ids = [] } = await chrome.storage.local.get('lm_device_ids');
    const newDevices = [...new Set([...lm_device_ids, deviceId])];
    if (newDevices.length > 2) {
      return { success: false, error: '此 License 已超过2台设备限制' };
    }

    // Activate
    await chrome.storage.local.set({
      lm_activated: { licenseKey, activatedAt: Date.now() },
      lm_device_ids: newDevices,
      lm_dispute_checked: Date.now()
    });
    await chrome.storage.local.remove('lm_trial_count');
    return { success: true };
  } catch (e) {
    return { success: false, error: '网络错误，请检查网络连接' };
  }
}

function generateDeviceId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// --- Lifetime Trial Usage Tracking ---
async function getUserUsage() {
  const { lm_trial_count = 0 } = await chrome.storage.local.get('lm_trial_count');
  return lm_trial_count;
}

async function checkUsageLimit() {
  const activated = await isLicenseActivated();
  if (activated) return true;

  const used = await getUserUsage();
  return used < TRIAL_LIMIT;
}

async function incrementUsage() {
  const activated = await isLicenseActivated();
  if (activated) return; // Pro users don't track usage

  const used = await getUserUsage();
  await chrome.storage.local.set({ lm_trial_count: used + 1 });
}

// --- DeepSeek API Streaming Call ---
async function callDeepSeekStream(prompt, apiKey, sender) {
  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      temperature: 0.7,
      max_tokens: 2048
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    let errMsg = `API 错误 (${response.status})`;
    try {
      const errJson = JSON.parse(errBody);
      errMsg = errJson.error?.message || errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: 'streamChunk',
            content: content
          }).catch(() => {});
        }
      } catch {}
    }
  }
}

// --- Context Menu Click Handler ---
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuId = info.menuItemId;
  if (!menuId.startsWith('smartread-') || menuId === 'smartread-parent') return;
  if (!info.selectionText) return;

  const selectedText = info.selectionText.trim();
  if (selectedText.length < 10) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'showError',
      error: '选中的文本太短，请至少选择10个字符'
    }).catch(() => {});
    return;
  }

  // Retrieve and decode API key (built-in or user's own)
  const apiKey = await getEffectiveApiKey();

  // Check usage limit (lifetime trial or Pro)
  const withinLimit = await checkUsageLimit();
  if (!withinLimit) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'showError',
      error: `试用额度（${TRIAL_LIMIT}次）已用完，请购买 Pro License 解锁无限次使用`
    }).catch(() => {});
    return;
  }

  // Notify content script to show loading
  chrome.tabs.sendMessage(tab.id, { action: 'showLoading' }).catch(() => {});

  // Increment usage (no-op for Pro users)
  await incrementUsage();

  // Get the prompt template
  const promptFn = PROMPTS[menuId];
  const modeLabels = {
    'smartread-tldr': 'TL;DR 总结',
    'smartread-keypoints': '要点提取',
    'smartread-analysis': '详细分析',
    'smartread-plain': '通俗解释'
  };

  try {
    // Send initial header
    chrome.tabs.sendMessage(tab.id, {
      action: 'showHeader',
      mode: modeLabels[menuId] || '分析',
      text: selectedText
    }).catch(() => {});

    // Stream the response
    await callDeepSeekStream(promptFn(selectedText), apiKey, { tab });

    // Signal completion
    chrome.tabs.sendMessage(tab.id, { action: 'streamDone' }).catch(() => {});

  } catch (error) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'showError',
      error: `调用失败: ${error.message}`
    }).catch(() => {});
  }
});

// --- Message Handlers (for popup communication) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'verifyLicense') {
    verifyLicenseKey(message.licenseKey).then(sendResponse);
    return true; // async
  }
  if (message.action === 'getLicenseStatus') {
    (async () => {
      const activated = await isLicenseActivated();
      const used = await getUserUsage();
      sendResponse({ activated, usageCount: used, limit: TRIAL_LIMIT });
    })();
    return true;
  }
  if (message.action === 'getUsage') {
    (async () => {
      const activated = await isLicenseActivated();
      const used = await getUserUsage();
      sendResponse({ activated, usageCount: used, limit: TRIAL_LIMIT });
    })();
    return true;
  }
});