// Redact & Ask — UI wiring. All sample text is fictional.
import { detectRules } from './js/rules.js';
import { mask, unmask, entitiesToSpans, unknownPlaceholders } from './js/mask.js';
import * as ai from './js/ai.js';
import { parseDocs, sampleTickets } from './js/batch.js';

const SAMPLE = `Dear Dr. Elena Marsh,

I am writing on behalf of my client, Tomasz Wieczorek (born 14 March 1987), regarding the
lease at 42 Harbour Lane, Flat 3, Bristol BS1 4QA. He can be reached at +44 7700 900123 or
tomasz.w@example.com. Please send the deposit refund of GBP 1,250 to IBAN GB33BUKB20201555555555.

His employer, Northfield Logistics Ltd, confirmed the dates in a letter signed by Priya Natarajan.

Kind regards,
Samuel Okafor, Okafor & Reed Solicitors`;

const TASKS = [
  { id: 'summary', label: 'Summarise', instruction: 'Summarise the text in three short bullet points.' },
  { id: 'reply', label: 'Draft a reply', instruction: 'Draft a polite, brief reply to this letter.', heavy: true },
  { id: 'translate', label: 'Translate to Turkish', instruction: 'Translate the text into Turkish.', heavy: true },
  { id: 'actions', label: 'List action items', instruction: 'List the action items in the text, one per line.' },
];

const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const hl = (s) => esc(s).replace(/\[[A-Z_]+_\d+\]/g, (m) => `<mark>${m}</mark>`);
const state = { text: '', spans: [], masked: '', map: {} };

$('src').value = SAMPLE;

function renderReview() {
  const { masked, map } = mask(state.text, state.spans);
  state.masked = masked; state.map = map;
  $('masked').innerHTML = hl(masked);
  $('map').querySelector('tbody').innerHTML = Object.entries(map)
    .map(([ph, v]) => `<tr><td><mark>${ph}</mark></td><td>${esc(v.value)}</td><td>${esc(v.by)}</td></tr>`).join('');
  $('reviewCard').classList.remove('hidden'); $('taskCard').classList.remove('hidden');
}

async function refreshBadges() {
  const s = await ai.status();
  const d = $('deviceBadge'), c = $('cloudBadge');
  d.textContent = s.device === 'available' ? 'On-device model ready · scan uses no network' : `on-device model: ${s.device}`;
  d.className = 'badge' + (s.device === 'available' ? '' : ' warn');
  c.textContent = s.firebase ? 'cloud: Firebase AI Logic connected' : s.configured ? 'cloud: connects on first scan' : 'cloud: not configured (local-only mode)';
  c.className = 'badge' + (s.firebase ? '' : ' warn');
  if (s.firebase) ai.appCheckStatus().then((v) => { c.textContent += v === 'verified' ? ' · App Check verified' : ` · App Check: ${v}`; c.title = v; });
  for (const b of $('tasks').querySelectorAll('button')) b.disabled = !s.firebase;
  $('taskInfo').textContent = s.firebase ? 'Only the masked text on the left is sent.' : 'Cloud tasks are disabled until the Firebase project is configured. Masking works without it.';
}

$('scan').addEventListener('click', async () => {
  $('scan').disabled = true; $('scanInfo').textContent = state.text ? 'scanning on this device…' : 'scanning on this device… the first scan also loads the on-device model, so it takes longer';
  state.text = $('src').value;
  const t0 = performance.now();
  state.spans = detectRules(state.text);
  let note = '';
  try {
    await ai.init((p) => { $('scanInfo').textContent = `downloading on-device model ${(p * 100).toFixed(0)}%`; });
    const { entities, engine } = await ai.detect(state.text);
    state.spans = [...state.spans, ...entitiesToSpans(state.text, entities, engine)];
  } catch (e) { note = ' · ' + e.message; }
  renderReview();
  $('scanInfo').textContent = `${Object.keys(state.map).length} values masked in ${((performance.now() - t0) / 1000).toFixed(1)} s${note}`;
  $('resultCard').classList.add('hidden');
  $('scan').disabled = false;
  refreshBadges();
});

$('addExtra').addEventListener('click', () => {
  const v = $('extra').value.trim();
  if (v.length < 2 || !state.text.includes(v)) { $('extra').value = ''; $('extra').placeholder = 'Not found in the document. Type it exactly'; return; }
  state.spans = [...state.spans, ...entitiesToSpans(state.text, [{ text: v, type: 'CUSTOM' }], 'you')];
  $('extra').value = '';
  renderReview();
});

for (const t of TASKS) {
  const b = document.createElement('button');
  b.textContent = t.label; b.disabled = true;
  b.addEventListener('click', async () => {
    $('taskInfo').textContent = `${t.label}: working…`;
    try {
      const { text, where } = await ai.answer(t, state.masked);
      const unknown = unknownPlaceholders(text, state.map);
      $('rawAnswer').innerHTML = hl(text);
      $('answer').textContent = unmask(text, state.map);
      $('resultInfo').textContent = `Ran: ${where}.` + (unknown.length ? ` The answer mentions placeholders that are not in your map: ${unknown.join(', ')}.` : '');
      $('resultCard').classList.remove('hidden');
      $('taskInfo').textContent = 'Only the masked text on the left was sent.';
    } catch (e) { $('taskInfo').textContent = `${t.label} failed: ${e.message}`; }
  });
  $('tasks').appendChild(b);
}

// ---- Many documents ----
const batch = { docs: [], rows: [], done: 0, shared: null, stop: false, from: 0, to: 0 };
// Only the first `done` rows have been checked by the model; the rest are masked by the rules alone and may still
// contain names, so they are never downloaded or sent.
const checked = () => batch.rows.slice(0, batch.done);
// Counts every request this page makes while the batch runs, measured by the browser (Resource Timing).
let netCount = 0;
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if (e.startTime >= batch.from && (!batch.to || e.startTime <= batch.to)) netCount++;
  if (batch.from) $('batchNet').textContent = `network requests during the batch: ${netCount}`;
}).observe({ type: 'resource' });

