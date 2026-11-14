// Unit tests for the deterministic core (no model, no network). Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectRules, _test } from "../app/js/rules.js";
import { parseEntities } from "../app/js/ai.js";
import { mask, unmask, entitiesToSpans, unknownPlaceholders } from "../app/js/mask.js";

test("validators", () => {
  assert.equal(_test.ibanValid("GB33BUKB20201555555555"), true);
  assert.equal(_test.ibanValid("GB33BUKB20201555555556"), false);
  assert.equal(_test.ibanValid("TR33 0006 1005 1978 6457 8413 26"), true);
  assert.equal(_test.luhn("4111111111111111"), true);
  assert.equal(_test.luhn("4111111111111112"), false);
  assert.equal(_test.tcknValid("10000000146"), true);
  assert.equal(_test.tcknValid("10000000147"), false);
});

test("rules find validated identifiers and skip look-alikes", () => {
  const text = "Mail a.b@example.com, IBAN GB33BUKB20201555555555, card 4111 1111 1111 1111, " +
    "bad card 4111 1111 1111 1112, TCKN 10000000146, phone +44 7700 900123, ref 2026-11-14.";
  const types = detectRules(text).map((s) => s.type + ":" + s.text);
  assert.ok(types.includes("EMAIL:a.b@example.com"));
  assert.ok(types.includes("IBAN:GB33BUKB20201555555555"));
  assert.ok(types.includes("CARD:4111 1111 1111 1111"));
  assert.ok(!types.some((t) => t.includes("1112")), "invalid card must not be flagged as a card");
  assert.ok(types.includes("NATIONAL_ID:10000000146"));
  assert.ok(types.includes("PHONE:+44 7700 900123"));
  assert.ok(!types.some((t) => t.includes("2026-11-14")), "a plain date is not a phone number");
});

test("mask numbers by first appearance and reuses placeholders", () => {
  const text = "Ana met Ben. Ben called Ana.";
  const spans = entitiesToSpans(text, [{ text: "Ana", type: "PERSON" }, { text: "Ben", type: "PERSON" }]);
  const { masked, map } = mask(text, spans);
  assert.equal(masked, "[PERSON_1] met [PERSON_2]. [PERSON_2] called [PERSON_1].");
  assert.equal(map["[PERSON_1]"].value, "Ana");
});

test("unmask tolerates spacing and case, and reports invented placeholders", () => {
  const map = { "[PERSON_1]": { value: "Ana", type: "PERSON" } };
  assert.equal(unmask("Hi [ person_1 ] and [Person_1].", map), "Hi Ana and Ana.");
  assert.deepEqual(unknownPlaceholders("Hi [PERSON_1] and [PERSON_7].", map), ["[PERSON_7]"]);
});

test("longer span wins on overlap (address beats postcode inside it)", () => {
  const text = "Lives at 42 Harbour Lane, Bristol BS1 4QA now.";
  const spans = [...detectRules(text), ...entitiesToSpans(text, [{ text: "42 Harbour Lane, Bristol BS1 4QA", type: "ADDRESS" }])];
  const { masked } = mask(text, spans);
  assert.equal(masked, "Lives at [ADDRESS_1] now.");
});

test("model output parser keeps only typed values that occur in the text", () => {
  const text = "Ana Li lives at 4 Elm Road. Ref 77.";
  const raw = "PERSON|Ana Li\nADDRESS|4 Elm Road\nPERSON|Bob Stone\nCOLOR|Ref 77\nnonsense line";
  assert.deepEqual(parseEntities(raw, text), [{ text: "Ana Li", type: "PERSON" }, { text: "4 Elm Road", type: "ADDRESS" }]);
});

test("phone rule handles French-style groups and ignores dates, amounts and versions", () => {
  const found = detectRules("Call +33 6 12 34 56 78 or 0532 555 01 23. Due 2026-12-01, total 1,250,000 EUR, v4.2.1.").filter((s) => s.type === "PHONE").map((s) => s.text);
  assert.deepEqual(found, ["+33 6 12 34 56 78", "0532 555 01 23"]);
});
