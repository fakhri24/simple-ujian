import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, enableNetwork, disableNetwork } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { firebaseConfig } from "./app-config.js";

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Sinkronisasi status koneksi dengan Firestore SDK untuk menghindari exponential backoff dan mempercepat rekonsiliasi offline
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    console.log("firebase-config: window online event received, calling enableNetwork...");
    enableNetwork(db)
      .then(() => console.log("firebase-config: enableNetwork resolved successfully!"))
      .catch((err) => console.error("Gagal mengaktifkan jaringan Firestore:", err));
  });
  window.addEventListener("offline", () => {
    console.log("firebase-config: window offline event received, calling disableNetwork...");
    disableNetwork(db)
      .then(() => console.log("firebase-config: disableNetwork resolved successfully!"))
      .catch((err) => console.error("Gagal menonaktifkan jaringan Firestore:", err));
  });

  // Jika saat inisialisasi offline, matikan jaringan Firestore dulu
  if (!navigator.onLine) {
    console.log("firebase-config: initial state is offline, calling disableNetwork...");
    disableNetwork(db)
      .then(() => console.log("firebase-config: initial disableNetwork resolved!"))
      .catch((err) => console.error("Gagal inisialisasi offline Firestore:", err));
  }
}
