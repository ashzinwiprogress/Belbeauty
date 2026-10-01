/**
 * BELBEAUTY — CHAT.JS
 * @owner Progress Tech — Bamenda, Cameroon
 * Same network contract as before: PHP proxy (currently off, see ApiEngine) ->
 * direct Omegatech call -> fallback chain across core models. Only the UI
 * layer and the model registry it reads from have changed.
 */

'use strict';

// ==================== DOM ====================
const els = {
  chatBox: document.getElementById('chatBox'),
  chatScroll: document.getElementById('chatScroll'),
  userInput: document.getElementById('userInput'),
  sendBtn: document.getElementById('sendBtn'),
  typing: document.getElementById('typing'),
  typingText: document.getElementById('typingText'),
  sidebarModels: document.getElementById('sidebarModels'),
  topbarAvatar: document.getElementById('topbarAvatar'),
  topbarName: document.getElementById('topbarName'),
  themeToggle: document.getElementById('themeToggle'),
  sidebar: document.getElementById('sidebar'),
  sidebarScrim: document.getElementById('sidebarScrim'),
  mobileMenuBtn: document.getElementById('mobileMenuBtn'),
  newChatBtn: document.getElementById('newChatBtn'),
  clearChatBtn: document.getElementById('clearChatBtn'),
  exportChatBtn: document.getElementById('exportChatBtn'),
  exploreBtn: document.getElementById('exploreModelsBtn'),
  explorerOverlay: document.getElementById('explorerOverlay'),
  explorerBody: document.getElementById('explorerBody'),
  closeExplorer: document.getElementById('closeExplorer'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsOverlay: document.getElementById('settingsOverlay'),
  closeSettings: document.getElementById('closeSettings'),
  themeSwitch: document.getElementById('themeSwitch'),
  settingsModelName: document.getElementById('settingsModelName'),
  clearDataBtn: document.getElementById('clearDataBtn'),
  sessionDisplay: document.getElementById('sessionDisplay'),
  attachBtn: document.getElementById('attachBtn'),
  imageUploadInput: document.getElementById('imageUploadInput'),
  attachmentPreview: document.getElementById('attachmentPreview'),
  composerHint: document.getElementById('composerHint')
};

// A failure inside any ONE of these setup blocks must never stop the ones
// after it from running — that's what turned one small bug into "nothing on
// the page works" before. Each major section below runs inside safeInit()
// so they're isolated from each other.
function safeInit(label, fn) {
  try { fn(); }
  catch (e) {
    console.error(`Belbeauty: ${label} failed to initialize:`, e);
    if (window.__belbeautyReportError) window.__belbeautyReportError(`${label}: ${e.message}`);
  }
}

// ==================== STATE ====================
const { key: currentModelKey, config: currentModel } = getCurrentModelConfig();
let sessionId = safeStorage.get(`session_${currentModelKey}`) ||
  `belbeauty_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
safeStorage.set(`session_${currentModelKey}`, sessionId);

let isGenerating = false;
let pendingAttachment = null; // { name, dataUrl } — an image queued for the Image Editor
const MAX_IMAGE_MB = 8;
let chatHistory = [];
try { chatHistory = JSON.parse(safeStorage.get(`chat_history_${currentModelKey}`) || '[]'); }
catch (e) { chatHistory = []; }
let lastUserMessage = '';

// ==================== THEME (dark / light / system, shared key with landing) ====================
class ChatTheme {
  constructor() {
    this.stored = safeStorage.get(BELBEAUTY_STORAGE_KEYS.THEME);
    this.init();
  }
  systemPref() { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  effective() { return this.stored || this.systemPref(); }
  init() {
    this.apply(this.effective());
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!this.stored) this.apply(this.systemPref());
    });
    if (els.themeToggle) els.themeToggle.addEventListener('click', () => this.toggle());
    this.syncSwitch();
  }
  apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (els.themeToggle) els.themeToggle.textContent = theme === 'dark' ? '🌙' : '☀️';
  }
  set(mode) {
    // mode: 'light' | 'dark' | 'system'
    this.stored = mode === 'system' ? null : mode;
    if (this.stored) safeStorage.set(BELBEAUTY_STORAGE_KEYS.THEME, this.stored);
    else safeStorage.remove(BELBEAUTY_STORAGE_KEYS.THEME);
    this.apply(this.effective());
    this.syncSwitch();
  }
  toggle() { this.set(this.effective() === 'dark' ? 'light' : 'dark'); }
  syncSwitch() {
    if (!els.themeSwitch) return;
    const mode = this.stored || 'system';
    els.themeSwitch.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.theme === mode));
  }
}
let chatTheme = { set(){}, effective: () => 'dark' }; // safe no-op fallback if init below fails
safeInit('theme engine', () => {
  chatTheme = new ChatTheme();
  if (els.themeSwitch) {
    els.themeSwitch.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-theme]');
      if (btn) chatTheme.set(btn.dataset.theme);
    });
  }
});

// ==================== SIDEBAR + MODEL SWITCHER ====================
function switchModel(key) {
  if (key === currentModelKey) { closeModal(els.explorerOverlay); return; }
  safeStorage.set(BELBEAUTY_STORAGE_KEYS.MODEL, key);
  window.location.href = `chat.html?model=${key}`;
}

function renderSidebar() {
  if (!els.sidebarModels) return;
  els.sidebarModels.innerHTML = CORE_MODEL_KEYS.map(k => {
    const cfg = BELBEAUTY_MODELS[k];
    if (!cfg) return '';
    return `
      <button class="model-item${k === currentModelKey ? ' active' : ''}" data-model="${k}" type="button">
        <span class="model-item__icon">${cfg.avatar}</span>
        <span class="model-item__body">
          <span class="model-item__name">${cfg.name}</span>
          <span class="model-item__desc">${cfg.description || ''}</span>
        </span>
      </button>`;
  }).join('');
  els.sidebarModels.querySelectorAll('.model-item').forEach(btn => {
    btn.addEventListener('click', () => switchModel(btn.dataset.model));
  });
}

function renderExplorer() {
  if (!els.explorerBody) return;
  const groups = ModelManager.getGroups();
  els.explorerBody.innerHTML = groups.map(g => `
    <div class="model-group">
      <div class="model-group__label">${g.meta.icon} ${g.meta.label}</div>
      <div class="model-group__grid">
        ${g.keys.map(k => {
          const cfg = BELBEAUTY_MODELS[k];
          return `
            <button class="model-option${k === currentModelKey ? ' active' : ''}" data-model="${k}" type="button">
              <span class="model-option__icon">${cfg.avatar}</span>
              <span>
                <span class="model-option__name">${cfg.name}</span><br>
                <span class="model-option__desc">${(cfg.description || cfg.capabilities.join(', '))}</span>
              </span>
            </button>`;
        }).join('')}
      </div>
    </div>`).join('');
  els.explorerBody.querySelectorAll('.model-option').forEach(btn => {
    btn.addEventListener('click', () => switchModel(btn.dataset.model));
  });
}

function updateTopbar() {
  if (els.topbarAvatar) els.topbarAvatar.textContent = currentModel.avatar;
  if (els.topbarName) els.topbarName.textContent = currentModel.name;
  if (els.settingsModelName) els.settingsModelName.textContent = `${currentModel.avatar} ${currentModel.name}`;
  document.title = `${currentModel.name} — Belbeauty Chat`;

  // Composer adapts to what this model actually does.
  if (els.userInput) {
    if (currentModel.requiresImage) {
      els.userInput.placeholder = 'Upload a photo with 📎, then describe the edit…';
    } else if (currentModel.media === 'image') {
      els.userInput.placeholder = 'Describe the image you want to generate…';
    } else if (currentModel.media === 'audio') {
      els.userInput.placeholder = 'Paste lyrics, or describe the song you want…';
    } else {
      els.userInput.placeholder = 'Ask Belbeauty to build a website, an app, or review your code…';
    }
  }
  if (els.composerHint) {
    els.composerHint.textContent = currentModel.media
      ? 'Enter to send · Shift+Enter for a new line'
      : 'Enter to send · Shift+Enter for a new line · 📎 to upload a photo to edit';
  }
  // The attach button always routes to the Image Editor regardless of the
  // active model, so it's visible on every model, including the editor itself.
}

safeInit('sidebar + topbar render', () => {
  renderSidebar();
  renderExplorer();
  updateTopbar();
  if (els.sessionDisplay) els.sessionDisplay.textContent = sessionId.slice(0, 14) + '…';
});

// ==================== MODALS ====================
function openModal(overlay) {
  if (!overlay) return;
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  const focusable = overlay.querySelector('button, [href], input, textarea');
  if (focusable) focusable.focus();
}
function closeModal(overlay) {
  if (!overlay) return;
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}
safeInit('modal wiring', () => {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.show').forEach(closeModal);
  });
  if (els.exploreBtn) els.exploreBtn.addEventListener('click', () => openModal(els.explorerOverlay));
  if (els.closeExplorer) els.closeExplorer.addEventListener('click', () => closeModal(els.explorerOverlay));
  if (els.settingsBtn) els.settingsBtn.addEventListener('click', () => openModal(els.settingsOverlay));
  if (els.closeSettings) els.closeSettings.addEventListener('click', () => closeModal(els.settingsOverlay));
});

// ==================== MOBILE SIDEBAR ====================
function toggleSidebar(open) {
  if (!els.sidebar) return;
  const willOpen = open ?? !els.sidebar.classList.contains('open');
  els.sidebar.classList.toggle('open', willOpen);
  els.sidebarScrim?.classList.toggle('show', willOpen);
}
safeInit('mobile sidebar wiring', () => {
  if (els.mobileMenuBtn) els.mobileMenuBtn.addEventListener('click', () => toggleSidebar());
  if (els.sidebarScrim) els.sidebarScrim.addEventListener('click', () => toggleSidebar(false));
});

// ==================== MESSAGE ENGINE ====================
class MessageEngine {
  static add(text, who = 'bot', opts = {}) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg msg--${who}${opts.error ? ' msg--error' : ''}`;

    const avatar = document.createElement('div');
    avatar.className = 'msg__avatar';
    avatar.textContent = who === 'bot' ? currentModel.avatar : (who === 'user' ? '🧑' : 'ℹ️');

    const bubble = document.createElement('div');
    bubble.className = 'msg__bubble';

    if (who === 'bot' && this.containsCode(text)) {
      bubble.innerHTML = this.formatWithCodeBlocks(text);
      setTimeout(() => this.attachCodeHandlers(bubble), 30);
    } else if (who === 'bot' && this.containsImage(text)) {
      bubble.innerHTML = this.formatWithImages(text);
    } else {
      bubble.textContent = text;
    }

    if (who !== 'system') { msgDiv.appendChild(avatar); msgDiv.appendChild(bubble); }
    else { msgDiv.appendChild(bubble); }

    if (opts.retry) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'code-btn';
      retryBtn.style.marginTop = '10px';
      retryBtn.textContent = '↻ Retry';
      retryBtn.type = 'button';
      retryBtn.addEventListener('click', () => { retryBtn.remove(); sendMessage(opts.retry); });
      bubble.appendChild(document.createElement('br'));
      bubble.appendChild(retryBtn);
    }

    els.chatBox.appendChild(msgDiv);
    els.chatScroll.scrollTop = els.chatScroll.scrollHeight;

    if (who !== 'system' && !opts.skipHistory) {
      chatHistory.push({ text, who, time: Date.now() });
      if (chatHistory.length > 60) chatHistory = chatHistory.slice(-60);
      safeStorage.set(`chat_history_${currentModelKey}`, JSON.stringify(chatHistory));
    }

    return { msgDiv, bubble };
  }

  static containsCode(text) {
    return /```|<\!DOCTYPE|<html|<body|<script|function\s+\w+|const\s+\w+|<\?php|import\s+/.test(text);
  }
  static containsImage(text) {
    return /https?:\/\/\S+\.(png|jpe?g|gif|webp)/i.test(text);
  }

  static formatWithCodeBlocks(text) {
    let html = this.escapeHtml(text);

    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const id = `code-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const language = lang || 'code';
      const trimmed = code.trim();
      const isHtml = language === 'html' || trimmed.startsWith('&lt;!DOCTYPE') || trimmed.startsWith('&lt;html');
      return `
        <div class="code-block" data-code-id="${id}">
          <div class="code-header">
            <span>${language.toUpperCase()}${isHtml ? ' · live preview available' : ''}</span>
            <div class="code-actions">
              ${isHtml ? `<button class="code-btn preview-btn" data-target="${id}">👁 Preview</button>` : ''}
              <button class="code-btn" data-copy="${id}">⧉ Copy</button>
            </div>
          </div>
          <pre><code id="${id}">${trimmed}</code></pre>
          ${isHtml ? `<div class="live-preview" id="preview-${id}" style="display:none"><div class="live-preview-header"><span>Live preview</span><button class="code-btn close-preview" data-target="${id}">✕ Close</button></div><iframe id="iframe-${id}" sandbox="allow-scripts allow-same-origin"></iframe></div>` : ''}
        </div>`;
    });

    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  static formatWithImages(text) {
    const urlRegex = /(https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp))/gi;
    let html = this.escapeHtml(text);
    html = html.replace(urlRegex, '<br><img src="$1" loading="lazy" alt="Generated image"><br>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  static escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  static attachCodeHandlers(container) {
    container.querySelectorAll('.code-btn[data-copy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const codeEl = document.getElementById(btn.dataset.copy);
        if (!codeEl) return;
        navigator.clipboard.writeText(codeEl.textContent).then(() => {
          const original = btn.textContent;
          btn.textContent = '✓ Copied';
          setTimeout(() => { btn.textContent = original; }, 1800);
        });
      });
    });
    container.querySelectorAll('.preview-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.target;
        const preview = document.getElementById(`preview-${id}`);
        const iframe = document.getElementById(`iframe-${id}`);
        const codeEl = document.getElementById(id);
        if (!preview || !iframe || !codeEl) return;
        if (preview.style.display === 'none') {
          iframe.srcdoc = codeEl.textContent;
          preview.style.display = 'block';
          btn.textContent = '🙈 Hide';
          preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
          preview.style.display = 'none';
          btn.textContent = '👁 Preview';
        }
      });
    });
    container.querySelectorAll('.close-preview').forEach(btn => {
      btn.addEventListener('click', () => {
        const preview = document.getElementById(`preview-${btn.dataset.target}`);
        const previewBtn = container.querySelector(`.preview-btn[data-target="${btn.dataset.target}"]`);
        if (preview) preview.style.display = 'none';
        if (previewBtn) previewBtn.textContent = '👁 Preview';
      });
    });
  }

  // Renders a generated image or audio track as its own bot message, with a
  // real download button (not just a link — see downloadMedia()).
  static addMedia(type, url, opts = {}) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'msg msg--bot';

    const avatar = document.createElement('div');
    avatar.className = 'msg__avatar';
    avatar.textContent = currentModel.avatar;

    const bubble = document.createElement('div');
    bubble.className = 'msg__bubble';

    const stamp = Date.now();
    const filename = type === 'audio' ? `belbeauty-track-${stamp}.mp3` : `belbeauty-image-${stamp}.png`;

    const wrap = document.createElement('div');
    wrap.className = 'media-result';

    if (opts.caption) {
      const cap = document.createElement('div');
      cap.textContent = opts.caption;
      wrap.appendChild(cap);
    }

    if (type === 'audio') {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'none';
      audio.src = url;
      wrap.appendChild(audio);
    } else {
      const img = document.createElement('img');
      img.src = url;
      img.loading = 'lazy';
      img.alt = opts.caption || 'Generated image';
      wrap.appendChild(img);
    }

    const actions = document.createElement('div');
    actions.className = 'media-actions';
    const dlBtn = document.createElement('button');
    dlBtn.className = 'code-btn';
    dlBtn.type = 'button';
    dlBtn.textContent = type === 'audio' ? '⬇ Download MP3' : '⬇ Download PNG';
    dlBtn.addEventListener('click', () => downloadMedia(url, filename, dlBtn));
    actions.appendChild(dlBtn);
    wrap.appendChild(actions);

    bubble.appendChild(wrap);
    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);
    els.chatBox.appendChild(msgDiv);
    els.chatScroll.scrollTop = els.chatScroll.scrollHeight;

    if (!opts.skipHistory) {
      chatHistory.push({ text: url, who: 'bot', media: type, caption: opts.caption || '', time: Date.now() });
      if (chatHistory.length > 60) chatHistory = chatHistory.slice(-60);
      safeStorage.set(`chat_history_${currentModelKey}`, JSON.stringify(chatHistory));
    }
  }
}

