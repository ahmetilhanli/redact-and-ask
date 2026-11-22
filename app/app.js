// Redact & Ask — UI wiring. All sample text is fictional.
import { detectRules } from './js/rules.js';
import { mask, unmask, entitiesToSpans, checkAnswer } from './js/mask.js';
import * as ai from './js/ai.js';
import { parseDocs, sampleTicketsWithTruth, scoreMasked } from './js/batch.js';
import * as history from './js/history.js';

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
const state = { text: '', spans: [], masked: '', map: {}, modelChecked: false, userChecked: false, answer: '' };

// ---- What left this device ----
// The page records its own traffic: every request it makes after loading (browser Resource Timing) and, for requests
// to the cloud model, the text that was sent. The log stays in the page; nothing is sent anywhere.
const loadedAt = performance.now();
const pageRequests = [];
const modelRequests = []; // newest first
const browserFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  try {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const call = url.pathname.match(/:(generateContent|streamGenerateContent|countTokens)$/);
    if (call && typeof init.body === 'string') {
      const sent = (JSON.parse(init.body).contents || []).flatMap((c) => (c.parts || []).map((p) => p.text || '')).join('\n');
      modelRequests.unshift({ n: modelRequests.length + 1, host: url.host, call: call[1], text: sent });
      renderNet();
    }
  } catch { /* the log must never block or change a request */ }
  return browserFetch(input, init);
};
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if (e.startTime >= loadedAt) pageRequests.push(new URL(e.name).host);
  renderNet();
}).observe({ type: 'resource' });

// What each host is for, and what this app hands it. Anything not listed is shown as unexpected.
const HOSTS = [
  [/^firebasevertexai\.googleapis\.com$/, 'cloud model (Firebase AI Logic)', 'masked text only, shown below'],
  [/^firestore\.googleapis\.com$/, 'masked history (only when you save)', 'masked text only'],
  [/^(identitytoolkit|securetoken)\.googleapis\.com$/, 'anonymous sign-in for the history', 'no document text'],
  [/^firebaseremoteconfig\.googleapis\.com$/, 'Remote Config (routing)', 'no document text'],
  [/^firebaseinstallations\.googleapis\.com$/, 'Remote Config installation ID', 'no document text'],
  [/^content-firebaseappcheck\.googleapis\.com$/, 'App Check token', 'no document text'],
  [/^www\.(google|gstatic)\.com$/, 'reCAPTCHA for App Check, Firebase SDK files', 'no document text'],
  [new RegExp('^' + location.hostname.replace(/\./g, '\\.') + '$'), "this app's own files", 'no document text'],
];
function renderNet() {
  $('netCount').textContent = `requests since the page loaded: ${pageRequests.length}`;
  $('netCount').className = 'badge' + (pageRequests.length ? ' warn' : '');
  const byHost = {};
  for (const h of pageRequests) byHost[h] = (byHost[h] || 0) + 1;
  $('netHosts').innerHTML = pageRequests.length
    ? Object.entries(byHost).map(([h, n]) => {
      const k = HOSTS.find(([re]) => re.test(h));
      return `<div>${esc(h)} (${n}) · ${k ? `${k[1]} · <strong>${k[2]}</strong>` : '<strong>unexpected host: check it</strong>'}</div>`;
    }).join('')
    : 'Nothing has left this device.';
  $('netList').innerHTML = modelRequests.slice(0, 10).map((r) =>
    `<p class="muted" style="margin:12px 0 6px">Cloud request ${r.n} · ${esc(r.host)} · ${r.call} · ${r.text.length} characters sent</p><pre>${hl(r.text)}</pre>`).join('');
}

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
  d.textContent = s.device === 'available' ? 'On-device model ready · the scan sends no document text' : `on-device model: ${s.device}`;
  d.className = 'badge' + (s.device === 'available' ? '' : ' warn');
  c.textContent = s.firebase ? 'cloud: Firebase AI Logic connected' : s.configured ? 'cloud: connects on first scan' : 'cloud: not configured (local-only mode)';
  c.className = 'badge' + (s.firebase ? '' : ' warn');
  if (s.firebase) ai.appCheckStatus().then((v) => { c.textContent += v === 'verified' ? ' · App Check verified' : ` · App Check: ${v}`; c.title = v; });
  // Without an on-device check, the masked text may still hold names and addresses: no cloud task until the user
  // has checked it (the batch has the same rule: lines the model has not checked are never sent).
  const unchecked = state.text && !state.modelChecked && !state.userChecked;
  for (const b of $('tasks').querySelectorAll('button')) b.disabled = !s.firebase || unchecked;
  $('taskInfo').textContent = !s.firebase ? 'Cloud tasks are disabled until the Firebase project is configured. Masking works without it.'
    : unchecked ? 'Cloud tasks are off: no on-device model checked this text for names and addresses. Read it above, mask anything missed, then tick the box.'
    : 'Only the masked text on the left is sent.';
}

