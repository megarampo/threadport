// Service worker: receives a transfer request from the popup, parks the
// payload in storage and opens the target platform. The target's content
// script picks the payload up on load.
"use strict";

importScripts("common/platforms.js");
importScripts("lib/ExtPay.js");

// ExtensionPay handles Pro payments (Stripe under the hood). The background
// listener must run on every worker start for payment status to sync.
const extpay = ExtPay("threadport");
extpay.startBackground();

// Optional platforms: keep dynamically registered content scripts in sync
// with the host permissions the user has actually granted.
const CONTENT_FILES = [
  "src/common/platforms.js",
  "src/common/transcript.js",
  "src/content/extractors.js",
  "src/content/injector.js",
  "src/content/content.js"
];

async function syncOptionalScripts() {
  try {
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const have = new Set(registered.map((s) => s.id));
    for (const p of Object.values(TP_PLATFORMS)) {
      if (!p.optional) continue;
      const id = "tp-" + p.id;
      const granted = await chrome.permissions.contains({ origins: p.origins });
      if (granted && !have.has(id)) {
        await chrome.scripting.registerContentScripts([
          { id, matches: p.origins, js: CONTENT_FILES, runAt: "document_idle" }
        ]);
      } else if (!granted && have.has(id)) {
        await chrome.scripting.unregisterContentScripts({ ids: [id] });
      }
    }
  } catch (e) {
    console.warn("[ThreadPort] optional script sync failed:", e);
  }
}
chrome.runtime.onInstalled.addListener(syncOptionalScripts);
chrome.runtime.onStartup.addListener(syncOptionalScripts);
chrome.permissions.onAdded.addListener(syncOptionalScripts);
chrome.permissions.onRemoved.addListener(syncOptionalScripts);
syncOptionalScripts();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "TP_TRANSFER") {
    const target = TP_PLATFORMS[msg.target];
    if (!target) {
      sendResponse({ ok: false, error: "unknown-target" });
      return false;
    }
    chrome.storage.local
      .set({
        tp_pending: {
          target: target.id,
          text: msg.text,
          autoSend: !!msg.autoSend,
          created: Date.now()
        }
      })
      // Optional targets: make sure their content script is registered
      // before the new tab loads (the permission may have been granted a
      // moment ago in the popup).
      .then(() => (target.optional ? syncOptionalScripts() : null))
      .then(() => chrome.tabs.create({ url: target.newChatUrl }))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
  return false;
});