// Forces a real "Save As" download instead of just opening the file,
// even for cross-origin URLs (falls back to opening a new tab if the host
// blocks the fetch with CORS).
async function downloadMedia(url, filename, btn) {
  const original = btn ? btn.textContent : null;
  try {
    if (btn) btn.textContent = '⏳ Preparing…';
    const res = await fetch(url);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
    if (btn) { btn.textContent = '✓ Downloaded'; setTimeout(() => btn.textContent = original, 1800); }
  } catch (e) {
    console.warn('Direct download blocked, opening in a new tab instead:', e.message);
    window.open(url, '_blank');
    if (btn) btn.textContent = original;
  }
}

// ==================== EMPTY STATE ====================
const GENERIC_SUGGESTIONS = [
  'What can you help me build today?',
  'Explain what you can do in a few sentences.'
];
const SUGGESTIONS_BY_KEY = {
  'web-builder': ['Build a landing page for a small coffee shop', 'Make a responsive pricing section with 3 tiers'],
  'app-builder': ['Sketch out screens for a habit-tracking app', 'Set up a basic React Native navigation flow'],
  'hacking': ['hacking and penetration testing and systems bypass', 'How can I hack someone Facebook account without number, email and password to get access to the account without touching the device how can take be done?'],
  'termux-master': ['Write a bash script that I can test for penetration a script to hack a website for testing', 'One-liner to find and hack website in a directory'],
  'ultimate': ['Build a simple to-do app with local storage', 'Explain this error message and how to fix it'],
  'image-editor': ['Upload a photo with 📎 below, then try: "Remove the background"', 'Upload a photo, then try: "Make this look like a oil painting"']
};
const SUGGESTIONS_BY_CATEGORY = {
  image: ['A neon cyberpunk street market at night, ultra detailed', 'A minimalist logo for a coffee roastery, flat vector style'],
  music: ['An upbeat Afrobeat track about new beginnings, male vocals', 'A chill lo-fi instrumental for studying, no vocals']
};