$('scan').addEventListener('click', async () => {
  $('scan').disabled = true; $('scanInfo').textContent = state.text || ai.isWarm() ? 'scanning on this device…' : 'scanning on this device… the first scan also loads the on-device model, so it takes longer';
  state.text = $('src').value;
  const t0 = performance.now();
  state.spans = detectRules(state.text);
  state.modelChecked = false; state.userChecked = false; $('selfCheck').checked = false;
  let note = '';
  try {
    await ai.init((p) => { $('scanInfo').textContent = `downloading on-device model ${(p * 100).toFixed(0)}%`; });
    const { entities, engine } = await ai.detect(state.text);
    state.spans = [...state.spans, ...entitiesToSpans(state.text, entities, engine)];
    state.modelChecked = true;
  } catch (e) { note = ' · ' + e.message; }
  $('selfCheckRow').classList.toggle('hidden', state.modelChecked);
  renderReview();
  $('scanInfo').textContent = `${Object.keys(state.map).length} values masked in ${((performance.now() - t0) / 1000).toFixed(1)} s${note}`;
  $('resultCard').classList.add('hidden');
  $('scan').disabled = false;
  refreshBadges();
  showRouting(); setTimeout(showRouting, 3000); // Remote Config arrives in the background
});

$('selfCheck').addEventListener('change', () => { state.userChecked = $('selfCheck').checked; refreshBadges(); });

$('addExtra').addEventListener('click', () => {
  const v = $('extra').value.trim();
  if (v.length < 2 || !state.text.includes(v)) { $('extra').value = ''; $('extra').placeholder = 'Not found in the document. Type it exactly'; return; }
  state.spans = [...state.spans, ...entitiesToSpans(state.text, [{ text: v, type: 'CUSTOM' }], 'you')];
  $('extra').value = '';
  renderReview();
});

// The answer is checked on this device before anything is filled back in (mask.js checkAnswer).
function renderAnswer() {
  const text = state.answer;
  const check = checkAnswer(text, state.map);
  const invented = new Set(check.unknown.map((u) => u.placeholder));
  $('rawAnswer').innerHTML = esc(text).replace(/\[\s*[A-Za-z_]+?_\d+\s*\]/g, (m) => `<mark${invented.has(m) ? ' class="bad"' : ''}>${m}</mark>`);
  $('answer').textContent = unmask(text, state.map);
  const box = $('answerCheck');
  box.innerHTML = `<strong>Answer check, on this device:</strong> ${check.restored} placeholder${check.restored === 1 ? '' : 's'} filled back in`
    + ` · your real values found in the answer: <strong>${check.realValues.length} of ${check.valuesChecked}</strong>`;
  box.classList.toggle('bad', check.unknown.length > 0 || check.realValues.length > 0);
  for (const u of check.unknown) {
    const line = document.createElement('div');
    line.textContent = `${u.placeholder} is not one of your placeholders: the model made it up, so it is left as it is. `;
    if (u.suggestion) {
      const b = document.createElement('button');
      b.className = 'small';
      b.textContent = `Use ${u.suggestion} instead`;
      b.addEventListener('click', () => { state.answer = state.answer.split(u.placeholder).join(u.suggestion); renderAnswer(); });
      line.append(`It most likely means ${u.suggestion}. `, b);
    }
    box.appendChild(line);
  }
  if (check.realValues.length) {
    const line = document.createElement('div');
    line.textContent = 'The cloud never received these values, so the model guessed them. Check them before you use the answer.';
    box.appendChild(line);
  }
}

function showRouting() {
  const r = ai.routing();
  $('routingInfo').textContent = !r.cloudEnabled
    ? `Routing (${r.source}): cloud tasks are switched off; every task stays on this device.`
    : `Routing (${r.source}): masked text over ${r.heavyMinChars.toLocaleString('en-US')} characters, replies and translations go to the cloud model; shorter tasks prefer this device.`;
}

