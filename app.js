/**
 * BELBEAUTY — APP.JS (landing page)
 * @owner Progress Tech — Bamenda, Cameroon
 */

'use strict';

// ==================== CONFIG ====================
// Single source of truth for the growth links, so index.html never hardcodes
// them (that's what let the old build ship a placeholder YouTube handle).
const CONFIG = {
  WHATSAPP_URL: 'https://whatsapp.com/channel/0029Vb7Lk3yAzNbrVaWDOk1P',
  YOUTUBE_URL: 'https://youtube.com/@progresstech12',
  OWNER_WHATSAPP: 'https://wa.me/237698830792',
  UNLOCK_EXPIRY_DAYS: 7
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;

// ==================== THEME ENGINE (dark / light / system) ====================
class ThemeEngine {
  constructor() {
    this.btn = document.getElementById('themeToggle');
    this.stored = safeStorage.get(BELBEAUTY_STORAGE_KEYS.THEME); // 'dark' | 'light' | null (=system)
    this.init();
  }
  systemPref() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  effective() {
    return this.stored || this.systemPref();
  }
  init() {
    this.apply(this.effective());
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!this.stored) this.apply(this.systemPref());
    });
    if (this.btn) this.btn.addEventListener('click', () => this.toggle());
  }
  apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (this.btn) {
      this.btn.textContent = theme === 'dark' ? '🌙' : '☀️';
      this.btn.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
    }
    let meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#07060d' : '#f5f3fa';
  }
  toggle() {
    this.stored = this.effective() === 'dark' ? 'light' : 'dark';
    safeStorage.set(BELBEAUTY_STORAGE_KEYS.THEME, this.stored);
    this.apply(this.stored);
  }
}

// ==================== POPUP GATE ====================
class PopupGate {
  constructor() {
    this.popup = document.getElementById('popupGate');
    this.waBtn = document.getElementById('waFollow');
    this.ytBtn = document.getElementById('ytFollow');
    this.unlockBtn = document.getElementById('unlockBtn');
    this.state = {
      hasWA: safeStorage.get(BELBEAUTY_STORAGE_KEYS.WA) === 'true',
      hasYT: safeStorage.get(BELBEAUTY_STORAGE_KEYS.YT) === 'true',
      unlocked: safeStorage.get(BELBEAUTY_STORAGE_KEYS.UNLOCKED) === 'true',
      unlockTime: parseInt(safeStorage.get(BELBEAUTY_STORAGE_KEYS.UNLOCK_TIME) || '0', 10)
    };
    this.init();
  }
  init() {
    if (!this.popup) return;
    if (this.waBtn) this.waBtn.href = CONFIG.WHATSAPP_URL;
    if (this.ytBtn) this.ytBtn.href = CONFIG.YOUTUBE_URL;

    if (this.state.unlocked && this.isExpired()) this.reset();

    if (this.state.unlocked) {
      this.hide(true);
    } else {
      setTimeout(() => this.show(), 700);
    }
    this.bindEvents();
    this.updateUnlockLabel();
  }
  isExpired() {
    if (!this.state.unlockTime) return false;
    const days = (Date.now() - this.state.unlockTime) / 86400000;
    return days > CONFIG.UNLOCK_EXPIRY_DAYS;
  }
  reset() {
    [BELBEAUTY_STORAGE_KEYS.WA, BELBEAUTY_STORAGE_KEYS.YT, BELBEAUTY_STORAGE_KEYS.UNLOCKED, BELBEAUTY_STORAGE_KEYS.UNLOCK_TIME]
      .forEach(k => safeStorage.remove(k));
    this.state = { hasWA: false, hasYT: false, unlocked: false, unlockTime: 0 };
  }
  show() {
    this.popup.classList.add('show');
    this.popup.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  hide(instant = false) {
    this.popup.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (instant) { this.popup.classList.remove('show'); return; }
    this.popup.classList.add('hide');
    setTimeout(() => this.popup.classList.remove('show', 'hide'), 500);
  }
  bindEvents() {
    if (this.waBtn) this.waBtn.addEventListener('click', () => {
      this.state.hasWA = true;
      safeStorage.set(BELBEAUTY_STORAGE_KEYS.WA, 'true');
      this.waBtn.innerHTML = '✅ Channel opened';
      this.updateUnlockLabel();
    });
    if (this.ytBtn) this.ytBtn.addEventListener('click', () => {
      this.state.hasYT = true;
      safeStorage.set(BELBEAUTY_STORAGE_KEYS.YT, 'true');
      this.ytBtn.innerHTML = '✅ Subscribed';
      this.updateUnlockLabel();
    });
    if (this.unlockBtn) this.unlockBtn.addEventListener('click', () => this.attemptUnlock());
  }
  updateUnlockLabel() {
    if (!this.unlockBtn) return;
    if (this.state.hasWA && this.state.hasYT) {
      this.unlockBtn.textContent = 'Unlock Belbeauty →';
    } else if (this.state.hasWA || this.state.hasYT) {
      this.unlockBtn.textContent = `Almost — open ${!this.state.hasWA ? 'WhatsApp' : 'YouTube'} too`;
    }
  }
  shake() {
    this.unlockBtn.style.animation = 'shake .4s ease';
    setTimeout(() => this.unlockBtn.style.animation = '', 400);
  }
  attemptUnlock() {
    if (!this.state.hasWA || !this.state.hasYT) {
      this.unlockBtn.textContent = 'Please open both links first';
      this.shake();
      setTimeout(() => this.updateUnlockLabel(), 1800);
      return;
    }
    safeStorage.set(BELBEAUTY_STORAGE_KEYS.UNLOCKED, 'true');
    safeStorage.set(BELBEAUTY_STORAGE_KEYS.UNLOCK_TIME, Date.now().toString());
    this.state.unlocked = true;
    this.unlockBtn.textContent = 'Welcome to Belbeauty 🎉';
    setTimeout(() => this.hide(), 500);
  }
}

// ==================== MODEL GRID + STRIP (rendered from models.js) ====================
function renderModels() {
  const grid = document.getElementById('modelGrid');
  const strip = document.getElementById('extendedScroller');
  if (grid) {
    grid.innerHTML = CORE_MODEL_KEYS.map(key => {
      const cfg = BELBEAUTY_MODELS[key];
      return `
        <button class="model-card${cfg.featured ? ' model-card--featured' : ''}" data-model="${key}" type="button">
          <span class="model-card__icon">${cfg.avatar}</span>
          <div class="model-card__title">${cfg.name}</div>
          <div class="model-card__desc">${cfg.description || ''}</div>
          <div class="model-card__foot">
            ${cfg.featured ? '<span class="badge badge-rose">Featured</span>' : '<span class="badge badge-mint">Ready</span>'}
            <span class="model-card__arrow">→</span>
          </div>
        </button>`;
    }).join('');

    grid.querySelectorAll('.model-card').forEach(card => {
      card.addEventListener('click', () => goToChat(card.dataset.model, card));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToChat(card.dataset.model, card); }
      });
    });

    if (!reduceMotion) observeReveal(grid.querySelectorAll('.model-card'));
    else grid.querySelectorAll('.model-card').forEach(c => c.classList.add('in-view'));
  }

  if (strip) {
    strip.innerHTML = Object.entries(BELBEAUTY_MODELS)
      .filter(([k]) => !CORE_MODEL_KEYS.includes(k))
      .map(([key, cfg]) => `<a class="chip" href="chat.html?model=${key}"><span>${cfg.avatar}</span>${cfg.short}</a>`)
      .join('');
  }
}

