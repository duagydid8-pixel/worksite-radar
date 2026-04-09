import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDF1Zj3NZ50NxgBPY3JDDKc3Z6QLSkyt2E",
  authDomain: "p4-ph4.firebaseapp.com",
  projectId: "p4-ph4",
  storageBucket: "p4-ph4.firebasestorage.app",
  messagingSenderId: "1015331536038",
  appId: "1:1015331536038:web:fe2a4da6dc557783328867",
  measurementId: "G-TDFP7LFLRB",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