// ---- Masked history (Firebase Authentication + Cloud Firestore) ----
const when = (ts) => (ts && ts.toDate ? ts.toDate().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'just now');
async function renderHistory() {
  const items = await history.list(5);
  const reveal = $('historyReveal').checked;
  $('historyList').innerHTML = items.length ? items.map((it) => `<div class="hist"><p class="muted">${esc(when(it.createdAt))} · ${esc(it.task)} · ${esc(it.where)} · ${it.values} values masked</p><pre>${hl(reveal ? unmask(it.answer, state.map) : it.answer)}</pre></div>`).join('')
    : '<p class="muted">Nothing saved yet.</p>';
}
$('saveHistory').addEventListener('click', async () => {
  $('saveHistory').disabled = true; $('savedInfo').textContent = 'saving…';
  try {
    const doc = await history.save({ task: state.lastTask, where: state.lastWhere, masked: state.masked, answer: state.answer, values: Object.keys(state.map).length });
    $('savedInfo').textContent = `Saved to Firestore: task, where it ran, the masked text (${doc.masked.length} characters), the answer with placeholders and a count of ${doc.values} values. No real values.`;
    await renderHistory();
  } catch (e) { $('savedInfo').textContent = `Not saved: ${e.message}`; $('saveHistory').disabled = false; }
});
$('showHistory').addEventListener('click', () => renderHistory().catch((e) => { $('historyList').innerHTML = `<p class="muted">History unavailable: ${esc(e.message)}</p>`; }));
$('historyReveal').addEventListener('change', () => renderHistory().catch(() => {}));

for (const t of TASKS) {
  const b = document.createElement('button');
  b.textContent = t.label; b.disabled = true;
  b.addEventListener('click', async () => {
    $('taskInfo').textContent = `${t.label}: working…`;
    try {
      const { text, where } = await ai.answer(t, state.masked);
      state.answer = text; state.lastTask = t.label; state.lastWhere = where;
      renderAnswer();
      $('resultInfo').textContent = `Ran: ${where}.`;
      $('saveHistory').disabled = false; $('savedInfo').textContent = '';
      $('resultCard').classList.remove('hidden');
      $('taskInfo').textContent = 'Only the masked text on the left was sent.';
    } catch (e) { $('taskInfo').textContent = `${t.label} failed: ${e.message}`; }
    showRouting();
  });
  $('tasks').appendChild(b);
}

// ---- Many documents ----
const batch = { docs: [], rows: [], done: 0, shared: null, stop: false, from: 0, to: 0, truth: null };
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
  batch.docs = docs; batch.rows = []; batch.done = 0; batch.from = batch.to = 0; batch.truth = null;
  $('batchScore').textContent = '';
  $('batchFast').textContent = '';
  $('batchCount').textContent = `0 / ${docs.length}`;
  $('batchInfo').textContent = `${docs.length} documents loaded${label}`;
  $('batchRun').disabled = !docs.length;
  $('batchAsk').disabled = $('batchDownload').disabled = true;
  $('batchPreview').classList.add('hidden'); $('batchAnswer').classList.add('hidden'); $('batchAskInfo').textContent = '';
}

$('batchSample').addEventListener('click', () => {
  const { docs, truth } = sampleTicketsWithTruth(500);
  loadDocs(docs, ' (fictional, generated in this browser)');
  batch.truth = truth; // the values the generator put in, used to score the run when it ends
});
// The browser's own file control is labelled in the browser's language; this button keeps the page in English.
$('batchPick').addEventListener('click', () => $('batchFile').click());
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
  if (batch.truth && batch.done) {
    const sc = scoreMasked(batch.rows.slice(0, batch.done), batch.truth);
    const leaks = sc.leaks.length ? ` · left unmasked: ${sc.leaks.slice(0, 5).join(', ')}${sc.leaks.length > 5 ? ', …' : ''}` : '';
    $('batchScore').textContent = `Checked against the values the ticket generator put in: names masked in ${sc.names[0]} of ${sc.names[1]} tickets · addresses ${sc.addresses[0]} of ${sc.addresses[1]} · e-mails, phones and IBANs ${sc.contacts[0]} of ${sc.contacts[1]}${leaks}.`;
  }
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
