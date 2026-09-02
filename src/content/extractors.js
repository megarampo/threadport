// Per-platform conversation extraction via DOM scraping.
// Each platform has an ordered list of strategies; the first one that yields
// messages wins. When a site ships a redesign, add a new strategy at the top
// instead of editing the old one — old strategies keep working as fallbacks
// for users on staged rollouts of the previous UI.
"use strict";

(() => {
  // Elements that pollute innerText: interactive widgets (ChatGPT renders
  // weather/stocks/sports cards inside the message), buttons, icons,
  // screen-reader-only text and citation chips.
  const NOISE_SELECTORS = [
    '[data-testid="dil-widget-shell"]', // ChatGPT inline widgets (weather etc.)
    "button",
    "svg",
    '[class*="sr-only"]',
    '[class*="cdk-visually-hidden"]', // Gemini a11y labels ("Has dicho" / "You said")
    '[class*="screen-reader"]',
    '[data-testid*="citation"]',
    // Gemini in-message components that aren't message text:
    "old-weather-card",
    "sources-list",
    "message-actions",
    "thinking-overlay",
    "election-info-disclaimer",
    "sensitive-memories-banner",
    "freemium-rag-disclaimer",
    "audio",
    "video"
  ].join(", ");

  const clean = (el) => {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll(NOISE_SELECTORS).forEach((n) => n.remove());
    // innerText only computes line breaks for rendered nodes, so the clone
    // must briefly live in the DOM (off-screen).
    clone.style.position = "absolute";
    clone.style.left = "-99999px";
    document.body.appendChild(clone);
    const text = clone.innerText
      .replace(/ /g, " ")
      .replace(/\n{3,}/g, "\n\n") // collapse blank-line explosions from nested blocks
      .trim();
    clone.remove();
    return text;
  };

  // ---------- ChatGPT ----------
  // data-message-author-role has been stable across redesigns for years.
  function extractChatGPT() {
    const nodes = document.querySelectorAll("[data-message-author-role]");
    const messages = [];
    nodes.forEach((n) => {
      const role =
        n.getAttribute("data-message-author-role") === "user"
          ? "user"
          : "assistant";
      // Prefer the rendered markdown container when present (skips buttons etc).
      const md = n.querySelector(".markdown");
      const text = clean(md || n);
      if (text) messages.push({ role, text });
    });
    return messages;
  }

  // ---------- Claude ----------
  function extractClaude() {
    // Strategy 1: explicit testids / message classes.
    const sel =
      '[data-testid="user-message"], .font-claude-message, .font-claude-response';
    let nodes = Array.from(document.querySelectorAll(sel));
    let messages = nodes
      .map((n) => ({
        role:
          n.getAttribute("data-testid") === "user-message"
            ? "user"
            : "assistant",
        text: clean(n)
      }))
      .filter((m) => m.text);
    if (messages.length) return messages;

    // Strategy 2: alternating render-count groups (older layout).
    nodes = Array.from(document.querySelectorAll("[data-test-render-count]"));
    messages = nodes
      .map((n) => {
        const isUser = !!n.querySelector('[data-testid="user-message"]');
        return { role: isUser ? "user" : "assistant", text: clean(n) };
      })
      .filter((m) => m.text);
    return messages;
  }

  // ---------- Gemini ----------
  // Angular custom elements <user-query> / <model-response> appear in DOM order.
  function extractGemini() {
    const nodes = Array.from(
      document.querySelectorAll("user-query, model-response")
    );
    const messages = [];
    nodes.forEach((n) => {
      if (n.tagName.toLowerCase() === "user-query") {
        const q = n.querySelector(".query-text");
        const text = clean(q || n);
        if (text) messages.push({ role: "user", text });
      } else {
        const c = n.querySelector("message-content, .markdown");
        const text = clean(c || n);
        if (text) messages.push({ role: "assistant", text });
      }
    });
    return messages;
  }

  // ---------- ChatGPT full capture (August 2026 virtualization) ----------
  // ChatGPT now loads long conversations in windowed sections: the DOM only
  // holds ~10-30 messages around the viewport, and scrolling loads one end
  // while UNLOADING the other. A plain querySelectorAll therefore sees only
  // the current window. Fix: sweep the scroll container top→bottom, harvesting
  // messages by data-message-id as each section renders, then restore scroll.
  async function sweepChatGPT() {
    const quick = extractChatGPT();
    const probe = document.querySelector("[data-message-author-role]");
    if (!probe) return quick;

    let sc = probe.parentElement;
    while (sc && sc !== document.body) {
      const st = getComputedStyle(sc);
      if (
        (st.overflowY === "auto" || st.overflowY === "scroll") &&
        sc.scrollHeight > sc.clientHeight
      )
        break;
      sc = sc.parentElement;
    }
    // No scrollable container, or the whole thread fits on screen: the quick
    // extraction already saw everything.
    if (!sc || sc === document.body) return quick;
    if (sc.scrollHeight <= sc.clientHeight * 1.2) return quick;

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const seen = new Map();
    const harvest = () => {
      let added = 0;
      document.querySelectorAll("[data-message-author-role]").forEach((n) => {
        const role =
          n.getAttribute("data-message-author-role") === "user"
            ? "user"
            : "assistant";
        const md = n.querySelector(".markdown");
        const text = clean(md || n);
        if (!text) return;
        const key =
          n.getAttribute("data-message-id") || role + "|" + text.slice(0, 200);
        if (!seen.has(key)) {
          seen.set(key, { role, text });
          added++;
        }
      });
      return added;
    };

    // The page opens pinned to the newest messages, and the bottom section can
    // be slow to re-render after the sweep. Snapshot that starting window
    // first; anything the sweep misses gets stitched back at the end.
    const tailSnapshot = new Map();
    document.querySelectorAll("[data-message-author-role]").forEach((n) => {
      const role =
        n.getAttribute("data-message-author-role") === "user"
          ? "user"
          : "assistant";
      const md = n.querySelector(".markdown");
      const text = clean(md || n);
      if (!text) return;
      const key =
        n.getAttribute("data-message-id") || role + "|" + text.slice(0, 200);
      tailSnapshot.set(key, { role, text });
    });

    const originalTop = sc.scrollTop;
    try {
      // Climb to the very top. Older sections prepend and push scrollTop down,
      // so keep re-pinning until it stays at 0 across two checks.
      for (let i = 0; i < 40; i++) {
        sc.scrollTo(0, 0);
        await wait(600);
        if (sc.scrollTop === 0) {
          await wait(600);
          if (sc.scrollTop === 0) break;
        }
      }
      harvest();
      // Walk down harvesting each window. Sections near the bottom can take
      // over a second to render, so only count a round as "dry" when we are
      // pinned at the bottom and still found nothing new.
      let dry = 0;
      for (let guard = 0; guard < 120 && dry < 5; guard++) {
        const atBottom =
          sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 5;
        sc.scrollTo(
          0,
          atBottom ? sc.scrollHeight : sc.scrollTop + sc.clientHeight * 0.7
        );
        await wait(atBottom ? 1200 : 500);
        const added = harvest();
        if (added === 0 && atBottom) dry++;
        else if (added > 0) dry = 0;
      }
    } finally {
      sc.scrollTo(0, originalTop);
    }
    // Stitch: sweep result in conversation order, plus any newest-window
    // messages the sweep didn't reach, appended in their original order.
    tailSnapshot.forEach((m, key) => {
      if (!seen.has(key)) seen.set(key, m);
    });
    const swept = Array.from(seen.values());
    return swept.length >= quick.length ? swept : quick;
  }

  // ---------- Mistral (Vibe, ex Le Chat) ----------
  // Same semantic attributes as ChatGPT. Assistant text lives in a
  // markdown-container (buttons stay outside); user bubbles carry a trailing
  // timestamp ("22:15") that must be stripped.
  function extractMistral() {
    const nodes = document.querySelectorAll("[data-message-author-role]");
    const messages = [];
    nodes.forEach((n) => {
      const role =
        n.getAttribute("data-message-author-role") === "user"
          ? "user"
          : "assistant";
      const md = n.querySelector('[class*="markdown-container"]');
      let text = clean(md || n);
      if (role === "user") text = text.replace(/\s*\d{1,2}:\d{2}\s*$/, "");
      if (text) messages.push({ role, text });
    });
    return messages;
  }

  const extractors = {
    chatgpt: extractChatGPT,
    claude: extractClaude,
    gemini: extractGemini,
    mistral: extractMistral
  };

  globalThis.tpExtract = function (platformId) {
    const fn = extractors[platformId];
    if (!fn) return [];
    try {
      return fn();
    } catch (e) {
      console.warn("[ThreadPort] extraction failed:", e);
      return [];
    }
  };

  // Async variant: on ChatGPT it sweeps the virtualized list to capture the
  // full thread; elsewhere it's the plain synchronous extraction.
  globalThis.tpExtractAsync = async function (platformId) {
    if (platformId === "chatgpt") {
      try {
        return await sweepChatGPT();
      } catch (e) {
        console.warn("[ThreadPort] sweep failed, using quick extraction:", e);
      }
    }
    return globalThis.tpExtract(platformId);
  };
})();
