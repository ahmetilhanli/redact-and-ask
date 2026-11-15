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
