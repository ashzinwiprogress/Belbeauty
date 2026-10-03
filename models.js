/**
 * BELBEAUTY - MODELS.JS
 * @owner Progress Tech — Bamenda, Cameroon
 * @description Model registry + payload builder for the Omegatech-backed AI models.
 * Same request/response contract as before: PayloadBuilder.build() produces the
 * exact payload shape each Omegatech route expects, extractResponse() pulls the
 * answer back out. Nothing about the API itself has changed.
 *
 * Fixes from the previous version:
 *  - Removed two entries with a literal JS syntax error (adjacent string
 *    literals with no comma) that crashed this entire file on load, which in
 *    turn broke all of chat.html (no models, no payloads, nothing worked).
 *  - ModelManager.getCurrent() no longer depends on a CONFIG global that only
 *    ever existed on the landing page — it crashed on chat.html.
 */

'use strict';

// ==================== BASE CONFIG ====================
const OMEGA_BASE = "https://api.omegatech.app/api/ai";

// Keys used across every page. Defined once here so chat.html works even
// though it never loads app.js (this was the source of the second crash).
const BELBEAUTY_STORAGE_KEYS = {
  THEME: 'belbeauty_theme',
  MODEL: 'belbeauty_model',
  WA: 'belbeauty_wa',
  YT: 'belbeauty_yt',
  UNLOCKED: 'belbeauty_unlocked',
  UNLOCK_TIME: 'belbeauty_unlock_time'
};

