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
    ],
    mistral: [
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder]'
    ],
    perplexity: [
      "#ask-input",
      'div[contenteditable="true"][data-lexical-editor="true"]',
      'div[role="textbox"][contenteditable="true"]'
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
    ],
    mistral: [
      'button[aria-label*="Send"]',
      'button[aria-label*="Enviar"]',
      'button[aria-label*="Envoyer"]',
      'form button[type="submit"]'
    ],
    perplexity: [
      'button[aria-label*="Submit"]',
      'button[aria-label*="Enviar"]',
      'button[aria-label*="Send"]'
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

    const squash = (s) => (s || "").replace(/\s+/g, " ").trim();
    const isEmpty = () => squash(el.innerText).length === 0;

    // Empty the composer before inserting, or a leftover draft (or a previous
    // transfer) gets concatenated with ours. Editors don't always honor the
    // first attempt, so verify and escalate: selection-based delete, then a
    // Selection API range delete, then wiping the DOM as a last resort.
    const clear = async () => {
      for (let attempt = 0; attempt < 4 && !isEmpty(); attempt++) {
        el.focus();
        if (attempt === 0) {
          document.execCommand("selectAll", false, null);
          document.execCommand("delete", false, null);
        } else if (attempt === 1) {
          // Lexical (Perplexity) ignores execCommand("delete") but honors a
          // beforeinput deletion over the current selection.
          document.execCommand("selectAll", false, null);
          el.dispatchEvent(
            new InputEvent("beforeinput", {
              inputType: "deleteContentBackward",
              bubbles: true,
              cancelable: true
            })
          );
        } else if (attempt === 2) {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand("delete", false, null);
          sel.removeAllRanges();
        } else {
          el.innerHTML = "";
          el.dispatchEvent(
            new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" })
          );
        }
        await wait(120);
      }
    };
    // Check that the payload landed — and only the payload. Too little means
    // the editor dropped part of it; too much means a stale draft survived.
    // innerText normalizes whitespace differently per editor, so compare on
    // squashed lengths.
    const landed = () => {
      const got = squash(el.innerText).length;
      const want = squash(text).length;
      return got >= want * 0.9 && got <= want * 1.1 + 200;
    };

    // Attempt 1: synthetic paste through the editor's own pipeline.
    await clear();
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
    await clear();
    document.execCommand("insertText", false, text);
    await wait(400);
    if (landed()) return true;

    // Attempt 3: brute force. Loses formatting niceties but delivers the text.
    await clear();
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
