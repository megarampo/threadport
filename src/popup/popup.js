// Popup logic: detect conversation on the active tab, enforce the free-tier
// quota, and kick off transfers via the background worker.
"use strict";

// Free tier: 10 transfers a month through September 2026, 5 from October on
// (nobody gets cut off mid-month by the update). Markdown export stays free.
const FREE_LIMIT_CHANGE_MONTH = "2026-10";
const freeLimit = () => (monthKey() >= FREE_LIMIT_CHANGE_MONTH ? 5 : 10);
// Show the Pro hint once the user is this close to the limit.
const PRO_HINT_AT = 3;
const REPORT_URL = "https://github.com/megarampo/threadport/issues";
// One-time review ask, shown after this many successful transfers.
const REVIEW_AFTER = 3;
const REVIEW_URL = navigator.userAgent.includes("Edg/")
  ? "https://microsoftedge.microsoft.com/addons/detail/hfegopjfooabblaccgifjfomanedeapc"
  : "https://chromewebstore.google.com/detail/kclkpikpgnldnpnmojkcnoclcihmhhmd/reviews";
const extpay = ExtPay("threadport");

// Paid status: ExtensionPay is the source of truth; tp_pro is the founder /
// manual override. If ExtensionPay can't be reached, fall back to its own
// locally cached status so paying users are never locked out offline.
async function isPaid() {
  const { tp_pro } = await chrome.storage.sync.get("tp_pro");
  if (tp_pro) return true;
  try {
    const user = await extpay.getUser();
    return !!user.paid;
  } catch (_) {
    const { extensionpay_user } = await chrome.storage.sync.get("extensionpay_user");
    return !!(extensionpay_user && extensionpay_user.paid);
  }
}

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove("hidden");
const hideAll = () =>
  [
    "state-unsupported",
    "state-enable",
    "state-loading",
    "state-empty",
    "state-ready",
    "state-limit",
    "export"
  ].forEach((id) => $(id).classList.add("hidden"));

function monthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function getQuota() {
  if (await isPaid()) return { pro: true, used: 0, left: Infinity };
  const { tp_quota } = await chrome.storage.sync.get("tp_quota");
  const q = tp_quota && tp_quota.month === monthKey() ? tp_quota : { month: monthKey(), used: 0 };
  return { pro: false, used: q.used, left: Math.max(0, freeLimit() - q.used) };
}

async function bumpQuota() {
  const q = await getQuota();
  if (q.pro) return;
  await chrome.storage.sync.set({
    tp_quota: { month: monthKey(), used: q.used + 1 }
  });
}

// Optional platforms (Mistral, Perplexity…) need their host permission
// granted once. The request must run inside a click handler (user gesture).
async function hasPlatformPermission(p) {
  if (!p.optional) return true;
  try {
    return await chrome.permissions.contains({ origins: p.origins });
  } catch (_) {
    return false;
  }
}

async function requestPlatformPermission(p) {
  if (!p.optional) return true;
  try {
    return await chrome.permissions.request({ origins: p.origins });
  } catch (_) {
    return false;
  }
}

// After a grant, tabs already open on that platform have no content script
// yet (dynamic registration only covers future loads) — inject it now.
async function injectContentScripts(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "src/common/platforms.js",
        "src/common/transcript.js",
        "src/content/extractors.js",
        "src/content/injector.js",
        "src/content/content.js"
      ]
    });
  } catch (_) {
    /* already injected or tab not scriptable */
  }
}

// Lifetime transfer count (Pro included) — only used for the review ask.
async function bumpTransfers() {
  const { tp_transfers = 0 } = await chrome.storage.sync.get("tp_transfers");
  await chrome.storage.sync.set({ tp_transfers: tp_transfers + 1 });
}

async function maybeShowReview() {
  const { tp_transfers = 0, tp_review = null } = await chrome.storage.sync.get([
    "tp_transfers",
    "tp_review"
  ]);
  if (tp_review || tp_transfers < REVIEW_AFTER) return;
  show("review");
  $("review-link").onclick = (e) => {
    e.preventDefault();
    chrome.storage.sync.set({ tp_review: "clicked" });
    chrome.tabs.create({ url: REVIEW_URL });
  };
  $("review-dismiss").onclick = () => {
    chrome.storage.sync.set({ tp_review: "dismissed" });
    $("review").classList.add("hidden");
  };
}

// Tab titles carry the site name ("ChatGPT - My chat", "My chat | Perplexity").
function cleanTitle(raw, label) {
  const site = "(ChatGPT|Claude|Gemini|Perplexity|Mistral AI|Mistral|Le Chat|Google Gemini)";
  const t = (raw || "")
    .replace(new RegExp("^" + site + "\\s*[-–—|:]\\s*", "i"), "")
    .replace(new RegExp("\\s*[-–—|:]\\s*" + site + "$", "i"), "")
    .trim();
  return t && !new RegExp("^" + site + "$", "i").test(t) ? t : `${label} conversation`;
}

function exportFileName(title, platformId) {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // drop accents: "rápidas" → "rapidas"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const date = new Date().toISOString().slice(0, 10);
  return `threadport-${platformId}-${date}${slug ? "-" + slug : ""}.md`;
}

