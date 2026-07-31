// Platform registry shared by content scripts, popup and background.
// Everything DOM-specific lives in extractors.js / injector.js; this file
// only knows identity, URLs and display metadata.
"use strict";

const TP_PLATFORMS = {
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    newChatUrl: "https://chatgpt.com/",
    hosts: ["chatgpt.com", "chat.openai.com"]
  },
  claude: {
    id: "claude",
    label: "Claude",
    newChatUrl: "https://claude.ai/new",
    hosts: ["claude.ai"]
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    newChatUrl: "https://gemini.google.com/app",
    hosts: ["gemini.google.com"]
  }
};

function tpDetectPlatform(hostname) {
  const host = (hostname || "").toLowerCase();
  for (const p of Object.values(TP_PLATFORMS)) {
    if (p.hosts.some((h) => host === h || host.endsWith("." + h))) return p.id;
  }
  return null;
}

// Expose for content scripts (classic scripts share the page's isolated world).
if (typeof globalThis !== "undefined") {
  globalThis.TP_PLATFORMS = TP_PLATFORMS;
  globalThis.tpDetectPlatform = tpDetectPlatform;
}
