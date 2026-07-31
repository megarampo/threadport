// Builds the handoff prompt that gets injected into the target AI.
// Truncation strategy: if the transcript exceeds the budget, keep the first
// exchange (it usually holds the task definition) and as many of the most
// recent messages as fit, with an explicit gap marker in between.
"use strict";

const TP_DEFAULT_CHAR_BUDGET = 60000;

function tpBuildHandoff(sourceLabel, targetLabel, messages, charBudget) {
  const budget = charBudget || TP_DEFAULT_CHAR_BUDGET;

  const header =
    `You are continuing a conversation that started on ${sourceLabel}. ` +
    `Below is the transcript so far. Absorb it as context and continue ` +
    `the conversation naturally — do not summarize it back to me, just ` +
    `pick up where it left off. If the transcript ends with a question ` +
    `from me, answer it.\n\n=== TRANSCRIPT START ===\n\n`;
  const footer = `\n=== TRANSCRIPT END ===\n\nContinue from here.`;

  const blocks = messages.map((m) => {
    const who = m.role === "user" ? "User" : "Assistant";
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
  globalThis.TP_DEFAULT_CHAR_BUDGET = TP_DEFAULT_CHAR_BUDGET;
}