function flash(id, msg) {
  const el = $(id);
  const old = el.textContent;
  el.textContent = msg;
  setTimeout(() => (el.textContent = old), 1500);
}

// Markdown export is free and unlimited: it's the door people come in by
// (they search "export chat"), transfers are what Pro sells.
function setupExport(extraction, source) {
  const title = cleanTitle(extraction.title, source.label);
  const md = () => tpBuildMarkdown(source.label, title, extraction.messages);
  show("export");
  $("copy-md").onclick = async () => {
    try {
      await navigator.clipboard.writeText(md());
      flash("copy-md", t("copied"));
    } catch (_) {
      flash("copy-md", t("copyFailed"));
    }
  };
  $("download-md").onclick = () => {
    const blob = new Blob([md()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName(title, source.id);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    flash("download-md", t("saved"));
  };
}

function renderQuota(q) {
  const chip = $("quota");
  chip.textContent = q.pro ? t("pro") : t("quota", { left: q.left, limit: freeLimit() });
  // Free users can always reach the Pro page from the counter chip.
  chip.classList.toggle("clickable", !q.pro);
  if (!q.pro) chip.title = t("quotaGoPro");
  chip.onclick = q.pro ? null : () => extpay.openPaymentPage();
}

async function init() {
  await tpInitLang();
  tpApplyStatic();
  const quota = await getQuota();
  renderQuota(quota);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const platformId = tab && tab.url ? tpDetectPlatform(new URL(tab.url).hostname) : null;

  hideAll();
  if (!platformId) {
    show("state-unsupported");
    return;
  }

  const sourcePlatform = TP_PLATFORMS[platformId];
  if (sourcePlatform.optional && !(await hasPlatformPermission(sourcePlatform))) {
    show("state-enable");
    $("enable-text").innerHTML = t("enableQ", { ai: sourcePlatform.label });
    $("enable-btn").onclick = async () => {
      const ok = await requestPlatformPermission(sourcePlatform);
      if (!ok) return;
      await injectContentScripts(tab.id);
      init();
    };
    return;
  }

  show("state-loading");
  const extract = () => chrome.tabs.sendMessage(tab.id, { type: "TP_EXTRACT" });
  let resp = null;
  try {
    resp = await extract();
  } catch (_) {
    // No content script in this tab. On optional platforms that's expected
    // right after the permission grant (Chrome closes the popup during the
    // prompt): inject it now and retry instead of asking for a reload.
    if (sourcePlatform.optional) {
      await injectContentScripts(tab.id);
      try {
        resp = await extract();
      } catch (_) {
        /* fall through to the reload hint */
      }
    }
  }
  hideAll();

  if (!resp || !resp.messages || resp.messages.length === 0) {
    show("state-empty");
    $("report-link").href = REPORT_URL;
    if (!resp) {
      $("empty-text").textContent = t("reloadHint");
    }
    return;
  }

  const source = TP_PLATFORMS[resp.platform];
  setupExport(resp, source);

  if (!quota.pro && quota.left <= 0) {
    show("state-limit");
    $("upgrade").onclick = () => extpay.openPaymentPage();
    return;
  }

  $("detected").innerHTML = t("detected", { ai: source.label, n: resp.messages.length });
  show("state-ready");
  maybeShowReview();
  const hint = $("pro-hint");
  if (!quota.pro && quota.left <= PRO_HINT_AT) {
    hint.innerHTML = t("proHint", { left: quota.left });
    hint.classList.remove("hidden");
    $("pro-link").onclick = (e) => {
      e.preventDefault();
      extpay.openPaymentPage();
    };
  } else {
    hint.classList.add("hidden");
  }

  const targetsEl = $("targets");
  targetsEl.innerHTML = "";
  Object.values(TP_PLATFORMS)
    .filter((p) => p.id !== resp.platform)
    .forEach((p) => {
      const btn = document.createElement("button");
      btn.textContent = "→ " + p.label;
      btn.addEventListener("click", async () => {
        if (!(await hasPlatformPermission(p))) {
          const ok = await requestPlatformPermission(p);
          if (!ok) return;
        }
        transfer(resp, p);
      });
      targetsEl.appendChild(btn);
    });
  // Same AI, fresh chat: the answer to "this thread got too long / slow".
  const same = document.createElement("button");
  same.className = "same";
  same.textContent = t("sameChat", { ai: source.label });
  same.addEventListener("click", () => transfer(resp, source));
  targetsEl.appendChild(same);

  async function transfer(extraction, target) {
    const { text, truncated } = tpBuildHandoff(
      source.label,
      target.label,
      extraction.messages
    );
    const status = $("status");
    status.classList.remove("hidden");
    status.textContent = t(truncated ? "openingTrimmed" : "opening", { ai: target.label });

    const res = await chrome.runtime.sendMessage({
      type: "TP_TRANSFER",
      target: target.id,
      text,
      autoSend: $("autosend").checked
    });
    if (res && res.ok) {
      await bumpQuota();
      await bumpTransfers();
      window.close();
    } else {
      status.textContent = t("error") + (res && res.error);
    }
  }
}

document.querySelectorAll(".lang button").forEach((b) => {
  b.addEventListener("click", async () => {
    if (b.dataset.lang === tpLang) return;
    await tpSetLang(b.dataset.lang);
    init();
  });
});

init();
