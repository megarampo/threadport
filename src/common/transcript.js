// Builds the handoff prompt that gets injected into the target AI.
// Truncation strategy: if the transcript exceeds the budget, keep the first
// exchange (it usually holds the task definition) and as many of the most
// recent messages as fit, with an explicit gap marker in between.
"use strict";

const TP_DEFAULT_CHAR_BUDGET = 60000;
const TP_START_MARK = "=== TRANSCRIPT START ===";
const TP_END_MARK = "=== TRANSCRIPT END ===";
// Captures the origin platform; a later "(via A → B)" clause records the hops.
const TP_HEADER_RE = /^You are continuing a conversation that started on ([A-Za-z0-9 ]+?)(?: \(via ([^)]+)\))?\./;

// If a message is itself a ThreadPort handoff (the conversation was already
// transferred once), unwrap it: return {origin, messages} parsed from the
// embedded transcript, or null if it isn't one of ours.
function tpParseHandoff(text) {
  const t = (text || "").trim();
  const m = TP_HEADER_RE.exec(t);
  const start = t.indexOf(TP_START_MARK);
  const end = t.lastIndexOf(TP_END_MARK);
  if (!m || start < 0 || end < 0 || end <= start) return null;

  const inner = t.slice(start + TP_START_MARK.length, end);
  const messages = [];
  // Speaker labels: [User], [Assistant], or [Assistant — Claude] on unwrapped hops.
  const re = /^\[(User|Assistant)(?: — ([^\]]+))?\]\s*$/gm;
  let match;
  const marks = [];
  while ((match = re.exec(inner)) !== null) {
    marks.push({
      role: match[1] === "User" ? "user" : "assistant",
      platform: match[2] || null,
      at: match.index,
      len: match[0].length,
    });
  }
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].at + marks[i].len;
    const to = i + 1 < marks.length ? marks[i + 1].at : inner.length;
    const body = inner.slice(from, to).trim();
    if (body) messages.push({ role: marks[i].role, text: body, platform: marks[i].platform });
  }
  if (!messages.length) return null;
  const origin = m[1].trim();
  const via = m[2] ? m[2].split("→").map((s) => s.trim()).filter(Boolean) : [origin];
  return { origin, via, messages };
}

// Flatten nested handoffs into a single timeline. Returns {messages, hops}
// where hops lists every platform the conversation passed through before the
// current one, oldest first. Assistant messages from earlier hops are tagged
// with the platform that produced them.
function tpUnwrap(messages, currentPlatform) {
  let hops = [];
  let out = messages.slice();
  let guard = 0;
  while (out.length && out[0].role === "user" && guard++ < 5) {
    const parsed = tpParseHandoff(out[0].text);
    if (!parsed) break;
    // Whatever came after the handoff in this layer was answered by the
    // platform that received it — i.e. the last hop in the chain so far.
    const receivedBy = hops.length ? hops[hops.length - 1] : currentPlatform;
    const rest = out.slice(1).map((msg) =>
      msg.role === "assistant" && !msg.platform ? Object.assign({}, msg, { platform: receivedBy }) : msg
    );
    const innerLast = parsed.via[parsed.via.length - 1];
    const inner = parsed.messages.map((msg) =>
      msg.role === "assistant" && !msg.platform ? Object.assign({}, msg, { platform: innerLast }) : msg
    );
    hops = parsed.via.concat(hops);
    out = inner.concat(rest);
  }
  return { messages: out, hops };
}

function tpBuildHandoff(sourceLabel, targetLabel, rawMessages, charBudget) {
  const budget = charBudget || TP_DEFAULT_CHAR_BUDGET;
  const { messages, hops } = tpUnwrap(rawMessages, sourceLabel);
  const startedOn = hops.length ? hops[0] : sourceLabel;
  const via = hops.length ? ` (via ${hops.concat([sourceLabel]).join(" → ")})` : "";

  const header =
    `You are continuing a conversation that started on ${startedOn}${via}. ` +
    `Below is the transcript so far. Absorb it as context and continue ` +
    `the conversation naturally — do not summarize it back to me, just ` +
    `pick up where it left off. If the transcript ends with a question ` +
    `from me, answer it.\n\n${TP_START_MARK}\n\n`;
  const footer = `\n${TP_END_MARK}\n\nContinue from here.`;

  // On multi-hop conversations, tag assistant turns with the AI that wrote them
  // so the receiving model can tell the voices apart.
  const blocks = messages.map((m) => {
    let who = m.role === "user" ? "User" : "Assistant";
    if (hops.length && m.role === "assistant") who += ` — ${m.platform || sourceLabel}`;
    return `[${who}]\n${m.text.trim()}\n`;
  });

  const overhead = header.length + footer.length;
  const total = blocks.reduce((n, b) => n + b.length + 1, 0);

  let body;
  let truncated = false;
  if (total + overhead <= budget) {
    body = blocks.join("\n");
  } else {
    truncated = true;
    const gapMarker = "\n[... earlier messages omitted for length ...]\n\n";
    let room = budget - overhead - gapMarker.length;

    // Always keep the first user message (task definition), clipped if huge.
    const firstBlock = blocks[0].slice(0, Math.floor(room * 0.25));
    room -= firstBlock.length;

    // Fill the rest with the most recent messages, newest-last order preserved.
    const tail = [];
    for (let i = blocks.length - 1; i > 0; i--) {
      const b = blocks[i];
      if (b.length + 1 > room) break;
      tail.unshift(b);
      room -= b.length + 1;
    }
    body = firstBlock + gapMarker + tail.join("\n");
  }

  return { text: header + body + footer, truncated };
}

if (typeof globalThis !== "undefined") {
  globalThis.tpBuildHandoff = tpBuildHandoff;
  globalThis.tpUnwrap = tpUnwrap;
  globalThis.TP_DEFAULT_CHAR_BUDGET = TP_DEFAULT_CHAR_BUDGET;
}
