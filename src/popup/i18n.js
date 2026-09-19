// Popup UI strings. Language comes from the user's choice (tp_lang) or, by
// default, the browser locale. The handoff prompt itself stays in English —
// every model reads it, and the nested-transfer parser depends on it.
"use strict";

const TP_I18N = {
  en: {
    langTitle: "Language / Idioma",
    quotaTitle: "Free transfers left this month",
    quotaGoPro: "Free transfers left this month. Click to go unlimited (€19 once).",
    pro: "Pro",
    quota: "{left}/{limit} free",
    unsupported:
      "Open a conversation on <b>ChatGPT</b>, <b>Claude</b>, <b>Gemini</b>, " +
      "<b>Mistral</b> or <b>Perplexity</b>, then click ThreadPort to move it " +
      "to another AI or save it as Markdown.",
    enableQ: "Enable <b>{ai}</b> support?",
    enableDim:
      "ThreadPort needs one-time permission to read and write conversations " +
      "on this site. Nothing leaves your browser.",
    enableBtn: "Enable",
    loading: "Reading the conversation…",
    loadingDim:
      "Long chats take a few extra seconds: we scroll through the whole " +
      "thread so nothing gets left behind.",
    empty: "No conversation detected on this page yet.",
    emptyDim:
      "If the chat is clearly visible, the site may have updated its layout — " +
      '<a id="report-link" href="#">report it</a> and we\'ll ship a fix fast.',
    reloadHint:
      "Reload the AI tab once and try again (the extension was just installed).",
    detected: "{ai} conversation · <b>{n}</b> messages",
    continueOn: "Continue this conversation on:",
    autosend: "Send automatically (otherwise it's pasted for you to review)",
    sameChat: "↻ New {ai} chat with this context",
    saveCopy: "Save a copy:",
    copyMd: "Copy as Markdown",
    downloadMd: "Download .md",
    copied: "Copied ✓",
    copyFailed: "Copy failed",
    saved: "Saved ✓",
    limitTitle: "<b>Free limit reached for this month.</b>",
    limitDim: "Unlimited transfers with Pro: €19 once, or €2.99 a month. Markdown export stays free.",
    proHint: '{left} free transfers left this month. <a id="pro-link" href="#">Go unlimited for €19, one time</a>.',
    upgrade: "Upgrade to Pro",
    review:
      'Is ThreadPort useful? <a id="review-link" href="#">Leave a quick review</a> ' +
      "— it helps more than you'd think.",
    reviewDismiss: "Don't ask again",
    opening: "Opening {ai}…",
    openingTrimmed: "Opening {ai}… (long chat: oldest messages trimmed)",
    error: "Something went wrong: "
  },
  es: {
    langTitle: "Idioma / Language",
    quotaTitle: "Transferencias gratuitas que te quedan este mes",
    quotaGoPro: "Transferencias gratis que te quedan este mes. Clic para pasar a ilimitadas (€19, pago único).",
    pro: "Pro",
    quota: "{left}/{limit} gratis",
    unsupported:
      "Abre una conversación en <b>ChatGPT</b>, <b>Claude</b>, <b>Gemini</b>, " +
      "<b>Mistral</b> o <b>Perplexity</b> y haz clic en ThreadPort para " +
      "moverla a otra IA o guardarla como Markdown.",
    enableQ: "¿Activar ThreadPort en <b>{ai}</b>?",
    enableDim:
      "ThreadPort necesita permiso, una sola vez, para leer y escribir " +
      "conversaciones en este sitio. Nada sale de tu navegador.",
    enableBtn: "Activar",
    loading: "Leyendo la conversación…",
    loadingDim:
      "Los chats largos tardan unos segundos más: recorremos todo el hilo " +
      "para que no falte nada.",
    empty: "Todavía no se detecta ninguna conversación en esta página.",
    emptyDim:
      "Si el chat está a la vista, puede que el sitio haya cambiado su diseño: " +
      '<a id="report-link" href="#">avísanos</a> y lo arreglamos rápido.',
    reloadHint:
      "Recarga la pestaña de la IA una vez y vuelve a intentarlo (la extensión se acaba de instalar).",
    detected: "Conversación de {ai} · <b>{n}</b> mensajes",
    continueOn: "Continuar esta conversación en:",
    autosend: "Enviar automáticamente (si no, se pega para que lo revises)",
    sameChat: "↻ Nuevo chat en {ai} con este contexto",
    saveCopy: "Guardar una copia:",
    copyMd: "Copiar como Markdown",
    downloadMd: "Descargar .md",
    copied: "Copiado ✓",
    copyFailed: "No se pudo copiar",
    saved: "Guardado ✓",
    limitTitle: "<b>Límite gratuito del mes alcanzado.</b>",
    limitDim: "Transferencias ilimitadas con Pro: €19 una sola vez, o €2,99 al mes. Exportar a Markdown sigue gratis.",
    proHint: 'Te quedan {left} transferencias gratis este mes. <a id="pro-link" href="#">Ilimitadas por €19, pago único</a>.',
    upgrade: "Pasar a Pro",
    review:
      '¿Te resulta útil ThreadPort? <a id="review-link" href="#">Deja una reseña rápida</a>: ' +
      "ayuda más de lo que parece.",
    reviewDismiss: "No volver a preguntar",
    opening: "Abriendo {ai}…",
    openingTrimmed: "Abriendo {ai}… (chat largo: se recortaron los mensajes más antiguos)",
    error: "Algo salió mal: "
  }
};

let tpLang = "en";

function t(key, vars) {
  const table = TP_I18N[tpLang] || TP_I18N.en;
  const s = table[key] || TP_I18N.en[key] || key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : ""));
}

async function tpInitLang() {
  const { tp_lang } = await chrome.storage.sync.get("tp_lang");
  if (tp_lang && TP_I18N[tp_lang]) tpLang = tp_lang;
  else tpLang = (navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en";
  return tpLang;
}

async function tpSetLang(lang) {
  if (!TP_I18N[lang]) return;
  tpLang = lang;
  await chrome.storage.sync.set({ tp_lang: lang });
}

// Fill every element carrying data-i18n / data-i18n-title. Strings are our
// own constants (never user or page content), so innerHTML is safe here.
function tpApplyStatic() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.innerHTML = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll(".lang button").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === tpLang);
  });
}