function loadDocs(docs, label) {
  batch.docs = docs; batch.rows = []; batch.done = 0; batch.from = batch.to = 0;
  $('batchFast').textContent = '';
  $('batchCount').textContent = `0 / ${docs.length}`;
  $('batchInfo').textContent = `${docs.length} documents loaded${label}`;
  $('batchRun').disabled = !docs.length;
  $('batchAsk').disabled = $('batchDownload').disabled = true;
  $('batchPreview').classList.add('hidden'); $('batchAnswer').classList.add('hidden'); $('batchAskInfo').textContent = '';
}

$('batchSample').addEventListener('click', () => loadDocs(sampleTickets(500), ' (fictional, generated in this browser)'));
$('batchFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) loadDocs(parseDocs(await f.text()), ` from ${f.name}`);
});

$('batchRun').addEventListener('click', async () => {
  const docs = batch.docs;
  batch.rows = []; batch.done = 0; batch.shared = { byValue: new Map(), counters: {}, map: {} }; batch.stop = false;
  $('batchRun').disabled = true; $('batchStop').disabled = false; $('batchAsk').disabled = $('batchDownload').disabled = true;
  let note = '';
  try { await ai.init(); } catch (e) { note = ' · ' + e.message; }
  netCount = 0; batch.to = 0; batch.from = performance.now();
  $('batchNet').textContent = 'network requests during the batch: 0';
  // Fast pass: the rules mask every IBAN, card, e-mail, phone and ID in all documents at once (milliseconds), so the
  // masked lines are safe before the slower model pass for names and addresses starts.
  const f0 = performance.now();
  const ruleSpans = docs.map((d) => detectRules(d));
  batch.rows = docs.map((d, i) => mask(d, ruleSpans[i], batch.shared).masked);
  const fastMs = performance.now() - f0;
  const fastCount = Object.keys(batch.shared.map).length;
  $('batchFast').textContent = `Rules pass: ${fastCount} bank details, e-mails, phone numbers and IDs masked in ${docs.length} documents in ${fastMs < 10 ? fastMs.toFixed(1) : fastMs.toFixed(0)} ms.`;
  $('batchPreview').textContent = batch.rows.slice(0, 4).join('\n');
  $('batchPreview').classList.remove('hidden');
  const t0 = performance.now();
  for (let i = 0; i < docs.length && !batch.stop; i++) {
    let spans = ruleSpans[i];
    try {
      let { entities, engine } = await ai.detect(docs[i]);
      // In the 500-ticket run the model returned nothing usable for 15 tickets that each had a name; one retry is
      // cheap because it only happens when nothing was found.
      if (!entities.length) ({ entities, engine } = await ai.detect(docs[i]));
      spans = [...spans, ...entitiesToSpans(docs[i], entities, engine)];
    } catch (e) {
      // Without a model check a line may still hold a name: stop here so it can never be downloaded or sent.
      note = ` · ${e.message} Stopped after ${i} documents; the rest are masked by the rules only and are not sent or downloaded.`;
      break;
    }
    batch.rows[i] = mask(docs[i], spans, batch.shared).masked;
    batch.done = i + 1;
    const s = (performance.now() - t0) / 1000;
    $('batchCount').textContent = `${i + 1} / ${docs.length}`;
    $('batchInfo').textContent = `Names and addresses (on-device model): ${s.toFixed(0)} s elapsed · ${(s / (i + 1)).toFixed(2)} s per document${note}`;
    $('batchPreview').textContent = batch.rows.slice(Math.max(0, i - 3), i + 1).join('\n');
  }
  batch.to = performance.now();
  const s = (batch.to - t0) / 1000;
  $('batchInfo').textContent = `Names and addresses: ${batch.done} documents checked by the on-device model in ${s.toFixed(0)} s (${(s / Math.max(1, batch.done)).toFixed(2)} s each) · ${Object.keys(batch.shared.map).length} distinct personal values${note}`;
  $('batchRun').disabled = false; $('batchStop').disabled = true;
  $('batchDownload').disabled = !batch.done;
  await refreshBadges();
  $('batchAsk').disabled = !batch.done || $('tasks').querySelector('button').disabled;
});
$('batchStop').addEventListener('click', () => { batch.stop = true; });

$('batchDownload').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([checked().join('\n') + '\n'], { type: 'text/plain' }));
  a.download = 'masked.txt'; a.click(); URL.revokeObjectURL(a.href);
});

$('batchAsk').addEventListener('click', async () => {
  const rows = checked();
  $('batchAskInfo').textContent = `Sending ${rows.length} masked lines to the cloud…`;
  // No counts: asked for them, the model's group sizes added up to 378 for 500 tickets.
  const task = { heavy: true, instruction: 'These are customer support tickets. Group them by the problem they describe. For each group give a short name and two example ticket numbers. Do not count the tickets.' };
  try {
    const { text, where } = await ai.answer(task, rows.join('\n'));
    // The model answers in Markdown; show it as plain text without the ** and * markers.
    $('batchAnswer').textContent = unmask(text, batch.shared.map).replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\* /gm, '• ');
    $('batchAnswer').classList.remove('hidden');
    $('batchAskInfo').textContent = `Ran: ${where}. The cloud saw ${rows.length} masked lines.`;
  } catch (e) { $('batchAskInfo').textContent = `Failed: ${e.message}`; }
});

refreshBadges();
// Warm the on-device model on the first gesture so the first scan does not wait for it to load.
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => ai.warm(), { once: true, capture: true });
