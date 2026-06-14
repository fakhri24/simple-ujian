import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth } from "./firebase-config.js";
import { getUserProfile, upsertUserProfile, resetUserSession } from "./db.js";
import { roles } from "./app-config.js";
import { verifyAndStartSession, clearLocalSession } from "./session.js";

export const login = async (email, password) => {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  let maybeProfile = await getUserProfile(cred.user.uid);

  if (!maybeProfile) {
    maybeProfile = { uid: cred.user.uid, email, role: roles.siswa };
    await upsertUserProfile(cred.user.uid, maybeProfile);
  }

  // Verifikasi sesi login ganda dengan meneruskan data profil yang sudah ada
  const isAllowed = await verifyAndStartSession(cred.user.uid, maybeProfile);
  if (!isAllowed) {
    await signOut(auth);
    throw new Error("Akun ini sedang login di perangkat lain. Silakan keluar terlebih dahulu atau tunggu sesi berakhir (maksimal 3 menit).");
  }

  return cred.user;
};

export const logout = async () => {
  const currentUser = auth.currentUser;
  if (currentUser) {
    const uid = currentUser.uid;
    clearLocalSession(uid);
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(`user_profile_${uid}`);
    }
    try {
      await resetUserSession(uid);
    } catch (e) {
      console.error("Gagal menghapus sesi di database saat logout:", e);
    }
  }
  await signOut(auth);
};

export const getCurrentUser = () => auth.currentUser;

export const resolveUserRole = async (uid) => {
  const profile = await getUserProfile(uid);
  return profile?.role || null;
};

export const waitForAuthReady = () =>
  new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });

export const onAuthChanged = (callback) => onAuthStateChanged(auth, callback);
