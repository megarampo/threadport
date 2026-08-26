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
      .then(() => chrome.tabs.create({ url: target.newChatUrl }))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
  return false;
});
