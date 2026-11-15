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

export function sampleTickets(n = 500, seed = 7) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const out = [];
  for (let i = 0; i < n; i++) {
    const first = pick(FIRST), last = pick(LAST);
    const fill = (s) => s
      .replace('{place}', pick(PLACES))
      .replace('{email}', `${first.toLowerCase()}.${last.toLowerCase()}@example.com`)
      .replace('{phone}', `+44 7700 900${String(100 + Math.floor(r() * 900))}`)
      .replace('{iban}', pick(IBANS));
    out.push(`Ticket ${1001 + i}: Hi, this is ${first} ${last}. ${fill(pick(ISSUES))} ${fill(pick(CONTACT))}`);
  }
  return out;
}
