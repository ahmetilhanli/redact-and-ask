// Model access. One place decides where a request runs:
//   detect()  -> ONLY on this device (raw text never leaves the browser)
//   answer()  -> hybrid: short tasks prefer the on-device model, long ones go to the cloud, and the
//                cloud only ever receives masked text.
import { firebaseConfig, appCheckSiteKey } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/13.3.0';
// Line format, not JSON: on this device it measured ~4x faster (2.1 s vs 8.6 s on the sample letter) because the
// model writes far fewer tokens. Without the "never write a TYPE with nothing after it" line the model filled empty
// types ("ORG|None") and sometimes broke the format: names found in 14 of 24 short tickets, against 23 of 24 with it
// (15 Nov, 0.9 s vs 0.7 s per ticket). On the 6-document eval set both found 35 of 35; the old prompt once missed 4.
const DETECT_PROMPT =
  'List every person name, street address, organisation, date of birth and identity number in the document. ' +
  'One per line as TYPE|exact text. TYPE is PERSON, ADDRESS, ORG, DATE_OF_BIRTH or ID_NUMBER. ' +
  'Copy each value exactly as written. Write only values that occur; never write a TYPE with nothing after it. ' +
  'No other words.\n\nDocument:\n';
const TYPES = ['PERSON', 'ADDRESS', 'ORG', 'DATE_OF_BIRTH', 'ID_NUMBER'];

let appCheckProbe = null; // set when App Check is initialised
let fb = null; // { deviceModel, hybridModel, cloudModel } once Firebase is initialised
let firebaseApp = null;

// Routing is tuned from Firebase Remote Config, so a team can change it without a new release:
// heavy_task_min_chars: masked text longer than this goes to the cloud model; shorter tasks prefer the device.
// cloud_tasks_enabled: false keeps every task on the device (the cloud is never called).
const ROUTING_DEFAULTS = { heavy_task_min_chars: 2500, cloud_tasks_enabled: true };
let routingState = { heavyMinChars: ROUTING_DEFAULTS.heavy_task_min_chars, cloudEnabled: true, source: 'built-in defaults' };
let routingReady = Promise.resolve();
export const routing = () => routingState;
export const getFirebaseApp = () => firebaseApp;
export { SDK };

// Must be called from a user gesture (Firebase requires this before the on-device model is used).
let initOnce = null; // concurrent callers (warm-up and scan) share one initialisation
export function init(onProgress) {
  if (!firebaseConfig || fb) return status();
  if (!initOnce) initOnce = doInit(onProgress).catch((e) => { initOnce = null; throw e; });
  return initOnce;
}

