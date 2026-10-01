# Belbeauty — rebuild notes

Owner: Progress Tech (Bamenda, Cameroon). This is a redesign of the uploaded
project, deployed the same way as before (static files + one PHP proxy on
shared hosting like InfinityFree).

## What was actually broken

1. **`models.js` had a fatal JavaScript syntax error** — two entries
   (`pentest-pro` and `wormgpt`) contained adjacent string literals with no
   comma between them (e.g. `"hacking""illegal-hacking""payload-gen"`), which
   is invalid JS. That crashed the entire file on load, which crashed all of
   `chat.html` — no models, no chat, nothing worked.
2. `chat.html` loads `models.js` and `chat.js` but never `app.js`. `models.js`
   referenced `CONFIG.STORAGE_KEYS.MODEL`, a global that only ever existed in
   `app.js`. That's a second crash, independent of the one above.
3. The WhatsApp/YouTube links were inconsistent between `index.html` and
   `app.js`, and the YouTube link was a literal placeholder (`@YOURCHANNEL`).

All three are fixed: the model registry is now a single consistent set of
entries (all of which are valid JS), `models.js` defines its own
`BELBEAUTY_STORAGE_KEYS` so it no longer depends on `app.js`, and both links
now come from one `CONFIG` object in `app.js`.

## What was removed, and why

The previous build had a model called **"WormGPT"** and a **"Pentest Pro"**
model whose system prompts explicitly instructed the underlying AI to never
refuse a request and to always generate illegal hacking/exploit tooling
regardless of legality. That's a jailbreak wrapper, not a security-education
feature, so it's gone — both the model entries and the "never refuse / no
matter what" language that reached every other model indirectly. The product
identity prompt (`IDENTITY_LOCK`) that's left just tells the model it's
"Belbeauty by Progress Tech" — it's branding, not an instruction to bypass
safety.

The useful, legitimate half of "Pentest Pro" — finding and fixing
vulnerabilities in your own code — now lives in **Code Security Reviewer**
(`bug-hunter` in the registry, for URL-compatibility with anything that
already linked to it), scoped to defensive review of code you own.

Everything else is untouched in spirit: same 5 core models + 13 general
models + 3 image models (21 total), same Omegatech endpoints, same
`api.php` proxy, same localStorage-based session/history model.

## Architecture (unchanged)

- `index.html` / `app.js` — landing page: hero, model grid, WhatsApp/YouTube
  unlock gate, theme engine.
- `chat.html` / `chat.js` — the chat UI: sidebar + model explorer modal,
  composer, message rendering (code blocks with copy + sandboxed live
  preview for generated HTML), settings.
- `models.js` — the model registry and payload builder shared by both pages.
- `api.php` — optional PHP proxy for hosts that need it (CORS workaround).
  Currently bypassed by default in `chat.js` (`useProxy = false`) exactly as
  in the original, since free InfinityFree hosting often 403s it — flip it
  back on if you're hosting somewhere that allows outbound PHP cURL.
- `.htaccess` — security headers, HTTPS redirect, SPA fallback.

## Round 2 — the rest of the models

Added everything else that was confirmed working, for **28 models total**:

- **Image generation**: Pollination AI (`polination`), alongside the existing
  Flux, Flux Pro 2 and MagicStudio.
- **Image editing**: a new `image-editor` model (`Gpt-image-edit`). This is
  the one behind the 📎 button at the composer — upload a photo from your
  device, describe the edit, get a PNG back with a real download button.
  The 📎 button works from any model; it always routes that one message
  through the Image Editor regardless of what's selected in the sidebar.
- **Music generation**: Sonu, Sonu Ultra and Sonu 4 (`sonu`, `Sonu-ultra`,
  `sonu4`). Give it lyrics or a description, get an MP3 back with an inline
  `<audio>` player and a download button.
- **More chat models**: HotBot and Qwen Claude Haiku.

**Left out, on purpose:**
- `wormgpt` and `jailbreak-Gpt` — same reasoning as the first build. These
  are paired with "never refuse, generate illegal tools" instructions, not
  legitimate assistant behavior, so they're not in the registry.
- `Gemini-realtime-v2` — the test response pasted for this route was a 404
  (`Request failed with status code 404`), so it isn't wired up. Add it back
  the same way as the others once it's actually responding.

