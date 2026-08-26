// Popup logic: detect conversation on the active tab, enforce the free-tier
// quota, and kick off transfers via the background worker.
"use strict";

const FREE_MONTHLY_LIMIT = 10;
const REPORT_URL = "https://github.com/megarampo/threadport/issues";
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
  ["state-unsupported", "state-empty", "state-ready", "state-limit"].forEach(
    (id) => $(id).classList.add("hidden")
  );

function monthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function getQuota() {
  if (await isPaid()) return { pro: true, used: 0, left: Infinity };
  const { tp_quota } = await chrome.storage.sync.get("tp_quota");
  const q = tp_quota && tp_quota.month === monthKey() ? tp_quota : { month: monthKey(), used: 0 };
  return { pro: false, used: q.used, left: Math.max(0, FREE_MONTHLY_LIMIT - q.used) };
}

async function bumpQuota() {
  const q = await getQuota();
  if (q.pro) return;
  await chrome.storage.sync.set({
    tp_quota: { month: monthKey(), used: q.used + 1 }
  });
}

function renderQuota(q) {
  $("quota").textContent = q.pro ? "Pro" : `${q.left}/${FREE_MONTHLY_LIMIT} free`;
}

async function init() {
  const quota = await getQuota();
  renderQuota(quota);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const platformId = tab && tab.url ? tpDetectPlatform(new URL(tab.url).hostname) : null;

  hideAll();
  if (!platformId) {
    show("state-unsupported");
    return;
  }

  let resp = null;
  try {
    resp = await chrome.tabs.sendMessage(tab.id, { type: "TP_EXTRACT" });
  } catch (_) {
    // Content script not loaded (e.g. extension just installed) — ask for reload.
  }

  if (!resp || !resp.messages || resp.messages.length === 0) {
    show("state-empty");
    $("report-link").href = REPORT_URL;
    if (!resp) {
      $("state-empty").querySelector("p").textContent =
        "Reload the AI tab once and try again (the extension was just installed).";
    }
    return;
  }

  if (!quota.pro && quota.left <= 0) {
    show("state-limit");
    $("upgrade").addEventListener("click", () => {
      extpay.openPaymentPage();
    });
    return;
  }

  const source = TP_PLATFORMS[resp.platform];
  $("source-label").textContent = source.label;
  $("msg-count").textContent = String(resp.messages.length);
  show("state-ready");

  const targetsEl = $("targets");
  targetsEl.innerHTML = "";
  Object.values(TP_PLATFORMS)
    .filter((p) => p.id !== resp.platform)
    .forEach((p) => {
      const btn = document.createElement("button");
      btn.textContent = "→ " + p.label;
      btn.addEventListener("click", () => transfer(resp, p));
      targetsEl.appendChild(btn);
    });

  async function transfer(extraction, target) {
    const { text, truncated } = tpBuildHandoff(
      source.label,
      target.label,
      extraction.messages
    );
    const status = $("status");
    status.classList.remove("hidden");
    status.textContent = truncated
      ? `Opening ${target.label}… (long chat: oldest messages trimmed)`
      : `Opening ${target.label}…`;

    const res = await chrome.runtime.sendMessage({
      type: "TP_TRANSFER",
      target: target.id,
      text,
      autoSend: $("autosend").checked
    });
    if (res && res.ok) {
      await bumpQuota();
      window.close();
    } else {
      status.textContent = "Something went wrong: " + (res && res.error);
    }
  }
}

init();