async function doInit(onProgress) {
  const [{ initializeApp }, appCheck, ai, rc] = await Promise.all([
    import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-app-check.js`), import(`${SDK}/firebase-ai.js`),
    import(`${SDK}/firebase-remote-config.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  firebaseApp = app;
  // App Check: on the hosted domain reCAPTCHA Enterprise attests the app. On localhost the site key is not valid,
  // so App Check runs only if a debug token was stored with localStorage.setItem('appCheckDebugToken', '<token>').
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const debugToken = local ? localStorage.getItem('appCheckDebugToken') : null;
  if (debugToken) self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
  if (appCheckSiteKey && (!local || debugToken)) {
    const instance = appCheck.initializeAppCheck(app, { provider: new appCheck.ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
    appCheckProbe = () => appCheck.getToken(instance, false);
  }
  // Remote Config is fetched in the background; a task waits for it at most 3 s, then uses the last known values.
  const config = rc.getRemoteConfig(app);
  config.settings.minimumFetchIntervalMillis = 10 * 60 * 1000;
  config.defaultConfig = ROUTING_DEFAULTS;
  routingReady = rc.fetchAndActivate(config).then(() => {
    const src = rc.getValue(config, 'heavy_task_min_chars').getSource();
    routingState = {
      heavyMinChars: rc.getNumber(config, 'heavy_task_min_chars') || ROUTING_DEFAULTS.heavy_task_min_chars,
      cloudEnabled: rc.getBoolean(config, 'cloud_tasks_enabled'),
      source: src === 'remote' ? 'Firebase Remote Config' : 'built-in defaults',
    };
  }).catch(() => {});
  const backend = ai.getAI(app, { backend: new ai.GoogleAIBackend() });
  fb = {
    // Firebase builds its on-device adapter only when the browser has the LanguageModel API. Without it, an
    // ONLY_ON_DEVICE model sends the request to the cloud (measured 15 Nov: the raw sample letter reached
    // generateContent). So the device model is used only when the API exists, checked here, not left to the SDK.
    onDevice: typeof LanguageModel !== 'undefined',
    deviceModel: ai.getGenerativeModel(backend, { mode: ai.InferenceMode.ONLY_ON_DEVICE }),
    hybridModel: ai.getGenerativeModel(backend, { mode: ai.InferenceMode.PREFER_ON_DEVICE }),
    cloudModel: ai.getGenerativeModel(backend, { mode: ai.InferenceMode.ONLY_IN_CLOUD }),
  };
  // Starts the on-device model download if needed. Not awaited without a limit: on a machine where the model is
  // already present this promise did not settle in testing, and generateContent works regardless.
  if (fb.deviceModel.initializeDeviceModel) {
    const ready = Promise.resolve(fb.deviceModel.initializeDeviceModel(onProgress || (() => {}))).catch(() => {});
    await Promise.race([ready, new Promise((r) => setTimeout(r, 1500))]);
  }
  return status();
}

// Loads the on-device model into memory ahead of the first scan. Chrome unloads an idle model, and reloading it
// took 15 to 28 s in testing, so this runs on the first user gesture instead of on the scan click. Sends no user text.
let warming = null, warmed = false;
export function warm() {
  if (!warming) warming = init().then(() => fb && fb.onDevice && fb.deviceModel.generateContent('Reply with OK.')).then((r) => { warmed = !!r; }).catch(() => {});
  return warming;
}

// True once the warm-up call has come back from the on-device model, so the next scan does not load it.
export const isWarm = () => warmed;

export async function status() {
  const device = typeof LanguageModel === 'undefined' ? 'unavailable' : await LanguageModel.availability();
  return { firebase: !!fb, configured: !!firebaseConfig, device };
}

// Banking and currency words the model sometimes returns as an ORG. In the 500-ticket run every "refund to IBAN ..."
// line came back with "IBAN" masked as an organisation.
const NOT_PERSONAL = new Set(['IBAN', 'BIC', 'SWIFT', 'GBP', 'EUR', 'USD', 'TRY', 'NONE', 'N/A', 'TICKET']);

export function parseEntities(raw, text) {
  const out = [];
  for (const line of raw.split('\n')) {
    const k = line.indexOf('|');
    if (k < 1) continue;
    const type = line.slice(0, k).trim().toUpperCase();
    const value = line.slice(k + 1).trim();
    // Keep only well-typed values that really occur in the text (drops anything the model invented).
    if (TYPES.includes(type) && value.length > 1 && !NOT_PERSONAL.has(value.toUpperCase()) && text.includes(value)) out.push({ text: value, type });
  }
  return out;
}

// On-device only. Returns { entities, engine } or throws if no on-device model exists.
export async function detect(text) {
  if (fb && fb.onDevice) {
    const res = await fb.deviceModel.generateContent(DETECT_PROMPT + text);
    return { entities: parseEntities(res.response.text(), text), engine: 'Gemini Nano via Firebase AI Logic (on-device)' };
  }
  if (typeof LanguageModel === 'undefined' || (await LanguageModel.availability()) !== 'available') {
    throw new Error('No on-device model in this browser. Rules still run; names and addresses need a manual check.');
  }
  const session = await LanguageModel.create({
    expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }],
  });
  try { return { entities: parseEntities(await session.prompt(DETECT_PROMPT + text), text), engine: 'Gemini Nano (on-device, Prompt API)' }; }
  finally { session.destroy(); }
}

// Runs a task on MASKED text. Long input or reasoning tasks go to the cloud; short ones prefer the device.
export async function answer(task, maskedText) {
  if (!fb) throw new Error('Cloud tasks need the Firebase project to be configured.');
  await Promise.race([routingReady, new Promise((r) => setTimeout(r, 3000))]);
  const { heavyMinChars, cloudEnabled } = routingState;
  const heavy = maskedText.length > heavyMinChars || task.heavy;
  const prompt = `${task.instruction}\nKeep every placeholder such as [PERSON_1] exactly as written; never guess what it stands for.\n\nText:\n${maskedText}`;
  if (!cloudEnabled) {
    // Cloud switched off in Remote Config: only the on-device model may answer, and heavy tasks are refused.
    if (heavy) throw new Error('Cloud tasks are switched off for this team (Remote Config). This task needs the cloud model.');
    if (!fb.onDevice) throw new Error('Cloud tasks are switched off for this team (Remote Config), and this browser has no on-device model.');
    const res = await fb.deviceModel.generateContent(prompt);
    return { text: res.response.text(), where: 'on this device only (cloud switched off in Remote Config)' };
  }
  const model = heavy ? fb.cloudModel : fb.hybridModel;
  const res = await model.generateContent(prompt);
  const where = heavy ? 'cloud (masked text only)'
    : fb.onDevice ? 'on-device preferred (cloud fallback, masked text only)' : 'cloud, no on-device model in this browser (masked text only)';
  return { text: res.response.text(), where };
}

// Reports whether App Check can attest this app: 'verified', 'off' (not initialised) or an error message.
export async function appCheckStatus() {
  if (!appCheckProbe) return 'off';
  const timeout = new Promise((r) => setTimeout(() => r('no answer after 10 s'), 10000));
  return Promise.race([appCheckProbe().then((t) => (t && t.token ? 'verified' : 'empty token')).catch((e) => String(e.message || e).slice(0, 160)), timeout]);
}
