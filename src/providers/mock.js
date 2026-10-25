import { createHash } from "node:crypto";

import { LABELS } from "../config.js";

const PATTERNS = {
  "Politics & Elections":
    /\b(government|governor|president|presidential|election|elections|vote|voter|voters|senate|congress|congressional|parliament|policy|politics|political|democrat|democratic|republican|campaign|candidate|minister|mayor|constitution|immigration|military|war|diplomat|diplomacy)\b/gi,
  "Medical & Health":
    /\b(health|healthy|medical|medicine|doctor|doctors|patient|patients|hospital|clinic|drug|drugs|medication|symptom|symptoms|pain|disease|treatment|therapy|cancer|diabetes|pregnan\w*|diet|nutrition|virus|vaccine|surgery|infection|allerg\w*|blood|mental|depression|anxiety|sleep|injury|illness)\b/gi,
  "Legal & Regulatory":
    /\b(lawsuit|litigation|attorney|lawyer|judge|judges|court|courts|prosecutor|verdict|indictment|compliance|regulation|regulatory|statute|contract|contracts|settlement|police|arrest|arrested|illegal|crime|criminal|supreme court|federal court|law enforcement|sued)\b/gi,
  "Financial & Crypto":
    /\b(bank|banks|banking|stock|stocks|invest|investor|investment|loan|loans|mortgage|credit|debit|tax|taxes|money|finance|financial|insurance|payment|payments|refund|invoice|budget|debt|crypto|bitcoin|ethereum|market|markets|trading|profit|revenue|salary|fund|funding|economy|economic|business|company|companies|shares|dividend|accounting|price|prices)\b/gi,
};

function hashInt(value) {
  return createHash("sha256").update(value).digest().readUInt32BE(0);
}

export function keywordLabel(text) {
  const scores = LABELS.map((label) => {
    const matches = text.match(PATTERNS[label]);
    return matches ? matches.length : 0;
  });
  const best = Math.max(...scores);
  if (best === 0) return LABELS[hashInt(text) % LABELS.length];

  const winners = LABELS.filter((_, index) => scores[index] === best);
  return winners[hashInt(`tie:${text}`) % winners.length];
}

function otherLabel(label, seed) {
  const index = LABELS.indexOf(label);
  const offset = 1 + (hashInt(seed) % (LABELS.length - 1));
  return LABELS[(index + offset) % LABELS.length];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMockProvider(modelKey, options = {}) {
  const { delay = true } = options;

  return {
    key: modelKey,
    kind: "mock",
    async classify({ id, text }) {
      const base = keywordLabel(text);
      const hash = hashInt(`${modelKey}:${id}`);
      const noisy = hash % 10 < 2;
      const label = noisy ? otherLabel(base, `${modelKey}:${id}:other`) : base;

      const latencyMs = delay
        ? modelKey === "d1"
          ? 12 + (hash % 28)
          : 75 + (hash % 95)
        : 0;
      if (latencyMs > 0) await sleep(latencyMs);

      return {
        label,
        confidence: Number((0.55 + (hash % 40) / 100).toFixed(2)),
        latencyMs,
        raw: {
          provider: "mock",
          model: modelKey,
          heuristic: base,
          noisy,
        },
      };
    },
  };
}
