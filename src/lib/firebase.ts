import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  type Auth,
  type User,
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

type FirebaseClient = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
};

let client: FirebaseClient | null = null;

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId,
  );
}

export function getFirebaseClient() {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase config is missing.");
  }

  if (!client) {
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    client = {
      app,
      auth: getAuth(app),
      db: getFirestore(app),
    };
  }

  return client;
}

export async function ensureAnonymousUser(): Promise<User | null> {
  const { auth } = getFirebaseClient();

  if (auth.currentUser) {
    return auth.currentUser;
  }

  try {
    const credential = await signInAnonymously(auth);
    return credential.user;
  } catch {
    return null;
  }
}
