// Masked history: Firebase Authentication (anonymous) + Cloud Firestore. A saved entry holds only the masked text
// and the model's answer with placeholders. The placeholder map stays in this tab's memory and is never stored, so
// after a reload not even the owner (or this app's backend) can see the real values again.
import { getFirebaseApp, SDK } from './ai.js';

let ready = null;

function connect() {
  if (!ready) ready = (async () => {
    const app = getFirebaseApp();
    if (!app) throw new Error('Run a scan first: it connects Firebase.');
    const [auth, fs] = await Promise.all([import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`)]);
    const a = auth.getAuth(app);
    const user = a.currentUser || (await auth.signInAnonymously(a)).user;
    const col = fs.collection(fs.getFirestore(app), 'users', user.uid, 'history');
    return { fs, col };
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// Stores one entry. Returns exactly what was written (minus the server timestamp), so the page can show it.
export async function save({ task, where, masked, answer, values }) {
  const { fs, col } = await connect();
  const doc = { task, where, masked: masked.slice(0, 6000), answer: answer.slice(0, 6000), values };
  await fs.addDoc(col, { ...doc, createdAt: fs.serverTimestamp() });
  return doc;
}

export async function list(n = 5) {
  const { fs, col } = await connect();
  const snap = await fs.getDocs(fs.query(col, fs.orderBy('createdAt', 'desc'), fs.limit(n)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