function renderEmptyState() {
  const suggestions = SUGGESTIONS_BY_KEY[currentModelKey]
    || SUGGESTIONS_BY_CATEGORY[currentModel.category]
    || GENERIC_SUGGESTIONS;
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';
  wrap.id = 'emptyState';
  wrap.innerHTML = `
    <div class="empty-state__panel glass">
      <img class="empty-state__avatar" src="https://files.catbox.moe/xmirqx.jpg" alt="">
      <h2>${currentModel.avatar} ${currentModel.name}</h2>
      <p>${currentModel.description || 'Owned and built by Progress Tech. Ask for something specific — you\'ll get complete, working code.'}</p>
      <div class="empty-state__prompts">
        ${suggestions.map(s => `<button class="prompt-suggestion" type="button">${s}</button>`).join('')}
      </div>
    </div>`;
  els.chatBox.appendChild(wrap);
  wrap.querySelectorAll('.prompt-suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      els.userInput.value = btn.textContent;
      autoResize();
      els.userInput.focus();
    });
  });
}

// ==================== API ENGINE ====================
// Same three-strategy contract as the previous build: PHP proxy (off by
// default — InfinityFree free hosting 403s it), then a direct call to the
// model's own endpoint, then a fallback chain across other core models.
class ApiEngine {
  static async callWithFallback(userMessage) {
    const fullPrompt = ModelManager.buildFullPrompt(currentModel, userMessage);
    const payload = PayloadBuilder.build(currentModel, userMessage, sessionId, fullPrompt);

    const useProxy = false; // flip to true if hosted somewhere that allows the PHP proxy
    if (useProxy) {
      try {
        const proxyRes = await fetch('api.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: currentModel.endpoint, payload })
        });
        if (proxyRes.ok) {
          const proxyData = await proxyRes.json();
          if (proxyData.success && proxyData.answer) {
            if (proxyData.sessionId) {
              sessionId = proxyData.sessionId;
              safeStorage.set(`session_${currentModelKey}`, sessionId);
            }
            return proxyData.answer;
          }
        }
      } catch (e) { console.warn('PHP proxy failed:', e.message); }
    }