function goToChat(model, card) {
  if (!model) return;
  safeStorage.set(BELBEAUTY_STORAGE_KEYS.MODEL, model);
  if (card && !reduceMotion) {
    card.style.transform = 'scale(.96)';
    card.style.opacity = '.85';
  }
  setTimeout(() => { window.location.href = `chat.html?model=${model}`; }, reduceMotion ? 0 : 160);
}

function observeReveal(nodes) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        setTimeout(() => entry.target.classList.add('in-view'), i * 60);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  nodes.forEach(n => observer.observe(n));
}

// ==================== HERO TILT (mouse-follow depth) ====================
function initHeroTilt() {
  const visual = document.getElementById('heroVisual');
  const stage = document.getElementById('heroStage');
  if (!visual || !stage || reduceMotion || isCoarsePointer) return;

  let raf = null;
  visual.addEventListener('mousemove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      const rect = visual.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      stage.style.transform = `rotateY(${px * 14}deg) rotateX(${-py * 14}deg)`;
      raf = null;
    });
  });
  visual.addEventListener('mouseleave', () => {
    stage.style.transform = 'rotateY(0deg) rotateX(0deg)';
  });
}

// ==================== INIT ====================
// Each piece is isolated: a failure in one (e.g. the popup gate) must never
// stop the others (e.g. the model grid, or the theme toggle) from working.
function safeInit(label, fn) {
  try { fn(); }
  catch (e) {
    console.error(`Belbeauty: ${label} failed to initialize:`, e);
    if (window.__belbeautyReportError) window.__belbeautyReportError(`${label}: ${e.message}`);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  safeInit('theme engine', () => new ThemeEngine());
  safeInit('popup gate', () => new PopupGate());
  safeInit('model grid render', () => renderModels());
  safeInit('hero tilt', () => initHeroTilt());

  safeInit('footer year', () => {
    const year = document.getElementById('year');
    if (year) year.textContent = new Date().getFullYear();
  });

  safeInit('chat.html prefetch', () => {
    const preload = document.createElement('link');
    preload.rel = 'prefetch';
    preload.href = 'chat.html';
    document.head.appendChild(preload);
  });
});
