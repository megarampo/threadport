// Content script entry point. Two jobs:
// 1) Answer popup requests to extract the current conversation.
// 2) On page load, check for a pending transfer addressed to this platform
//    and inject it into the composer.
"use strict";

(() => {
  const platformId = tpDetectPlatform(location.hostname);
  if (!platformId) return;

  const PENDING_KEY = "tp_pending";
  const PENDING_TTL_MS = 3 * 60 * 1000;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "TP_EXTRACT") {
      // Async: ChatGPT may need a scroll sweep to defeat list virtualization.
      Promise.resolve(tpExtractAsync(platformId))
        .catch(() => tpExtract(platformId))
        .then((messages) =>
          sendResponse({
            platform: platformId,
            title: document.title,
            messages
          })
        );
      return true;
    }
    return false;
  });

  async function checkPendingTransfer() {
    const data = await chrome.storage.local.get(PENDING_KEY);
    const pending = data[PENDING_KEY];
    if (!pending) return;
    if (pending.target !== platformId) return;
    if (Date.now() - pending.created > PENDING_TTL_MS) {
      await chrome.storage.local.remove(PENDING_KEY);
      return;
    }
    // Claim it before injecting so a second tab doesn't double-inject.
    await chrome.storage.local.remove(PENDING_KEY);

    const result = await tpInject(platformId, pending.text, !!pending.autoSend);
    chrome.runtime
      .sendMessage({ type: "TP_TRANSFER_RESULT", platform: platformId, result })
      .catch(() => {});
  }

  checkPendingTransfer();
})();