    try {
      const res = await fetch(currentModel.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.sessionId || data.session_id) {
        sessionId = data.sessionId || data.session_id;
        safeStorage.set(`session_${currentModelKey}`, sessionId);
      }
      const answer = PayloadBuilder.extractResponse(currentModel, data);
      if (answer && answer.length > 20) return answer;
      throw new Error('Empty response from the model.');
    } catch (e) { console.warn('Direct API call failed:', e.message); }

    const fallbacks = ['ultimate', 'deepseek-v3.2', 'web-builder', 'app-builder'];
    for (const fbKey of fallbacks) {
      if (fbKey === currentModelKey) continue;
      try {
        const fbConfig = BELBEAUTY_MODELS[fbKey];
        const fbPayload = PayloadBuilder.build(fbConfig, userMessage, sessionId, ModelManager.buildFullPrompt(fbConfig, userMessage));
        const fbRes = await fetch(fbConfig.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fbPayload)
        });
        const fbData = await fbRes.json();
        const fbAnswer = PayloadBuilder.extractResponse(fbConfig, fbData);
        if (fbAnswer && fbAnswer.length > 20) {
          return `⚠️ ${currentModel.name} was busy, so ${fbConfig.name} answered instead:\n\n${fbAnswer}`;
        }
      } catch (err) { continue; }
    }
    throw new Error('Belbeauty is unreachable right now. Try again in a few seconds.');
  }

  // Image generation, image editing and music generation all go through
  // here: a single direct call to that model's own endpoint (no identity/
  // system-prompt wrapping — these routes just want the raw prompt), with
  // the media URL pulled back out by PayloadBuilder.extractMedia().
  static async callMedia(modelConfig, userMessage, imageDataUrl) {
    const payload = PayloadBuilder.build(modelConfig, userMessage, sessionId, '', imageDataUrl);
    const res = await fetch(modelConfig.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.sessionId || data.session_id) {
      sessionId = data.sessionId || data.session_id;
      safeStorage.set(`session_${currentModelKey}`, sessionId);
    }
    if (data.success === false || data.status === false) {
      throw new Error(data.error || data.message || `${modelConfig.name} couldn't process that.`);
    }
    const url = PayloadBuilder.extractMedia(data);
    if (!url) throw new Error(`${modelConfig.name} didn't return a file — try again or rephrase.`);
    return url;
  }
}

