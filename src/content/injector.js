// Finds the composer input on the target platform and inserts the handoff
// text. Send is optional and OFF by default: the user reviews before sending.
// Locale-proof: submit buttons are matched by several aria-label languages
// and by testid, never by visible text alone.
"use strict";

(() => {
  const INPUT_SELECTORS = {
    chatgpt: [
      "#prompt-textarea",
      'div[contenteditable="true"].ProseMirror',
      'textarea[data-testid="prompt-textarea"]'
    ],
    claude: [
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"][aria-label]',
      'fieldset div[contenteditable="true"]'
    ],
    gemini: [
      "rich-textarea .ql-editor",
      'div[contenteditable="true"].ql-editor',
      'rich-textarea div[contenteditable="true"]'
    ]
  };

  const SEND_SELECTORS = {
    chatgpt: [
      'button[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="Enviar"]'
    ],
    claude: [
      'button[aria-label*="Send"]',
      'button[aria-label*="Enviar"]',
      'button:has(svg) [data-icon="send"]'
    ],
    gemini: [
      'button[aria-label*="Send"]',
      'button[aria-label*="Enviar"]',
      ".send-button"
    ]
  };

  function firstMatch(selectors) {
    for (const s of selectors) {
      try {
        const el = document.querySelector(s);
        if (el) return el;
      } catch (_) {
        /* :has() may be unsupported — skip */
      }
    }
    return null;
  }

  function waitFor(selectors, timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const el = firstMatch(selectors);
        if (el) return resolve(el);
        if (Date.now() - started > timeoutMs) return resolve(null);
        setTimeout(tick, 400);
      };
      tick();
    });
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Rich editors (ProseMirror on ChatGPT/Claude, Quill on Gemini) differ in
  // which insertion APIs they honor for multi-line text — Quill in particular
  // can drop everything after the first paragraph on execCommand. A synthetic
  // paste event goes through each editor's own paste pipeline, which is the
  // best-supported path for large multi-line payloads. We verify how much
  // text actually landed and fall back through cruder methods if needed.
  async function insertText(el, text) {
    el.focus();

    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const setter = Object.getOwnPropertyDescriptor(
        el.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    const clear = () => {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
    };
    // Rough check that the payload actually landed (innerText normalizes
    // whitespace differently per editor, so compare on squashed lengths).
    const landed = () => {
      const got = el.innerText.replace(/\s+/g, " ").trim().length;
      const want = text.replace(/\s+/g, " ").trim().length;
      return got >= want * 0.9;
    };

    // Attempt 1: synthetic paste through the editor's own pipeline.
    clear();
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true
        })
      );
      await wait(400);
      if (landed()) return true;
    } catch (_) {
      /* DataTransfer/ClipboardEvent unavailable — fall through */
    }

    // Attempt 2: execCommand insertText.
    el.focus();
    clear();
    document.execCommand("insertText", false, text);
    await wait(400);
    if (landed()) return true;

    // Attempt 3: brute force. Loses formatting niceties but delivers the text.
    el.textContent = text;
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
    );
    return true;
  }

  globalThis.tpInject = async function (platformId, text, autoSend) {
    const input = await waitFor(INPUT_SELECTORS[platformId] || [], 30000);
    if (!input) return { ok: false, error: "input-not-found" };

    await insertText(input, text);

    if (autoSend) {
      // Give the editor a moment to register the input before enabling send.
      await new Promise((r) => setTimeout(r, 800));
      const btn = firstMatch(SEND_SELECTORS[platformId] || []);
      if (btn && !btn.disabled) btn.click();
      else return { ok: true, sent: false, error: "send-button-not-found" };
      return { ok: true, sent: true };
    }
    return { ok: true, sent: false };
  };
})();
