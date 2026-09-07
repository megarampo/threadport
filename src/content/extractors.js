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
    '[class*="citation"]', // Perplexity inline source chips
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

  // Filenames as chat UIs show them on attachment chips.
  const FILE_RE =
    /^[\w\-. ()\[\]]{1,120}\.(pdf|docx?|xlsx?|pptx?|csv|tsv|txt|md|json|xml|ya?ml|zip|png|jpe?g|gif|webp|svg|py|js|ts|tsx|jsx|java|c|cpp|h|cs|go|rs|rb|php|html|css|sql|ipynb|log)$/i;

  // User turns render attachments as chips (filename + type/size label) next
  // to the text. Remove the whole chip so only the note we add remains.
  const stripFileChips = (root) => {
    root.querySelectorAll("span, div, a, p").forEach((el) => {
      if (!root.contains(el)) return; // already removed as part of an earlier chip
      const t = (el.textContent || "").trim();
      if (t.length > 130 || !FILE_RE.test(t)) return;
      let node = el;
      while (node.parentElement && node.parentElement !== root) {
        const pt = (node.parentElement.textContent || "").trim();
        if (pt.length > t.length + 24) break;
        node = node.parentElement;
      }
      if (node !== root) node.remove();
    });
  };

  const clean = (el, opts) => {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll(NOISE_SELECTORS).forEach((n) => n.remove());
    if (opts && opts.user) stripFileChips(clone);
    fenceCodeBlocks(clone);
    // innerText only computes line breaks for rendered nodes, so the clone
    // must briefly live in the DOM (off-screen).
    clone.style.position = "absolute";
    clone.style.left = "-99999px";
    document.body.appendChild(clone);
    const text = clone.innerText
      .replace(/ /g, " ")
      .replace(/\n[ \t]+\n/g, "\n\n") // whitespace-only lines (gaps between inline chips)
      .replace(/\n{3,}/g, "\n\n") // collapse blank-line explosions from nested blocks
      .trim();
    clone.remove();
    return text;
  };

  // Language labels that chat UIs render around a code block ("python",
  // "bash"…). ChatGPT and Claude put them inside <pre>, Gemini / Perplexity /
  // Mistral in a header row next to it. Either way they are chrome, not text.
  const LANG_LABELS = new Set(
    (
      "python javascript js typescript ts bash sh shell zsh html css json yaml yml " +
      "sql java c cpp c++ csharp c# go golang rust ruby php swift kotlin r markdown " +
      "md text plaintext plain txt xml toml ini dockerfile docker powershell ps1 jsx " +
      "tsx scss sass lua perl dart scala haskell matlab objective-c objc diff " +
      "makefile nginx http graphql regex code"
    ).split(" ")
  );
  const isLangLabel = (s) => LANG_LABELS.has((s || "").trim().toLowerCase());

  // Rewrite every <pre> as a fenced Markdown block so the destination AI sees
  // real code (and the Markdown export is valid), dropping the label / copy
  // chrome around it. Runs on the detached clone, before innerText.
  const fenceCodeBlocks = (root) => {
    root.querySelectorAll("pre").forEach((pre) => {
      const code = pre.querySelector("code");
      let lang = "";
      const m = /language-([\w+#-]+)/.exec((code && code.className) || "");
      if (m) lang = m[1].toLowerCase();
      const lines = ((code || pre).textContent || "").replace(/\r/g, "").split("\n");
      while (lines.length && !lines[0].trim()) lines.shift();
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      if (!code && lines.length && isLangLabel(lines[0])) {
        lang = lang || lines[0].trim().toLowerCase();
        lines.shift();
      }
      const parent = pre.parentElement;
      if (parent) {
        Array.from(parent.children).forEach((sib) => {
          if (sib !== pre && isLangLabel(sib.textContent)) {
            lang = lang || sib.textContent.trim().toLowerCase();
            sib.remove();
          }
        });
      }
      const fenced = document.createElement("div");
      fenced.style.whiteSpace = "pre-wrap";
      fenced.textContent = "```" + lang + "\n" + lines.join("\n") + "\n```";
      pre.replaceWith(fenced);
    });
  };

  // Attachments never travel (we move text), but the destination AI should
  // know they existed. Detect file chips (an element whose whole text is a
  // filename) and real images (not avatars / icons) inside a user turn.
  const attachmentNotes = (scope) => {
    const notes = [];
    const seen = new Set();
    if (!scope) return notes;
    scope.querySelectorAll("span, div, a, p, button").forEach((el) => {
      const t = (el.textContent || "").trim();
      if (t.length > 130 || !FILE_RE.test(t) || seen.has(t)) return;
      seen.add(t);
      notes.push("[user attached: " + t + "]");
    });
    scope.querySelectorAll("img").forEach((img) => {
      const r = img.getBoundingClientRect();
      if (r.width < 48 || r.height < 48) return;
      const alt = (img.getAttribute("alt") || "").trim();
      const hint = alt + " " + (img.className || "") + " " + (img.currentSrc || img.src || "");
      if (/avatar|emoji|icon|logo|profile/i.test(hint)) return;
      const named = alt && !/^(uploaded image|image|imagen|img)$/i.test(alt);
      const key = "img:" + (named ? alt : "");
      if (seen.has(key)) return;
      seen.add(key);
      notes.push(named ? "[user attached image: " + alt + "]" : "[user attached an image]");
    });
    return notes;
  };
  const withAttachments = (node, text) => {
    const scope = node.closest("article, [data-test-render-count]") || node;
    const notes = attachmentNotes(scope);
    if (!notes.length) return text;
    // A file chip's name often shows up in the text too — keep it once.
    const names = new Set(notes.map((x) => x.replace(/^\[user attached: (.*)\]$/, "$1")));
    const body = (text || "")
      .split("\n")
      .filter((l) => !names.has(l.trim()))
      .join("\n")
      .trim();
    return notes.join("\n") + (body ? "\n" + body : "");
  };

  // ChatGPT turn → {role, text, key}. Shared by the quick extractor and the
  // virtualization sweep so both see the same text and dedupe on the same key.
  const readChatGPTNode = (n) => {
    const role =
      n.getAttribute("data-message-author-role") === "user" ? "user" : "assistant";
    // Prefer the rendered markdown container when present (skips buttons etc).
    const md = n.querySelector(".markdown");
    let text = clean(md || n, { user: role === "user" });
    if (role === "user") text = withAttachments(n, text);
    if (!text) return null;
    const key = n.getAttribute("data-message-id") || role + "|" + text.slice(0, 200);
    return { role, text, key };
  };

  // Some UIs (Mistral, Perplexity) render a timestamp under each user bubble
  // that innerText picks up as a trailing line: "22:15", "2:10 p.m.",
  // "30 ago,", "Aug 30", "ayer"… Drop the last line when it looks like one.
  const STAMP_MONTH =
    "(?:ene(?:ro)?|feb(?:rero|ruary)?|mar(?:zo|ch)?|abr(?:il)?|apr(?:il)?|may(?:o)?|jun(?:io|e)?|jul(?:io|y)?|ago(?:sto)?|aug(?:ust)?|sept?(?:iembre|ember)?|oct(?:ubre|ober)?|nov(?:iembre|ember)?|dic(?:iembre)?|dec(?:ember)?)\.?";
  const STAMP_RE = new RegExp(
    "^(\\d{1,2}:\\d{2}(\\s*[ap]\\.?\\s?m\\.?)?|\\d{1,2}\\s+" +
      STAMP_MONTH +
      ",?|" +
      STAMP_MONTH +
      "\\s+\\d{1,2},?|ayer|yesterday|hoy|today)$",
    "i"
  );
  const stripTrailingStamp = (text) => {
    const lines = text.split("\n");
    while (lines.length > 1 && STAMP_RE.test(lines[lines.length - 1].trim())) {
      lines.pop();
    }
    return lines.join("\n").trim();
  };

  // ---------- ChatGPT ----------
  // data-message-author-role has been stable across redesigns for years.
  function extractChatGPT() {
    const nodes = document.querySelectorAll("[data-message-author-role]");
    const messages = [];
    nodes.forEach((n) => {
      const m = readChatGPTNode(n);
      if (m) messages.push({ role: m.role, text: m.text });
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
      .map((n) => {
        const isUser = n.getAttribute("data-testid") === "user-message";
        const text = clean(n, { user: isUser });
        return { role: isUser ? "user" : "assistant", text: isUser ? withAttachments(n, text) : text };
      })
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
        const text = withAttachments(n, clean(q || n, { user: true }));
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
        const m = readChatGPTNode(n);
        if (!m) return;
        if (!seen.has(m.key)) {
          seen.set(m.key, { role: m.role, text: m.text });
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
      const m = readChatGPTNode(n);
      if (m) tailSnapshot.set(m.key, { role: m.role, text: m.text });
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
      // Assistant text lives in the markdown container; user text in a
      // whitespace-pre-wrap span (the hover row next to it holds a
      // timestamp like "30 ago, 22:46" that must not leak in).
      const body =
        role === "user"
          ? n.querySelector(".whitespace-pre-wrap")
          : n.querySelector('[class*="markdown-container"]');
      let text = clean(body || n, { user: role === "user" });
      if (role === "user") text = withAttachments(n, stripTrailingStamp(text));
      if (text) messages.push({ role, text });
    });
    return messages;
  }

  // ---------- Perplexity ----------
  // Queries render as `group/user-bubble` blocks (with a trailing timestamp
  // like "2:10 p.m."); answers render as `.prose` blocks. Both appear in
  // document order, so one combined query yields the interleaved thread.
  function extractPerplexity() {
    const nodes = document.querySelectorAll(
      '[class~="group/user-bubble"], .prose'
    );
    const messages = [];
    nodes.forEach((n) => {
      const isUser = n.classList.contains("group/user-bubble");
      // User text lives in a whitespace-pre-line span; a sibling span holds
      // the timestamp ("2:10 p.m.") and must not leak in.
      const body = isUser ? n.querySelector(".whitespace-pre-line") : null;
      let text = clean(body || n, { user: isUser });
      if (isUser) text = withAttachments(n, stripTrailingStamp(text));
      if (text) messages.push({ role: isUser ? "user" : "assistant", text });
    });
    return messages;
  }

  const extractors = {
    chatgpt: extractChatGPT,
    claude: extractClaude,
    gemini: extractGemini,
    mistral: extractMistral,
    perplexity: extractPerplexity
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