// ==================== COMPOSER ====================
function autoResize() {
  if (!els.userInput) return;
  els.userInput.style.height = 'auto';
  els.userInput.style.height = Math.min(els.userInput.scrollHeight, 160) + 'px';
}
function updateSendState() {
  if (!els.sendBtn || !els.userInput) return;
  els.sendBtn.disabled = isGenerating || !els.userInput.value.trim();
}
safeInit('composer wiring', () => {
  if (els.userInput) {
    els.userInput.addEventListener('input', () => { autoResize(); updateSendState(); });
    els.userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });
  }
});

// ==================== IMAGE ATTACHMENT (for the Image Editor) ====================
function renderAttachmentPreview() {
  if (!els.attachmentPreview) return;
  if (!pendingAttachment) {
    els.attachmentPreview.hidden = true;
    els.attachmentPreview.innerHTML = '';
    els.attachBtn?.classList.remove('has-file');
    return;
  }
  els.attachmentPreview.hidden = false;
  els.attachBtn?.classList.add('has-file');
  els.attachmentPreview.innerHTML = `
    <div class="attachment-chip">
      <img src="${pendingAttachment.dataUrl}" alt="">
      <span>${pendingAttachment.name}</span>
      <button type="button" id="removeAttachmentBtn" aria-label="Remove attachment">✕</button>
    </div>
    <span style="font-size:11px;color:var(--muted)">Will be edited by the Image Editor model</span>`;
  document.getElementById('removeAttachmentBtn')?.addEventListener('click', () => {
    pendingAttachment = null;
    renderAttachmentPreview();
  });
}

