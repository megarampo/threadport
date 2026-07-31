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

  const extractors = {
    chatgpt: extractChatGPT,
    claude: extractClaude,
    gemini: extractGemini
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
})();
