// SmartRead - Background Service Worker
// Creates context menu, handles DeepSeek API streaming calls

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const FREE_DAILY_LIMIT = 10;

// --- Context Menu Setup ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'smartread-parent',
    title: '🤖 SmartRead - AI 分析',
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

// --- Usage Tracking ---
async function checkUsageLimit() {
  const { usageCount = 0, lastResetDate = '' } = await chrome.storage.local.get(['usageCount', 'lastResetDate']);
  const today = new Date().toDateString();

  if (lastResetDate !== today) {
    await chrome.storage.local.set({ usageCount: 0, lastResetDate: today });
    return true;
  }

  return usageCount < FREE_DAILY_LIMIT;
}

async function incrementUsage() {
  const { usageCount = 0 } = await chrome.storage.local.get('usageCount');
  await chrome.storage.local.set({ usageCount: usageCount + 1 });
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

  // Get API key
  const { apiKey } = await chrome.storage.sync.get('apiKey');
  if (!apiKey) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'showError',
      error: '请先设置 DeepSeek API Key。点击扩展图标进入设置。'
    }).catch(() => {});
    return;
  }

  // Check usage limit
  const withinLimit = await checkUsageLimit();
  if (!withinLimit) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'showError',
      error: `今日免费额度（${FREE_DAILY_LIMIT}次）已用完，请明天再试。`
    }).catch(() => {});
    return;
  }

  // Notify content script to show loading
  chrome.tabs.sendMessage(tab.id, { action: 'showLoading' }).catch(() => {});

  // Increment usage
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