safeInit('image attachment wiring', () => {
  if (els.attachBtn) els.attachBtn.addEventListener('click', () => els.imageUploadInput?.click());
  if (els.imageUploadInput) {
    els.imageUploadInput.addEventListener('change', () => {
      const file = els.imageUploadInput.files?.[0];
      els.imageUploadInput.value = ''; // allow re-selecting the same file later
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        MessageEngine.add('Please choose an image file (PNG, JPG or WebP).', 'system', { skipHistory: true });
        return;
      }
      if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
        MessageEngine.add(`That image is over ${MAX_IMAGE_MB}MB — try a smaller file.`, 'system', { skipHistory: true });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        pendingAttachment = { name: file.name, dataUrl: reader.result };
        renderAttachmentPreview();
        els.userInput?.focus();
      };
      reader.onerror = () => {
        MessageEngine.add("Couldn't read that image — try a different file.", 'system', { skipHistory: true });
      };
      reader.readAsDataURL(file);
    });
  }
});

// ==================== SEND HANDLER ====================
async function sendMessage(text) {
  document.getElementById('emptyState')?.remove();

  if (text.toLowerCase() === '/clear') { clearConversation(); return; }
  if (text.toLowerCase() === '/export') { exportHistory(); return; }

  isGenerating = true;
  lastUserMessage = text;
  updateSendState();

  MessageEngine.add(text, 'user');
  els.typing.hidden = false;
  els.typingText.textContent = `${currentModel.name} is thinking…`;

  try {
    const answer = await ApiEngine.callWithFallback(text);
    els.typing.hidden = true;
    MessageEngine.add(answer, 'bot');
  } catch (err) {
    els.typing.hidden = true;
    MessageEngine.add(`Couldn't reach ${currentModel.name} — ${err.message}`, 'bot', { error: true, retry: text });
    console.error(err);
  } finally {
    isGenerating = false;
    updateSendState();
    els.userInput.focus();
  }
}

