// Batch mode: many short documents, each scanned on this device, masked with one shared placeholder map.

// One document per non-empty line. A CSV line keeps its first field; surrounding quotes are removed.
export function parseDocs(raw) {
  const docs = [];
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    if (line.startsWith('"')) {
      const end = line.indexOf('",');
      line = (end > 0 ? line.slice(1, end) : line.replace(/^"|"$/g, '')).replace(/""/g, '"');
    }
    if (/^text$/i.test(line)) continue; // header row
    docs.push(line);
  }
  return docs;
}

// Fictional support tickets for the demo, generated in the browser. Same seed, same tickets.
const FIRST = ['Maria', 'James', 'Aylin', 'Kenji', 'Fatima', 'Lucas', 'Elif', 'Noah', 'Priya', 'Omar', 'Sofia', 'Daniel',
  'Zeynep', 'Ivan', 'Chloe', 'Mateo', 'Hana', 'Leo', 'Amara', 'Jonas', 'Ines', 'Tariq', 'Nora', 'Emre', 'Grace'];
const LAST = ['Lopez', 'Carter', 'Demir', 'Sato', 'Haddad', 'Moreau', 'Kaya', 'Fischer', 'Raman', 'Aziz', 'Rossi', 'Kim',
  'Yilmaz', 'Petrov', 'Dubois', 'Garcia', 'Tanaka', 'Berg', 'Okoye', 'Nilsson', 'Walsh', 'Novak', 'Celik', 'Brandt'];
const PLACES = ['12 Elm Road, Leeds LS6 2AB', '7 Rue Victor Hugo, Lyon', '41 Bagdat Avenue, Istanbul', '88 King Street, Manchester M2 4WU',
  '5 Harbour View, Bristol BS1 5TT', '19 Linden Strasse, Berlin', '230 Queen Street, Auckland', '3 Canal Walk, Dublin'];
const ISSUES = [
  'My order never arrived at {place}.',
  'I was charged twice for the same order.',
  'The jacket arrived damaged and I want a refund.',
  'I ordered size M but received size L.',
  'I cannot log in since the last update.',
  'Please cancel my subscription before the next payment.',
  'The courier left the parcel at {place} but I live elsewhere.',
  'The refund you promised has not reached my account.',
];
const CONTACT = [
  'You can reach me at {email}.',
  'Call me on {phone}.',
  'Please refund to IBAN {iban}.',
  'Thanks.',
];
// IBANs from the published examples of each country's format (they pass the mod-97 check).
const IBANS = ['GB33BUKB20201555555555', 'DE89370400440532013000', 'FR1420041010050500013M02606', 'TR330006100519786457841326'];

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

// Same tickets as before, plus the values the generator put into each one, so a run can be scored against them.
// Every pick happens in the same order as the original one-liner, so the tickets do not change.
export function sampleTicketsWithTruth(n = 500, seed = 7) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const docs = [], truth = [];
  for (let i = 0; i < n; i++) {
    const first = pick(FIRST), last = pick(LAST);
    const t = { first, last, place: null, email: null, phone: null, iban: null };
    const fill = (s) => {
      const place = pick(PLACES);
      const email = `${first.toLowerCase()}.${last.toLowerCase()}@example.com`;
      const phone = `+44 7700 900${String(100 + Math.floor(r() * 900))}`;
      const iban = pick(IBANS);
      if (s.includes('{place}')) t.place = place;
      if (s.includes('{email}')) t.email = email;
      if (s.includes('{phone}')) t.phone = phone;
      if (s.includes('{iban}')) t.iban = iban;
      return s.replace('{place}', place).replace('{email}', email).replace('{phone}', phone).replace('{iban}', iban);
    };
    const issue = fill(pick(ISSUES));
    const contact = fill(pick(CONTACT));
    docs.push(`Ticket ${1001 + i}: Hi, this is ${first} ${last}. ${issue} ${contact}`);
    truth.push(t);
  }
  return { docs, truth };
}

export function sampleTickets(n = 500, seed = 7) {
  return sampleTicketsWithTruth(n, seed).docs;
}

// Scores masked rows against the generator's values. A name counts as masked only if neither the first nor the last
// name is left in the row; every other value must be gone completely.
export function scoreMasked(rows, truth) {
  const s = { names: [0, 0], addresses: [0, 0], contacts: [0, 0], leaks: [] };
  const word = (v) => new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  rows.forEach((row, i) => {
    const t = truth[i];
    const nameLeft = word(t.first).test(row) || word(t.last).test(row);
    s.names[1]++; if (!nameLeft) s.names[0]++; else s.leaks.push(`${1001 + i}: name`);
    if (t.place) { s.addresses[1]++; if (!row.includes(t.place)) s.addresses[0]++; else s.leaks.push(`${1001 + i}: address`); }
    for (const v of [t.email, t.phone, t.iban]) if (v) { s.contacts[1]++; if (!row.includes(v)) s.contacts[0]++; else s.leaks.push(`${1001 + i}: contact`); }
  });
  return s;
}