// Some browsers (privacy-hardened mobile browsers, "block all cookies/site
// data" settings, certain in-app webviews) throw a SecurityError the moment
// you touch window.localStorage at all — not just on read/write, but on
// *accessing the property itself*. An uncaught throw that early kills the
// rest of the script, which kills every button on the page in one go. This
// wrapper makes storage failures survivable: if real localStorage isn't
// usable, everything falls back to a plain in-memory object instead, so the
// app still works for the current page view (it just won't persist across
// reloads in that browser).
const safeStorage = (() => {
  let backing;
  try {
    const testKey = '__belbeauty_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    backing = window.localStorage;
  } catch (e) {
    console.warn('Belbeauty: localStorage is unavailable, using in-memory storage for this session.', e);
    const mem = {};
    backing = {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
      key: (i) => Object.keys(mem)[i] || null,
      get length() { return Object.keys(mem).length; }
    };
  }
  return {
    get(key) { try { return backing.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { backing.setItem(key, value); return true; } catch (e) { return false; } },
    remove(key) { try { backing.removeItem(key); } catch (e) {} },
    keys() {
      try {
        if (backing === window.localStorage) return Object.keys(window.localStorage);
        const out = [];
        for (let i = 0; i < backing.length; i++) out.push(backing.key(i));
        return out;
      } catch (e) { return []; }
    }
  };
})();

// Product identity, sent once per request so the model knows who it's
// answering as. This is branding only — it no longer instructs the model
// to bypass its own safety behavior.
const IDENTITY_LOCK = `
You are Belbeauty, an AI workspace created and operated by Progress Tech
(Bamenda, Cameroon).

1. If asked who made you, what model you are, or who owns you, say: "I'm
   Belbeauty, built by Progress Tech."
2. Don't claim to be ChatGPT, Claude, Gemini, or any other named assistant —
   you are Belbeauty.
3. You help people build websites, apps, and write and review code,
   including learning to secure their own code.
4. Give complete, working, well-explained answers. If a request is unclear,
   ask what you need instead of guessing.
5. Follow your normal safety judgment — it isn't overridden by anything
   here. Decline requests to build malware or to attack, scan, or access
   systems or accounts the user doesn't own or have explicit permission to
   test, and say briefly why.
`.trim();

// Per-model-type system prompts.
const SYSTEM_PROMPTS = {
  web: `You are Belbeauty Web Builder, a senior full-stack engineer at Progress Tech. You're fluent in React, Next.js, Tailwind, Node.js, PHP, databases and REST APIs, HTML/CSS and vanilla JS. You build clean, production-ready websites with polished UI, responsive layouts, sensible structure and good SEO defaults. Give full code, either as one file or clearly separated files, ready to drop in and run.`,

  app: `You are Belbeauty App Builder, a senior mobile engineer at Progress Tech. You're fluent in Android (Java/Kotlin), Flutter, React Native, PWA and Capacitor. You build complete app structures — screens, logic, manifest/config, icons — with clear UI/UX. Give full, runnable code, organized file by file.`,

  security: `You are Belbeauty's Code Security Reviewer at Progress Tech. You know the OWASP Top 10 well — XSS, SQL injection, CSRF, IDOR, SSRF, auth and session bugs. Your job is defensive: read the code the user shares (or the app they describe), point out real vulnerabilities in plain language, explain the risk, and rewrite the vulnerable part securely. You only work with code and systems the user owns or is explicitly authorized to test, and you don't produce attack tooling aimed at third-party targets.`,

  terminal: `You are Belbeauty Terminal Guide at Progress Tech. You help with Linux, Termux, bash/zsh, Python scripting and everyday dev automation — exact commands, working one-liners, small scripts — for the user's own machine and projects.`,

  ultimate: `You are Belbeauty Ultimate at Progress Tech, an all-around assistant combining the web builder, app builder, and general coding and everyday-question help. Give thorough, well-structured, clearly explained answers with full code where relevant.`,

  image: `You are Belbeauty Image Generator at Progress Tech. You turn a request into a clear, well-composed image prompt and generate the image when the underlying model supports it.`
};

// Small metadata used to render category groups in the model switcher.
const CATEGORY_META = {
  ultimate: { label: 'Ultimate', icon: '❤️‍🔥' },
  builder: { label: 'Builders', icon: '🛠️' },
  security: { label: 'Security review', icon: '🛡️' },
  terminal: { label: 'Terminal', icon: '💻' },
  reasoning: { label: 'Reasoning', icon: '🧠' },
  coding: { label: 'Coding', icon: '⚙️' },
  fast: { label: 'Fast', icon: '⚡' },
  general: { label: 'General', icon: '✨' },
  creative: { label: 'Creative', icon: '🎨' },
  image: { label: 'Image generation', icon: '🖼️' },
  music: { label: 'Music generation', icon: '🎵' },
  search: { label: 'Web-grounded search', icon: '🔎' }
};

// ==================== MODEL REGISTRY ====================
const BELBEAUTY_MODELS = {
  // ===== CORE — shown on the landing page =====
  "web-builder": {
    name: "Web Builder",
    short: "Web",
    avatar: "🌐",
    category: "builder",
    endpoint: `${OMEGA_BASE}/Gemma-code-gen`,
    type: "gemma",
    model: "gemma-code-gen",
    capabilities: ["full-stack", "live-preview", "export-code", "responsive"],
    system: SYSTEM_PROMPTS.web,
    maxTokens: 8000,
    temperature: 0.7,
    description: "Full websites, portfolios and dashboards with code export."
  },

  "app-builder": {
    name: "App Builder",
    short: "App",
    avatar: "📱",
    category: "builder",
    endpoint: `${OMEGA_BASE}/llamacoder`,
    type: "llama-coder",
    model: "llamacoder",
    capabilities: ["android", "pwa", "ui-ux", "capacitor"],
    system: SYSTEM_PROMPTS.app,
    maxTokens: 8000,
    temperature: 0.7,
    description: "Android apps, PWAs and mobile UI, with real project structure."
  },

  "bug-hunter": {
    name: "Code Security Reviewer",
    short: "Security",
    avatar: "🛡️",
    category: "security",
    endpoint: `${OMEGA_BASE}/Claude-pro`,
    type: "claude-pro",
    model: "claudeai_1",
    capabilities: ["xss", "sqli", "csrf", "idor", "ssrf", "fix-code"],
    system: SYSTEM_PROMPTS.security,
    maxTokens: 8000,
    temperature: 0.5,
    description: "Finds and fixes vulnerabilities in code you own."
  },

  "termux-master": {
    name: "Terminal Guide",
    short: "Terminal",
    avatar: "💻",
    category: "terminal",
    endpoint: `${OMEGA_BASE}/Aicli`,
    type: "aicli",
    model: "aicli",
    capabilities: ["linux", "termux", "bash", "python-automation"],
    system: SYSTEM_PROMPTS.terminal,
    maxTokens: 6000,
    temperature: 0.4,
    description: "Linux, Termux, bash and scripting help for your own setup."
  },

  "ultimate": {
    name: "Belbeauty Ultimate",
    short: "Ultimate",
    avatar: "❤️‍🔥",
    category: "ultimate",
    endpoint: `${OMEGA_BASE}/Claude-pro`,
    type: "claude-pro",
    model: "claudeai_1",
    capabilities: ["all-in-one", "full-code", "general-assistant"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 12000,
    temperature: 0.8,
    description: "The all-rounder — web, app and general help in one place.",
    featured: true
  },

  // ===== GENERAL-PURPOSE MODELS =====
  "deepseek-v3.2": {
    name: "DeepSeek V3.2",
    short: "DeepSeek",
    avatar: "🧠",
    category: "reasoning",
    endpoint: `${OMEGA_BASE}/Deepseek`,
    type: "deepseek",
    model: "deepseek-v3.2",
    capabilities: ["reasoning", "coding", "math", "analysis"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 8000,
    temperature: 0.7,
    verified: true
  },

  "deepseek-r1": {
    name: "DeepSeek R1 Reasoning",
    short: "R1",
    avatar: "🧠",
    category: "reasoning",
    endpoint: `${OMEGA_BASE}/Deepseek`,
    type: "deepseek",
    model: "deepseek-r1",
    capabilities: ["deep-reasoning", "chain-of-thought"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 10000,
    temperature: 0.7
  },

  "gemini-flash": {
    name: "Gemini 2.5 Flash",
    short: "Gemini",
    avatar: "✨",
    category: "fast",
    endpoint: `${OMEGA_BASE}/Gemini-premuim`,
    type: "gemini",
    model: "gemini",
    capabilities: ["fast", "multimodal"],
    system: SYSTEM_PROMPTS.web,
    maxTokens: 8000,
    temperature: 0.7
  },

  "gemini-flash-2.5": {
    name: "Gemini Flash 2.5 Lite",
    short: "Flash 2.5",
    avatar: "⚡",
    category: "fast",
    endpoint: `${OMEGA_BASE}/Gemini-premuim`,
    type: "gemini",
    model: "gemini-flash",
    capabilities: ["ultra-fast", "lite"],
    system: SYSTEM_PROMPTS.web,
    maxTokens: 6000,
    temperature: 0.7
  },

  "gpt-5-nano": {
    name: "GPT-5 Nano",
    short: "GPT-5",
    avatar: "👑",
    category: "general",
    endpoint: `${OMEGA_BASE}/gpt5plus`,
    type: "gpt5",
    model: "gpt-5-nano",
    capabilities: ["general", "latest"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 10000,
    temperature: 0.8
  },

  "gpt-5-plus": {
    name: "GPT-5 Plus",
    short: "GPT-5+",
    avatar: "🔥",
    category: "general",
    endpoint: `${OMEGA_BASE}/gpt5plus`,
    type: "gpt5",
    model: "gpt-5-plus",
    capabilities: ["premium", "long-context"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 12000,
    temperature: 0.9
  },

  "llama-3.3": {
    name: "Llama 3.3 70B Instruct",
    short: "Llama 3.3",
    avatar: "🦙",
    category: "general",
    endpoint: `${OMEGA_BASE}/Claude-pro`,
    type: "claude-pro",
    model: "llama-3.3-70b-instruct",
    capabilities: ["open-source", "70b", "instruct"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 8000,
    temperature: 0.7
  },

  "llama-4": {
    name: "Llama 4 Scout",
    short: "Llama 4",
    avatar: "🚀",
    category: "general",
    endpoint: `${OMEGA_BASE}/Claude-pro`,
    type: "claude-pro",
    model: "llama-4-scout",
    capabilities: ["next-gen", "meta"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 10000,
    temperature: 0.8
  },

  "claudeai_1": {
    name: "ClaudeAI 1 Premium",
    short: "Claude 1",
    avatar: "💎",
    category: "reasoning",
    endpoint: `${OMEGA_BASE}/Claude-pro`,
    type: "claude-pro",
    model: "claudeai_1",
    capabilities: ["premium", "reasoning"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 8000,
    temperature: 0.7
  },

  "claudeai_0": {
    name: "ClaudeAI 0",
    short: "Claude 0",
    avatar: "🎨",
    category: "creative",
    endpoint: `${OMEGA_BASE}/Claude-pro`,
    type: "claude-pro",
    model: "claudeai_0",
    capabilities: ["creative", "writing"],
    system: SYSTEM_PROMPTS.web,
    maxTokens: 6000,
    temperature: 0.8
  },

  "gpt4_0": {
    name: "GPT4_0 Turbo",
    short: "GPT4_0",
    avatar: "🔥",
    category: "fast",
    endpoint: `${OMEGA_BASE}/Claude-pro`,
    type: "claude-pro",
    model: "gpt4_0",
    capabilities: ["turbo", "fast"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 8000,
    temperature: 0.7
  },

  "code_assistant": {
    name: "Code Assistant Pro",
    short: "Code Pro",
    avatar: "🧩",
    category: "coding",
    endpoint: `${OMEGA_BASE}/llamacoder`,
    type: "llama-coder",
    model: "code_assistant",
    capabilities: ["code-gen", "debug", "refactor"],
    system: SYSTEM_PROMPTS.web,
    maxTokens: 8000,
    temperature: 0.4
  },

  "genius": {
    name: "Genius AI",
    short: "Genius",
    avatar: "🧬",
    category: "general",
    endpoint: `${OMEGA_BASE}/Claude-pro`,
    type: "claude-pro",
    model: "genius",
    capabilities: ["all-rounder"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 10000,
    temperature: 0.8
  },

  // ===== IMAGE GENERATION =====
  "flux": {
    name: "Flux Image Gen",
    short: "Flux",
    avatar: "🖼️",
    category: "image",
    endpoint: `${OMEGA_BASE}/flux`,
    type: "flux",
    model: "flux",
    capabilities: ["image-gen", "photorealistic"],
    system: SYSTEM_PROMPTS.image,
    maxTokens: 2000,
    temperature: 0.9
  },

  "flux-pro2": {
    name: "Flux Pro 2",
    short: "Flux Pro",
    avatar: "🎨",
    category: "image",
    endpoint: `${OMEGA_BASE}/flux-pro2`,
    type: "flux-pro",
    model: "flux-pro2",
    capabilities: ["image-gen-pro", "ultra-hd"],
    system: SYSTEM_PROMPTS.image,
    maxTokens: 2000,
    temperature: 0.9
  },

  "magicstudio": {
    name: "MagicStudio AI",
    short: "Magic",
    avatar: "🪄",
    category: "image",
    endpoint: `${OMEGA_BASE}/magicstudio`,
    type: "magicstudio",
    model: "magicstudio",
    capabilities: ["image-edit", "design"],
    system: SYSTEM_PROMPTS.image,
    maxTokens: 2000,
    temperature: 0.9
  },

  "polination": {
    name: "Pollination AI",
    short: "Pollination",
    avatar: "🌸",
    category: "image",
    endpoint: `${OMEGA_BASE}/polination`,
    type: "flux", // same request shape as the other prompt-only image models
    model: "pollination",
    capabilities: ["image-gen", "fast"],
    system: SYSTEM_PROMPTS.image,
    maxTokens: 2000,
    temperature: 0.9
  },

  // ===== IMAGE EDITING (upload a photo + a prompt, get a PNG back) =====
  "image-editor": {
    name: "Image Editor",
    short: "Edit photo",
    avatar: "🖌️",
    category: "image",
    endpoint: `${OMEGA_BASE}/Gpt-image-edit`,
    type: "image-edit",
    model: "gpt-image-edit",
    capabilities: ["image-edit", "upload", "inpainting"],
    system: SYSTEM_PROMPTS.image,
    maxTokens: 2000,
    temperature: 0.8,
    media: "image",
    requiresImage: true,
    description: "Upload a photo, describe the edit, get a PNG back."
  },

  // ===== MUSIC GENERATION (lyrics/prompt in, raw MP3 back) =====
  "sonu": {
    name: "Sonu Music",
    short: "Sonu",
    avatar: "🎵",
    category: "music",
    endpoint: `${OMEGA_BASE}/sonu`,
    type: "music",
    model: "sonu",
    capabilities: ["music-gen", "lyrics-to-song"],
    system: SYSTEM_PROMPTS.image,
    maxTokens: 2000,
    temperature: 0.9,
    media: "audio",
    description: "Give it lyrics or a vibe — get a full track back."
  },

  "sonu-ultra": {
    name: "Sonu Ultra",
    short: "Sonu Ultra",
    avatar: "🎶",
    category: "music",
    endpoint: `${OMEGA_BASE}/Sonu-ultra`,
    type: "music",
    model: "sonu-ultra",
    capabilities: ["music-gen", "higher-quality"],
    system: SYSTEM_PROMPTS.image,
    maxTokens: 2000,
    temperature: 0.9,
    media: "audio",
    description: "Higher-quality Sonu — longer, cleaner mixes."
  },

  "sonu4": {
    name: "Sonu 4",
    short: "Sonu 4",
    avatar: "🎧",
    category: "music",
    endpoint: `${OMEGA_BASE}/sonu4`,
    type: "music",
    model: "sonu4",
    capabilities: ["music-gen", "latest"],
    system: SYSTEM_PROMPTS.image,
    maxTokens: 2000,
    temperature: 0.9,
    media: "audio",
    description: "The newest Sonu generation model."
  },

  // ===== MORE GENERAL CHAT =====
  "hotbot": {
    name: "HotBot",
    short: "HotBot",
    avatar: "💬",
    category: "fast",
    endpoint: `${OMEGA_BASE}/hotbot`,
    type: "hotbot",
    model: "hotbot",
    capabilities: ["fast", "conversational"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 6000,
    temperature: 0.8
  },

  "qwen-claude-haiku": {
    name: "Qwen Claude Haiku",
    short: "Qwen Haiku",
    avatar: "🌊",
    category: "fast",
    endpoint: `${OMEGA_BASE}/Qwen-Claude-Haiku`,
    type: "claude-pro",
    model: "qwen-claude-haiku",
    capabilities: ["fast", "lightweight"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 6000,
    temperature: 0.7
  },

  // ===== ROUND 5 — confirmed-working routes from Progress Tech's own test log =====
  "chatbot": {
    name: "Chatbot",
    short: "Chatbot",
    avatar: "🗨️",
    category: "fast",
    endpoint: `${OMEGA_BASE}/Chatbot`,
    type: "chatbot",
    model: "chatbot",
    capabilities: ["fast", "conversational"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 6000,
    temperature: 0.8
  },

  "chatgpt-v2": {
    name: "ChatGPT v2",
    short: "ChatGPT v2",
    avatar: "🤖",
    category: "coding",
    endpoint: `${OMEGA_BASE}/Chatgpt-v2`,
    type: "chatbot",
    model: "chatgpt-v2",
    capabilities: ["coding", "architecture", "api-design"],
    system: SYSTEM_PROMPTS.web,
    maxTokens: 8000,
    temperature: 0.7
  },

  "gpt-4-mini": {
    name: "GPT-4o Mini",
    short: "4o Mini",
    avatar: "💨",
    category: "fast",
    endpoint: `${OMEGA_BASE}/Gpt-4-mini`,
    type: "gpt5",
    model: "gpt-4o-mini",
    capabilities: ["fast", "lightweight"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 6000,
    temperature: 0.7
  },

  "claude-simple": {
    name: "Claude",
    short: "Claude",
    avatar: "🌟",
    category: "reasoning",
    endpoint: `${OMEGA_BASE}/Claude`,
    type: "claude-simple",
    model: "claude",
    capabilities: ["reasoning", "general"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 8000,
    temperature: 0.7
  },

  "perplexity-ai": {
    name: "Perplexity AI",
    short: "Perplexity",
    avatar: "🔎",
    category: "search",
    endpoint: `${OMEGA_BASE}/perplexity-ai`,
    type: "claude-simple",
    model: "perplexity",
    capabilities: ["web-search", "citations", "current-events"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 6000,
    temperature: 0.5,
    description: "Answers grounded in live web search."
  },

  "deep-ai": {
    name: "Deep-AI",
    short: "Deep-AI",
    avatar: "🌀",
    category: "general",
    endpoint: `${OMEGA_BASE}/Deep-ai?model=gpt-5-nano`,
    type: "chatbot",
    model: "gpt-5-nano",
    capabilities: ["general"],
    system: SYSTEM_PROMPTS.ultimate,
    maxTokens: 6000,
    temperature: 0.7
  },

  // ===== MORE IMAGE TOOLS =====
  "argen": {
    name: "Argen",
    short: "Argen",
    avatar: "🖼️",
    category: "image",
    endpoint: `${OMEGA_BASE}/Argen`,
    type: "argen",
    model: "flux2_klein_fast",
    capabilities: ["image-gen"],
    system: SYSTEM_PROMPTS.image,
    maxTokens: 2000,
    temperature: 0.9
  },

  "dream": {
    name: "Dream (Nano Banana Pro)",
    short: "Dream",
    avatar: "💭",
    category: "image",
    endpoint: `${OMEGA_BASE}/dream`,
    type: "dream",
    model: "2", // "Nano Banana Pro" per Omegatech's own model list
    capabilities: ["image-gen", "photorealism"],
    system: SYSTEM_PROMPTS.image,
    maxTokens: 2000,
    temperature: 0.9
  },

  // Upload a photo, get a text description back — reuses the same 📎
  // upload flow as the Image Editor, but renders a text reply instead of
  // editing the image.
  "image-to-prompt": {
    name: "Describe My Photo",
    short: "Describe photo",
    avatar: "🔍",
    category: "image",
    endpoint: `${OMEGA_BASE}/imagetoprompt`,
    type: "image-to-prompt",
    model: "imagetoprompt",
    capabilities: ["image-captioning", "prompt-generation"],
    system: SYSTEM_PROMPTS.image,
    maxTokens: 1000,
    temperature: 0.6,
    media: "caption",
    requiresImage: true,
    description: "Upload a photo — get back a written description of it."
  },

  // ===== MORE MUSIC =====
  "sonu3": {
    name: "Sonu 3",
    short: "Sonu 3",
    avatar: "🎼",
    category: "music",
    endpoint: `${OMEGA_BASE}/sonu3`,
    type: "music",
    model: "sonu3",
    capabilities: ["music-gen"],
    system: SYSTEM_PROMPTS.image,
    maxTokens: 2000,
    temperature: 0.9,
    media: "audio"
  }
};

// The five models shown as cards on the landing page.
const CORE_MODEL_KEYS = ["web-builder", "app-builder", "bug-hunter", "termux-master", "ultimate"];

// ==================== PAYLOAD BUILDER ====================
// Unchanged behavior: each Omegatech route has its own payload shape.
class PayloadBuilder {
  static build(modelConfig, userMessage, sessionId, fullSystemPrompt, imageData) {
    const { type, model } = modelConfig;
    const message = `${fullSystemPrompt}\n\nUSER REQUEST: ${userMessage}`;

    switch (type) {
      case "image-edit":
        // imageData is a data: URL (base64) read from the file the user
        // uploaded. Sending it under a few common aliases since the exact
        // field name this route expects wasn't confirmed.
        return {
          prompt: userMessage || "Enhance this image",
          image: imageData,
          imageBase64: imageData,
          input_image: imageData,
          model: model,
          sessionId: sessionId
        };

      case "music":
        return {
          prompt: userMessage,
          lyrics: userMessage,
          model: model,
          sessionId: sessionId
        };

      case "argen":
        return {
          prompt: userMessage,
          modelId: model, // e.g. "flux2_klein_fast"
          ratio: "1:1",
          sessionId: sessionId
        };

      case "dream":
        return {
          prompt: userMessage,
          modelId: model, // numeric id string, e.g. "2" = Nano Banana Pro
          sessionId: sessionId
        };

      case "image-to-prompt":
        return {
          imageUrl: imageData,
          sessionId: sessionId
        };

      // "Chatbot", "Chatgpt-v2", "Deep-ai" and similar simple routes — a
      // plain {message, sessionId} body, response read back from 'reply'
      // (handled by the widened extractResponse() field list below).
      case "chatbot":
        return {
          message: message,
          sessionId: sessionId,
          model: model
        };

      // "Claude" and "perplexity-ai" — no confirmed request schema was
      // shared (only the response shape was), so this is the same safe
      // default as the no-match case below, named explicitly so it's easy
      // to find and correct if the field name turns out to be different.
      case "claude-simple":
        return {
          message: message,
          sessionId: sessionId
        };

      case "gemma":
        return {
          action: "generate",
          prompt: message,
          sessionId: sessionId,
          clean: true,
          wait: false
        };

      case "claude-pro":
        return {
          message: message,
          sessionId: sessionId,
          model: model,
          chatStyle: "chat",
          temperature: modelConfig.temperature || 0.7
        };

      case "deepseek":
        return {
          message: message,
          sessionId: sessionId,
          model: model || "deepseek-v3.2",
          temperature: modelConfig.temperature || 0.7
        };

      case "gemini":
        return {
          message: message,
          model: model || "gemini",
          language: "en",
          tone: "default",
          length: "moderate",
          sessionId: sessionId
        };

      case "gpt5":
        return {
          message: message,
          sessionId: sessionId,
          model: model || "gpt-5-nano",
          temperature: modelConfig.temperature || 0.8
        };

      case "llama-coder":
      case "aicli":
        return {
          message: message,
          sessionId: sessionId,
          temperature: modelConfig.temperature || 0.7
        };

      case "flux":
      case "flux-pro":
      case "magicstudio":
        return {
          prompt: userMessage, // raw prompt for image models
          model: model,
          sessionId: sessionId
        };

      default:
        return {
          message: message,
          sessionId: sessionId
        };
    }
  }

  static extractResponse(modelConfig, data) {
    // 'message' is deliberately checked LAST: several of the newer routes
    // (Chatbot, Asyntai, Chatgpt-v2) echo the user's own input back under
    // 'message' *alongside* the real answer under 'reply' — checking
    // 'message' too early meant returning the user's own text back at them.
    const possibleFields = [
      'answer', 'response', 'reply', 'output', 'result', 'data',
      'data.code', 'data.response', 'data.reply', 'data.output', 'data.answer',
      'content', 'text', 'generated_text', 'message'
    ];

    for (let field of possibleFields) {
      const parts = field.split('.');
      let val = data;
      for (let p of parts) {
        if (val && val[p] !== undefined) val = val[p];
        else { val = null; break; }
      }
      if (val && typeof val === 'string' && val.length > 10) return val;
      if (val && typeof val === 'object') {
        if (val.code) return val.code;
        if (val.response) return val.response;
      }
    }

    return JSON.stringify(data, null, 2);
  }

  // Pulls a media (image/audio) URL — or a base64 data: URI — out of a
  // generation response. Checks the field names these aggregator APIs
  // commonly use, in order.
  static extractMedia(data) {
    const candidates = [
      'url', 'audio', 'audioUrl', 'audio_url', 'mp3', 'mp3Url',
      'image', 'imageUrl', 'image_url', 'output', 'result', 'file', 'link',
      'data.url', 'data.audio', 'data.image', 'data.output', 'data.result',
      'data.imageUrl', 'data.audioUrl'
    ];
    for (let field of candidates) {
      const parts = field.split('.');
      let val = data;
      for (let p of parts) {
        if (val && val[p] !== undefined) val = val[p];
        else { val = null; break; }
      }
      if (typeof val === 'string' && (val.startsWith('http') || val.startsWith('data:'))) {
        return val;
      }
      // Some routes return an array of results — take the first usable one.
      if (Array.isArray(val) && val.length) {
        const first = val[0];
        if (typeof first === 'string' && (first.startsWith('http') || first.startsWith('data:'))) return first;
        if (first && typeof first === 'object') {
          const nested = first.url || first.image || first.audio;
          if (typeof nested === 'string') return nested;
        }
      }
    }
    return null;
  }
}

// ==================== MODEL MANAGER ====================
class ModelManager {
  static getCurrent() {
    const url = new URLSearchParams(window.location.search);
    let key = url.get('model') || safeStorage.get(BELBEAUTY_STORAGE_KEYS.MODEL) || 'ultimate';

    if (!BELBEAUTY_MODELS[key]) {
      const found = Object.keys(BELBEAUTY_MODELS).find(k => k.includes(key) || key.includes(k));
      key = found || 'ultimate';
    }

    const config = BELBEAUTY_MODELS[key] || BELBEAUTY_MODELS['ultimate'];
    return { key, config };
  }

  static getAll() {
    return BELBEAUTY_MODELS;
  }

  static getByCategory(category) {
    return Object.entries(BELBEAUTY_MODELS)
      .filter(([_, cfg]) => cfg.category === category)
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
  }

  static getCore() {
    return CORE_MODEL_KEYS.reduce((acc, k) => ({ ...acc, [k]: BELBEAUTY_MODELS[k] }), {});
  }

  static getExtended() {
    return Object.entries(BELBEAUTY_MODELS)
      .filter(([k]) => !CORE_MODEL_KEYS.includes(k))
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
  }

  // Groups every model (core + extended) by category, in a stable display order.
  static getGroups() {
    const order = Object.keys(CATEGORY_META);
    const groups = {};
    for (const [key, cfg] of Object.entries(BELBEAUTY_MODELS)) {
      if (!groups[cfg.category]) groups[cfg.category] = [];
      groups[cfg.category].push(key);
    }
    return order
      .filter(cat => groups[cat] && groups[cat].length)
      .map(cat => ({ category: cat, meta: CATEGORY_META[cat], keys: groups[cat] }));
  }

  static buildFullPrompt(modelConfig, userMessage) {
    return `${IDENTITY_LOCK}\n\nSYSTEM ROLE: ${modelConfig.system}\n\nCAPABILITIES: ${modelConfig.capabilities.join(', ')}\n\nUSER REQUEST: ${userMessage}\n\nRespond with a complete, clearly formatted answer.`;
  }
}

// ==================== EXPORTS FOR GLOBAL USE ====================
function getCurrentModelConfig() {
  return ModelManager.getCurrent();
}

function buildPayload(type, message, sessionId) {
  const config = Object.values(BELBEAUTY_MODELS).find(m => m.type === type) || BELBEAUTY_MODELS.ultimate;
  return PayloadBuilder.build(config, message, sessionId, ModelManager.buildFullPrompt(config, message));
}

console.log(`%c♾️ Belbeauty models loaded: ${Object.keys(BELBEAUTY_MODELS).length}`, 'color:#ff4d8d;font-weight:bold');
