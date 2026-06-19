/**
 * Abstraksi lockdown browser multi-platform.
 *
 * Satu payung untuk semua "browser ujian" yang sah:
 *   - SEB  : Safe Exam Browser (macOS / iPadOS)
 *   - SUB  : Simple Ujian Browser, browser desktop buatan sendiri
 *            (Windows via WebView2; nanti Android)
 *
 * Tiga lapisan terpisah (lihat plan/PLAN.md "Rencana II"):
 *   1. Deteksi          -> detectLockdown / activeLockdown / isLockdown
 *   2. Kebijakan platform -> expectedLockdown / lockdownPolicyOn / lockdownSatisfied
 *   3. Validasi clearance -> (Tahap L2, belum di sini)
 *
 * Hal yang KHAS SEB (config key, quit URL) tetap di modul seb-*; di sini hanya
 * konsep generik. Marker browser:
 *   - SEB : window.SafeExamBrowser / UA mengandung "SEB"
 *   - SUB : window.SimpleUjianBrowser / UA mengandung "SimpleUjianBrowser"
 *           (ditanam host C# WebView2; lihat plan untuk kontrak marker)
 */

import { isMacOSOrIPad, isWindows, isAndroid } from "./seb-utils.js";

// Jenis lockdown browser yang dikenal.
export const Lockdown = Object.freeze({
  NONE: "none",
  SEB: "seb",
  SUB: "sub",
});

// LAPISAN 1 — lockdown browser apa yang AKTIF sekarang.
export function detectLockdown() {
  const ua = navigator.userAgent;
  if (window.SafeExamBrowser || /SEB|SafeExamBrowser/.test(ua)) {
    return Lockdown.SEB;
  }
  if (window.SimpleUjianBrowser || ua.includes("SimpleUjianBrowser")) {
    return Lockdown.SUB;
  }
  return Lockdown.NONE;
}

export const activeLockdown = detectLockdown();
export const isLockdown = activeLockdown !== Lockdown.NONE;

// LAPISAN 2 — lockdown browser apa yang DIHARAPKAN di platform ini.
export function expectedLockdown() {
  if (isMacOSOrIPad()) return Lockdown.SEB;
  if (isWindows()) return Lockdown.SUB;
  if (isAndroid()) return Lockdown.SUB; // masa depan
  return Lockdown.NONE; // platform tak didukung -> tidak dipaksa
}

// Kill-switch global kebijakan lockdown (pengganti enforceSEB=false saat testing).
export const lockdownPolicyOn = false;

// Gate akses: apakah lingkungan ini boleh masuk?
export function lockdownSatisfied() {
  if (!lockdownPolicyOn) return true;
  const want = expectedLockdown();
  return want === Lockdown.NONE || activeLockdown === want;
}
