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

// Platform OS yang dibedakan untuk instruksi unduh (lebih halus dari Lapisan 2:
// macOS & iOS sama-sama SEB tapi cara pasangnya beda — file .seb vs skema sebs://).
export const Platform = Object.freeze({
  MACOS: "macos",
  IOS: "ios",
  WINDOWS: "windows",
  ANDROID: "android",
  OTHER: "other",
});

export function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipod/.test(ua)) return Platform.IOS;
  // iPadOS 13+ menyamar sebagai macOS desktop; bedakan lewat touch points.
  if (ua.includes("ipad") || (ua.includes("mac") && navigator.maxTouchPoints > 1)) {
    return Platform.IOS;
  }
  if (ua.includes("mac")) return Platform.MACOS;
  if (isWindows()) return Platform.WINDOWS;
  if (isAndroid()) return Platform.ANDROID;
  return Platform.OTHER;
}

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
export const lockdownPolicyOn = true;

// Gate akses: apakah lingkungan ini boleh masuk?
export function lockdownSatisfied() {
  if (!lockdownPolicyOn) return true;
  const want = expectedLockdown();
  return want === Lockdown.NONE || activeLockdown === want;
}

// LAPISAN 2b — sumber unduhan browser ujian per platform.
// Catatan deploy: file .seb dilayani dari root web app (lihat index.html lama);
// skema sebs:// menyuruh app SEB iOS menarik config via HTTPS dari host yang sama.
export const lockdownDownloads = Object.freeze({
  sebConfigPath: "/simple-ujian.seb", // unduh & double-click di macOS
  sebConfigHttpsUrl: "simple-ujian.web.app/simple-ujian.seb", // tanpa skema, utk sebs://
  sebAppMac: "https://safeexambrowser.org/download_en.html",
  sebAppIos: "https://apps.apple.com/app/safe-exam-browser/id1497837538",
  subWindowsExe: "", // TODO: isi link unduh .exe (mis. Google Drive) Simple Ujian Browser
  subAndroidApk: "", // TODO: belum tersedia
});

// Panduan tampilan untuk gate yang tidak terpenuhi: judul, deskripsi, tombol
// aksi unduh/buka, dan hint instalasi aplikasi — semua per platform.
// Dipakai loginPage untuk merender #seb-warning-container.
export function lockdownGuidance(platform = detectPlatform()) {
  const d = lockdownDownloads;
  switch (platform) {
    case Platform.MACOS:
      return {
        browser: Lockdown.SEB,
        title: "Safe Exam Browser Diperlukan",
        description:
          "Untuk menjaga integritas dan mencegah kecurangan, ujian ini hanya dapat diakses melalui <strong>Safe Exam Browser (SEB)</strong>. Unduh konfigurasi di bawah ini lalu buka untuk memulai.",
        actions: [
          { label: "Unduh Konfigurasi Ujian (.seb)", href: d.sebConfigPath, download: "simple-ujian.seb" },
        ],
        hint: { text: "Belum memiliki aplikasi SEB?", linkLabel: "Unduh Aplikasi Resmi SEB", href: d.sebAppMac },
      };
    case Platform.IOS:
      return {
        browser: Lockdown.SEB,
        title: "Safe Exam Browser Diperlukan",
        description:
          "Ujian ini hanya dapat diakses melalui <strong>Safe Exam Browser</strong> di iPad/iPhone. Tekan tombol di bawah untuk membuka konfigurasi langsung di aplikasi SEB.",
        actions: [
          { label: "Buka di Safe Exam Browser", href: `sebs://${d.sebConfigHttpsUrl}` },
        ],
        hint: { text: "Belum memiliki aplikasi SEB?", linkLabel: "Unduh SEB di App Store", href: d.sebAppIos },
      };
    case Platform.WINDOWS:
      return {
        browser: Lockdown.SUB,
        title: "Simple Ujian Browser Diperlukan",
        description:
          "Untuk menjaga integritas ujian, di Windows ujian hanya dapat diakses melalui aplikasi <strong>Simple Ujian Browser</strong>. Unduh dan jalankan aplikasinya untuk memulai.",
        actions: [
          {
            label: "Unduh Simple Ujian Browser (.exe)",
            href: d.subWindowsExe || "#",
            disabled: !d.subWindowsExe,
          },
        ],
      };
    case Platform.ANDROID:
      return {
        browser: Lockdown.SUB,
        title: "Simple Ujian Browser Diperlukan",
        description:
          "Aplikasi <strong>Simple Ujian Browser</strong> untuk Android belum tersedia. Silakan gunakan perangkat Windows, macOS, atau iPad untuk mengikuti ujian.",
        actions: [
          { label: "Unduh Aplikasi (Android)", href: d.subAndroidApk || "#", disabled: !d.subAndroidApk },
        ],
      };
    default:
      // Platform tak didukung: gate tidak memaksa lockdown, jadi ini jarang tampil.
      return {
        browser: Lockdown.NONE,
        title: "Browser Ujian Diperlukan",
        description:
          "Ujian ini memerlukan browser ujian khusus yang belum tersedia untuk perangkat ini.",
        actions: [],
      };
  }
}
