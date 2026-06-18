import { initializeApp } from "firebase/app";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot,
} from "firebase/firestore";
import {
  getStorage, ref, uploadBytes, getDownloadURL,
} from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  // Surfaced clearly in the console if env vars are missing at build time.
  console.error("Missing Firebase env vars (VITE_FIREBASE_*). See README.");
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// One shared document holds the whole app's data; both accounts read & write it.
// Stored as a JSON string so empty/undefined fields never trip Firestore's type rules.
const STATE_DOC = doc(db, "app", "shared");

export async function loadState() {
  const snap = await getDoc(STATE_DOC);
  if (!snap.exists()) return null;
  const raw = snap.data().json;
  return raw ? JSON.parse(raw) : null;
}

export async function saveState(state) {
  await setDoc(STATE_DOC, { json: JSON.stringify(state), updatedAt: Date.now() });
}

// Live updates: fires when the other person changes anything.
// onSnapshot returns its own unsubscribe function.
export function subscribeState(cb) {
  return onSnapshot(STATE_DOC, (snap) => {
    if (!snap.exists()) return;
    const raw = snap.data().json;
    cb(raw ? JSON.parse(raw) : null);
  });
}

/* ---- file storage (document uploads) ---- */
// Uploads a document file and returns a public download URL to store as its link.
// Access is gated by storage.rules (your two emails only), same model as Firestore.
export async function uploadDocFile(file) {
  const safe = (file.name || "document").replace(/[^\w.\-]+/g, "_");
  const r = ref(storage, `documents/${Date.now()}-${safe}`);
  await uploadBytes(r, file, { contentType: file.type || "application/octet-stream" });
  return getDownloadURL(r);
}

/* ---- auth ---- */
export function onAuth(cb) {
  return onAuthStateChanged(auth, cb); // returns unsubscribe
}
export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}
export function signOutUser() {
  return signOut(auth);
}
