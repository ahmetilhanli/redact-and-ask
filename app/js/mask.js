// Masking and re-identification. The placeholder map never leaves the device.

import { resolveOverlaps } from "./rules.js";

// Expand model entities (plain strings) into every occurrence in the text.
export function entitiesToSpans(text, entities, by = "on-device model") {
  const spans = [];
  for (const e of entities) {
    const needle = (e.text || "").trim();
    if (needle.length < 2) continue;
    let i = text.indexOf(needle);
    while (i !== -1) {
      spans.push({ start: i, end: i + needle.length, text: needle, type: e.type, by });
      i = text.indexOf(needle, i + needle.length);
    }
  }
  return spans;
}

// Placeholders are numbered per type in order of first appearance; the same value always gets the same placeholder.
// Pass the same `shared` object for every document of a batch so placeholders stay unique across the batch and a
// customer who writes twice gets the same placeholder both times.
export function mask(text, spans, shared = { byValue: new Map(), counters: {}, map: {} }) {
  const ordered = resolveOverlaps(spans);
  const { byValue, counters, map } = shared;
  let out = "", pos = 0;
  for (const s of ordered) {
    const key = s.type + "\u0000" + s.text;
    if (!byValue.has(key)) {
      counters[s.type] = (counters[s.type] || 0) + 1;
      const ph = `[${s.type}_${counters[s.type]}]`;
      byValue.set(key, ph);
      map[ph] = { value: s.text, type: s.type, by: s.by };
    }
    out += text.slice(pos, s.start) + byValue.get(key);
    pos = s.end;
  }
  return { masked: out + text.slice(pos), map };
}

// Cloud answers may echo placeholders with odd spacing or case: "[ person_1 ]", "[Person_1]".
const PH = /\[\s*([A-Za-z_]+?)_(\d+)\s*\]/g;

export function unmask(text, map) {
  return text.replace(PH, (whole, type, n) => {
    const ph = `[${type.toUpperCase()}_${n}]`;
    return map[ph] ? map[ph].value : whole;
  });
}

// Placeholders that the answer mentions but the map does not know (the model invented them).
export function unknownPlaceholders(text, map) {
  const out = new Set();
  for (const m of text.matchAll(PH)) {
    const ph = `[${m[1].toUpperCase()}_${m[2]}]`;
    if (!map[ph]) out.add(m[0]);
  }
  return [...out];
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// The one placeholder of the map an invented one most likely stands for: same number, and a type that is a
// shortened or misspelt form of it ("[IB_1]" -> "[IBAN_1]"). Returns null unless exactly one placeholder fits.
export function suggestPlaceholder(invented, map) {
  const m = invented.match(/^\[\s*([A-Za-z_]+?)_(\d+)\s*\]$/);
  if (!m) return null;
  const type = m[1].toUpperCase();
  const fits = Object.keys(map).filter((ph) => {
    const [, t, n] = ph.match(/^\[([A-Z_]+)_(\d+)\]$/);
    return n === m[2] && (t.startsWith(type) || type.startsWith(t) || editDistance(t, type) <= 2);
  });
  return fits.length === 1 ? fits[0] : null;
}

// On-device check of an answer before it is shown: which placeholders are filled back in, which ones the model
// invented (with the placeholder each most likely stands for), and whether any real value appears in the answer.
// The cloud never received the real values, so a real value in its answer would be a leak or a guess.
export function checkAnswer(text, map) {
  const restored = new Set(), unknown = [];
  for (const m of text.matchAll(PH)) {
    const ph = `[${m[1].toUpperCase()}_${m[2]}]`;
    if (map[ph]) restored.add(ph);
    else if (!unknown.some((u) => u.placeholder === m[0])) unknown.push({ placeholder: m[0], suggestion: suggestPlaceholder(m[0], map) });
  }
  const lower = text.toLowerCase();
  const values = [...new Set(Object.values(map).map((v) => v.value))];
  const realValues = values.filter((v) => v.trim().length >= 3 && lower.includes(v.toLowerCase()));
  return { restored: restored.size, unknown, realValues, valuesChecked: values.length };
}