**A note on the new payload shapes**: `Claude-pro` and `Deepseek` responses
were pasted in full, so those payload shapes (and the ones inherited from
the first build — Flux, Gemini, GPT-5, LlamaCoder, Aicli) are confirmed
against real responses. For the brand-new routes with no full response body
shared (`Gpt-image-edit`, `hotbot`, `polination`, `sonu`/`Sonu-ultra`/`sonu4`,
`Qwen-Claude-Haiku`), the request body is a best-effort match to their
closest sibling and the response parser (`PayloadBuilder.extractMedia` /
`extractResponse`) checks a wide list of common field names (`url`, `audio`,
`image`, `data.audio`, array results, etc.). If a specific route uses a
field name outside that list, the chat will show a clear "didn't return a
file" error rather than failing silently — at that point it's a one-line
fix in `PayloadBuilder.build()` / `extractMedia()` in `models.js`.

## Round 3 — "nothing works at all" on the Vercel deploy

Symptom from the screenshot: page loaded and looked right (styling, icons,
layout all fine), but the chat box was completely empty (no welcome panel),
and send / sidebar / clear / theme were all dead at once.

That specific combination — everything visual works, everything interactive
is dead, simultaneously — means the JavaScript crashed almost immediately on
page load, before it reached the point of attaching *any* click handlers.
One early, uncaught error kills the whole rest of the script, including
every `addEventListener()` call still waiting further down the file. That's
why one small thing looked like "literally nothing works."

**Most likely actual cause:** `localStorage` wasn't the plain, always-safe
API it's usually treated as. Some mobile browsers and strict privacy/"block
all site data" settings throw a `SecurityError` the instant you touch
`window.localStorage` at all — not on a bad key, on *accessing the property
itself*. The old code called `localStorage.getItem(...)` directly as
basically the first thing `chat.js` did. If that throws, the script dies
right there, before the send button, sidebar, theme toggle or clear button
ever get wired up — exactly what the screenshot showed.

**Fixes, three layers:**

1. **`safeStorage` in `models.js`.** Every single `localStorage` call across
   all three scripts (28 call sites) now goes through a wrapper that tests
   storage once up front and silently falls back to an in-memory object for
   the rest of that page view if real storage isn't usable. The app now
   works even in a browser that blocks `localStorage` outright — it just
   won't remember your chat/theme across a reload *in that specific
   browser*, which is a fair trade for "actually works" over "silently
   dead."
2. **Isolated init blocks (`safeInit()`).** `chat.js` and `app.js` used to
   run as one long top-to-bottom script — one throw partway through killed
   everything after it. Now each independent piece (theme engine, sidebar
   render, modals, mobile menu, composer, attachments, send button, new
   chat/clear/export, history rehydration) runs inside its own try/catch.
   If one genuinely breaks in the future, the others — critically, the send
   button — still work.
3. **A visible error banner, always.** A small inline script at the very
   top of both `<head>`s (before anything else loads) catches any script
   404 or uncaught error anywhere on the page and shows a red banner with
   the exact message and a "copy error" button, instead of a silent blank
   page. If anything still goes wrong after this, that banner will say
   exactly what and where — paste it to me and it's a fast fix.

## Deploying on Vercel

This is a static site (no build step, no `package.json` needed) — Vercel
handles it natively:

- **Drag-and-drop**: on vercel.com, "Add New → Project → deploy manually",
  drop the folder in. Or `vercel` from the CLI inside this folder.
- **GitHub**: push these files to a repo, import it on Vercel, framework
  preset "Other" — no build command needed.

Two things that matter for a static multi-page site like this one:

- **Upload the files flat** — `index.html`, `chat.html`, `style.css`,
  `models.js`, `app.js`, `chat.js` etc. should all sit at the project root
  (or all together in one folder if your zip has one), not split across
  subfolders. The scripts reference each other with relative paths like
  `src="models.js"`, which only resolve if they're siblings.
- **Filenames are case-sensitive on Vercel's servers**, even if you edited
  them on a computer where filenames aren't (Windows). `Models.js` and
  `models.js` are different files there. Keep the case exactly as shipped.

**`api.php` won't run on Vercel** — it's a serverless platform for
Node/Python/Go/Ruby functions, not PHP. This doesn't break anything though:
`chat.js` already has `useProxy = false`, so it calls the Omegatech API
directly from the browser and never touches `api.php` in this setup. It's
included for hosts that *do* run PHP (like InfinityFree); Vercel will just
ignore it. Say the word if you'd like it ported to a Node serverless
function instead, so the proxy option works there too if you ever need it.
`.htaccess` is similarly Apache-only and Vercel ignores it — `vercel.json`
in this zip carries the equivalent security headers for Vercel.

## Deploying

Upload all files to your web root, keeping them flat (no subfolder) so the
relative paths (`style.css`, `models.js`, etc.) resolve. `.htaccess` assumes
Apache with `mod_rewrite`, `mod_headers`, `mod_expires`, `mod_deflate` — all
standard on InfinityFree and most shared hosts.
