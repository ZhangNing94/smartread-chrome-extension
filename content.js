// SmartRead - Content Script
// Renders floating result panel with streaming content

(function() {
  'use strict';

  let panel = null;
  let contentArea = null;
  let currentContent = '';

  // --- Simple Markdown Renderer ---
  function renderMarkdown(text) {
    // Escape HTML
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code blocks (```...```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

    // Inline code (`...`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold & Italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Bullet points
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Numbered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Line breaks (preserve double newlines)
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');

    return html;
  }

  // --- Create Panel ---
  function createPanel() {
    if (panel) {
      panel.remove();
    }

    panel = document.createElement('div');
    panel.id = 'smartread-panel';
    panel.innerHTML = `
      <div class="smartread-header">
        <div class="smartread-title">
          <span class="smartread-icon">🤖</span>
          <span class="smartread-mode">SmartRead</span>
        </div>
        <button class="smartread-close" title="关闭">×</button>
      </div>
      <div class="smartread-selected">
        <div class="smartread-selected-label">原文选段</div>
        <div class="smartread-selected-text"></div>
      </div>
      <div class="smartread-content">
        <div class="smartread-spinner"></div>
        <div class="smartread-result"></div>
      </div>
      <div class="smartread-footer">
        <button class="smartread-copy" title="复制结果">
          <span>📋</span> 复制
        </button>
        <span class="smartread-usage"></span>
      </div>
    `;

    document.body.appendChild(panel);

    // Bind events
    panel.querySelector('.smartread-close').addEventListener('click', closePanel);
    panel.querySelector('.smartread-copy').addEventListener('click', copyResult);

    // Make draggable
    makeDraggable(panel);

    contentArea = panel.querySelector('.smartread-result');
    currentContent = '';
  }

  // --- Make Panel Draggable ---
  function makeDraggable(el) {
    const header = el.querySelector('.smartread-header');
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    header.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('smartread-close')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      el.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = `${initialLeft + dx}px`;
      el.style.top = `${initialTop + dy}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      el.style.transition = '';
    });
  }

  // --- Close Panel ---
  function closePanel() {
    if (panel) {
      panel.remove();
      panel = null;
      contentArea = null;
    }
  }

  // --- Copy Result ---
  function copyResult() {
    if (!currentContent) return;

    navigator.clipboard.writeText(currentContent).then(() => {
      const btn = panel.querySelector('.smartread-copy');
      const original = btn.innerHTML;
      btn.innerHTML = '<span>✓</span> 已复制';
      btn.disabled = true;
      setTimeout(() => {
        btn.innerHTML = original;
        btn.disabled = false;
      }, 2000);
    });
  }

  // --- Message Handler ---
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'showLoading':
        createPanel();
        panel.querySelector('.smartread-spinner').style.display = 'block';
        panel.querySelector('.smartread-result').style.display = 'none';
        break;

      case 'showHeader':
        panel.querySelector('.smartread-mode').textContent = message.mode;
        const selectedPreview = message.text.length > 150 
          ? message.text.substring(0, 150) + '...' 
          : message.text;
        panel.querySelector('.smartread-selected-text').textContent = selectedPreview;
        break;

      case 'streamChunk':
        currentContent += message.content;
        panel.querySelector('.smartread-spinner').style.display = 'none';
        contentArea = panel.querySelector('.smartread-result');
        contentArea.style.display = 'block';
        contentArea.innerHTML = renderMarkdown(currentContent);
        // Auto-scroll to bottom
        contentArea.scrollTop = contentArea.scrollHeight;
        break;

      case 'streamDone':
        // Update usage display
        chrome.storage.local.get(['usageCount', 'lastResetDate'], (result) => {
          const count = result.usageCount || 0;
          const today = new Date().toDateString();
          const isToday = result.lastResetDate === today;
          const displayCount = isToday ? count : 0;
          panel.querySelector('.smartread-usage').textContent = `今日已用 ${displayCount}/10 次`;
        });
        break;

      case 'showError':
        if (!panel) createPanel();
        panel.querySelector('.smartread-spinner').style.display = 'none';
        contentArea = panel.querySelector('.smartread-result');
        contentArea.style.display = 'block';
        contentArea.innerHTML = `<div class="smartread-error">❌ ${message.error}</div>`;
        break;
    }

    sendResponse({ received: true });
    return true;
  });

  // --- Keyboard shortcut to close ---
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel) {
      closePanel();
    }
  });

})();