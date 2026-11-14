// Redact & Ask — UI wiring. All sample text is fictional.
import { detectRules } from './js/rules.js';
import { mask, unmask, entitiesToSpans, unknownPlaceholders } from './js/mask.js';
import * as ai from './js/ai.js';

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
  d.textContent = s.device === 'available' ? 'On-device model ready · works offline' : `on-device model: ${s.device}`;
  d.className = 'badge' + (s.device === 'available' ? '' : ' warn');
  c.textContent = s.firebase ? 'cloud: Firebase AI Logic connected' : s.configured ? 'cloud: connects on first scan' : 'cloud: not configured (local-only mode)';
  c.className = 'badge' + (s.firebase ? '' : ' warn');
  if (s.firebase) ai.appCheckStatus().then((v) => { c.textContent += v === 'verified' ? ' · App Check verified' : ` · App Check: ${v}`; c.title = v; });
  for (const b of $('tasks').querySelectorAll('button')) b.disabled = !s.firebase;
  $('taskInfo').textContent = s.firebase ? 'Only the masked text on the left is sent.' : 'Cloud tasks are disabled until the Firebase project is configured. Masking works without it.';
}

$('scan').addEventListener('click', async () => {
  $('scan').disabled = true; $('scanInfo').textContent = 'scanning on this device…';
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

refreshBadges();