// Image generation (prompt only, e.g. Flux / MagicStudio / Pollination).
async function sendImageGen(text) {
  if (!text) return;
  document.getElementById('emptyState')?.remove();
  isGenerating = true; updateSendState();
  MessageEngine.add(text, 'user');
  els.typing.hidden = false;
  els.typingText.textContent = `${currentModel.name} is generating your image…`;
  try {
    const url = await ApiEngine.callMedia(currentModel, text);
    els.typing.hidden = true;
    MessageEngine.addMedia('image', url, { caption: text });
  } catch (err) {
    els.typing.hidden = true;
    MessageEngine.add(`Image generation failed — ${err.message}`, 'bot', { error: true, retry: text });
    console.error(err);
  } finally {
    isGenerating = false; updateSendState(); els.userInput.focus();
  }
}

// Music generation (lyrics/prompt in, MP3 back — Sonu / Sonu Ultra / Sonu 4).
async function sendMusicGen(text) {
  if (!text) return;
  document.getElementById('emptyState')?.remove();
  isGenerating = true; updateSendState();
  MessageEngine.add(text, 'user');
  els.typing.hidden = false;
  els.typingText.textContent = `${currentModel.name} is composing your track…`;
  try {
    const url = await ApiEngine.callMedia(currentModel, text);
    els.typing.hidden = true;
    MessageEngine.addMedia('audio', url, { caption: text });
  } catch (err) {
    els.typing.hidden = true;
    MessageEngine.add(`Music generation failed — ${err.message}`, 'bot', { error: true, retry: text });
    console.error(err);
  } finally {
    isGenerating = false; updateSendState(); els.userInput.focus();
  }
}

// Image editing: always uses the Image Editor model, regardless of which
// model is selected in the sidebar — the 📎 button works from anywhere.
async function sendImageEdit(text, attachment) {
  document.getElementById('emptyState')?.remove();
  const editorConfig = BELBEAUTY_MODELS['image-editor'];
  isGenerating = true; updateSendState();

  const msgDiv = document.createElement('div');
  msgDiv.className = 'msg msg--user';
  const bubble = document.createElement('div');
  bubble.className = 'msg__bubble';
  const thumb = document.createElement('img');
  thumb.src = attachment.dataUrl;
  thumb.alt = attachment.name;
  thumb.style.cssText = 'max-width:180px;border-radius:10px;margin-bottom:8px;display:block';
  bubble.appendChild(thumb);
  bubble.appendChild(document.createTextNode(text || 'Edit this image'));
  msgDiv.appendChild(bubble);
  els.chatBox.appendChild(msgDiv);
  els.chatScroll.scrollTop = els.chatScroll.scrollHeight;

  els.typing.hidden = false;
  els.typingText.textContent = `${editorConfig.name} is editing your photo…`;

  try {
    const url = await ApiEngine.callMedia(editorConfig, text, attachment.dataUrl);
    els.typing.hidden = true;
    MessageEngine.addMedia('image', url, { caption: text || 'Edited image' });
  } catch (err) {
    els.typing.hidden = true;
    MessageEngine.add(`Couldn't edit that image — ${err.message}`, 'bot', { error: true });
    console.error(err);
  } finally {
    isGenerating = false; updateSendState(); els.userInput.focus();
  }
}

