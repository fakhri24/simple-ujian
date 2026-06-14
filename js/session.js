import { doc, getDoc, updateDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { db, auth } from "./firebase-config.js";

// Global variables to track listeners and intervals
let heartbeatIntervalId = null;
let sessionUnsubscribe = null;

const SESSION_TIMEOUT_MS = 300000; // 300 seconds (5 minutes)
const HEARTBEAT_INTERVAL_MS = 60000; // 60 seconds

/**
 * Generate a unique session ID
 */
function generateSessionId() {
  return "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
}

/**
 * Check if the user session in Firestore is currently active
 * @param {object} profileData
 * @returns {boolean}
 */
export function isSessionActive(profileData) {
  if (!profileData?.sessionId || !profileData?.lastActiveAt) {
    return false;
  }

  // Handle both Firestore Timestamp and JS Date
  const lastActiveMillis = profileData.lastActiveAt.toMillis 
    ? profileData.lastActiveAt.toMillis() 
    : new Date(profileData.lastActiveAt).getTime();
  
  const now = Date.now();
  return (now - lastActiveMillis) < SESSION_TIMEOUT_MS;
}

/**
 * Verify and start a session for the user.
 * If another session is active, rejects the login.
 * If no active session or the session has expired, takes over.
 * @param {string} uid
 * @returns {Promise<boolean>} returns true if allowed, false if blocked
 */
export async function verifyAndStartSession(uid, preloadedProfileData = null) {
  if (!navigator.onLine) {
    console.warn("Offline detected during session verification. Bypassing check.");
    return true;
  }
  try {
    const userDocRef = doc(db, "users", uid);
    let data = preloadedProfileData;

    if (!data) {
      const snap = await getDoc(userDocRef);
      if (!snap.exists()) {
        return false;
      }
      data = snap.data();
    }

    const localSessIdKey = `session_id_${uid}`;
    let localSessId = localStorage.getItem(localSessIdKey);

    // 1. Check if there is an active session in Firestore
    if (isSessionActive(data)) {
      // If the local session ID matches the active session in Firestore,
      // it means this is a refresh or a new tab on the same browser. Allow it.
      if (localSessId && data.sessionId === localSessId) {
        startSessionMonitoring(uid, localSessId);
        return true;
      }
      
      // Different device or browser session is already active. Block.
      return false;
    }

    // 2. No active session exists or the session has expired. Start a new session.
    const newSessId = generateSessionId();
    localStorage.setItem(localSessIdKey, newSessId);
    
    await updateDoc(userDocRef, {
      sessionId: newSessId,
      lastActiveAt: serverTimestamp()
    });

    startSessionMonitoring(uid, newSessId);
    return true;
  } catch (error) {
    console.error("Gagal memproses verifikasi sesi:", error);
    if (!navigator.onLine || error.code === "unavailable" || error.code === "unknown" || error.message?.includes("offline")) {
      return true;
    }
    return false;
  }
}

/**
 * Starts the heartbeat loop and onSnapshot listener for the user.
 * @param {string} uid
 * @param {string} sessionId
 */
export function startSessionMonitoring(uid, sessionId) {
  // Clear any existing monitoring to prevent duplicates
  stopSessionMonitoring();

  const userDocRef = doc(db, "users", uid);

  // 1. Start periodic heartbeat to keep the session alive
  heartbeatIntervalId = setInterval(async () => {
    try {
      await updateDoc(userDocRef, {
        lastActiveAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Gagal mengirim heartbeat sesi:", error);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // 2. Start real-time Firestore listener to detect remote session overrides or admin resets
  sessionUnsubscribe = onSnapshot(userDocRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      
      // If the remote sessionId changes to something else, log out this client
      if (data.sessionId !== sessionId) {
        console.warn("Sesi tidak valid (diambil alih perangkat lain atau di-reset). Melakukan logout otomatis.");
        handleAutomaticLogout(uid, data.sessionId ? "expired" : "reset");
      }
    }
  });
}

/**
 * Stops the heartbeat loop and unsubscribe from snapshot listener
 */
export function stopSessionMonitoring() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
  if (sessionUnsubscribe) {
    sessionUnsubscribe();
    sessionUnsubscribe = null;
  }
}

/**
 * Clears local session variables (called during manual logout)
 * @param {string} uid
 */
export function clearLocalSession(uid) {
  stopSessionMonitoring();
  localStorage.removeItem(`session_id_${uid}`);
}

/**
 * Perform automatic sign out and redirect the user back to the login page with error param
 * @param {string} uid
 * @param {"expired" | "reset"} reason
 */
export async function handleAutomaticLogout(uid, reason) {
  clearLocalSession(uid);
  try {
    await signOut(auth);
  } catch (e) {
    console.error("Gagal melakukan sign out otomatis:", e);
  }
  window.location.replace(`/?error=${reason}`);
}
