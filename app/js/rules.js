// Deterministic detectors. They run first, offline, and never depend on a model.
// Each detector returns spans {start, end, text, type, by}. Validators cut false positives.

const digits = (s) => s.replace(/\D/g, "");

function luhn(num) {
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = +num[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

function ibanValid(raw) {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (s.length < 15 || s.length > 34) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + +d) % 97;
  }
  return rem === 1;
}

// Turkish national ID (TC Kimlik No): 11 digits, first non-zero, two check digits.
function tcknValid(s) {
  if (!/^[1-9]\d{10}$/.test(s)) return false;
  const d = [...s].map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const c10 = ((odd * 7 - even) % 10 + 10) % 10;
  const c11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d[9] === c10 && d[10] === c11;
}

const DETECTORS = [
  { type: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: "IBAN", re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, ok: ibanValid },
  { type: "CARD", re: /\b(?:\d[ -]?){12,18}\d\b/g, ok: (s) => { const n = digits(s); return n.length >= 13 && n.length <= 19 && luhn(n); } },
  { type: "NATIONAL_ID", re: /\b[1-9]\d{10}\b/g, ok: tcknValid },
  { type: "NATIONAL_ID", re: /\b\d{3}-\d{2}-\d{4}\b/g },                                // US SSN format
  { type: "NATIONAL_ID", re: /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g }, // UK NI number
  { type: "PHONE", re: /(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,4}\)[ .-]?)?\d{1,4}(?:[ .-]?\d{2,4}){2,5}\b/g,
    ok: (s) => { const n = digits(s); return n.length >= 9 && n.length <= 15; } },
  { type: "POSTCODE", re: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g },                      // UK postcode
];

// Lower number wins when two spans overlap with the same length.
const PRIORITY = { EMAIL: 0, IBAN: 1, CARD: 2, NATIONAL_ID: 3, PHONE: 4, POSTCODE: 5 };

export function detectRules(text) {
  const spans = [];
  for (const d of DETECTORS) {
    for (const m of text.matchAll(d.re)) {
      const t = m[0].trim();
      if (d.ok && !d.ok(t)) continue;
      const start = m.index + m[0].indexOf(t);
      spans.push({ start, end: start + t.length, text: t, type: d.type, by: "rule" });
    }
  }
  return resolveOverlaps(spans);
}

// Keep the longest span; on a tie, the higher-priority type. Drops spans nested in kept ones.
export function resolveOverlaps(spans) {
  const sorted = [...spans].sort((a, b) =>
    (b.end - b.start) - (a.end - a.start) || (PRIORITY[a.type] ?? 9) - (PRIORITY[b.type] ?? 9) || a.start - b.start);
  const kept = [];
  for (const s of sorted) if (!kept.some((k) => s.start < k.end && k.start < s.end)) kept.push(s);
  return kept.sort((a, b) => a.start - b.start);
}

export const _test = { luhn, ibanValid, tcknValid };