function handleSend() {
  const text = els.userInput.value.trim();
  const attachment = pendingAttachment;
  if (isGenerating || (!text && !attachment)) return;

  els.userInput.value = '';
  autoResize();

  if (attachment) {
    pendingAttachment = null;
    renderAttachmentPreview();
    sendImageEdit(text, attachment);
    return;
  }
  if (currentModel.requiresImage) {
    MessageEngine.add('Upload a photo with 📎 first, then tell me how to edit it.', 'system', { skipHistory: true });
    return;
  }
  if (currentModel.media === 'image') { sendImageGen(text); return; }
  if (currentModel.media === 'audio') { sendMusicGen(text); return; }
  sendMessage(text);
}

safeInit('send button wiring', () => {
  if (els.sendBtn) els.sendBtn.addEventListener('click', handleSend);
});

// ==================== HISTORY / CLEAR / EXPORT ====================
function clearConversation() {
  els.chatBox.innerHTML = '';
  chatHistory = [];
  safeStorage.remove(`chat_history_${currentModelKey}`);
  sessionId = `belbeauty_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  safeStorage.set(`session_${currentModelKey}`, sessionId);
  if (els.sessionDisplay) els.sessionDisplay.textContent = sessionId.slice(0, 14) + '…';
  renderEmptyState();
}

function exportHistory() {
  if (!chatHistory.length) { MessageEngine.add('Nothing to export yet.', 'system', { skipHistory: true }); return; }
  const blob = new Blob([JSON.stringify(chatHistory, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `belbeauty-${currentModelKey}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

safeInit('new chat / clear button wiring', () => {
  if (els.newChatBtn) els.newChatBtn.addEventListener('click', clearConversation);
  if (els.clearChatBtn) els.clearChatBtn.addEventListener('click', () => {
    if (confirm('Clear this conversation? This can\'t be undone.')) clearConversation();
  });
});
safeInit('export button wiring', () => {
  if (els.exportChatBtn) els.exportChatBtn.addEventListener('click', exportHistory);
});
safeInit('clear-all-data button wiring', () => {
  if (els.clearDataBtn) els.clearDataBtn.addEventListener('click', () => {
    if (!confirm('Clear all Belbeauty data stored in this browser?')) return;
    safeStorage.keys()
      .filter(k => k.startsWith('belbeauty') || k.startsWith('session_') || k.startsWith('chat_history_'))
      .forEach(k => safeStorage.remove(k));
    window.location.href = 'index.html';
  });
});

// ==================== BOOT ====================
safeInit('chat history rehydration', () => {
  if (chatHistory.length > 0) {
    chatHistory.slice(-20).forEach(msg => {
      // One bad saved entry shouldn't blank out the rest of the conversation.
      try {
        if (msg.media) {
          MessageEngine.addMedia(msg.media, msg.text, { caption: msg.caption, skipHistory: true });
          return;
        }
        const { bubble } = MessageEngine.add(msg.text, msg.who, { skipHistory: true });
        if (msg.who === 'bot' && MessageEngine.containsCode(msg.text)) {
          MessageEngine.attachCodeHandlers(bubble);
        }
      } catch (e) {
        console.warn('Belbeauty: skipped a corrupted saved message:', e);
      }
    });
    if (!els.chatBox.children.length) renderEmptyState();
  } else {
    renderEmptyState();
  }
});

safeInit('final composer state', () => {
  autoResize();
  updateSendState();
  setTimeout(() => els.userInput?.focus(), 400);
});

console.log(`%c💖 Belbeauty Chat — ${currentModel.name} — session ${sessionId.slice(0, 15)}…`, 'color:#ff4d8d;font-weight:bold');
