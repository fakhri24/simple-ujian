/**
 * Modul Anti-Cheat Helper & Device Detection.
 *
 * Mengelola deteksi perangkat sentuh (tablet/iPad/HP), status interaksi input,
 * dan konstanta pengawasan ujian.
 */

export const CHEATING_COOLDOWN_MS = 10000; // Cooldown 10 detik

/**
 * Mendeteksi apakah pengguna menggunakan perangkat berlayar sentuh (tablet, HP, iPad).
 * Menggunakan standar CSS Pointer Media Queries & Touch Points API.
 *
 * @param {Window} [customWindow]
 * @param {Navigator} [customNav]
 * @returns {boolean}
 */
export const isTouchDevice = (
  customWindow = typeof window !== "undefined" ? window : null,
  customNav = typeof navigator !== "undefined" ? navigator : null
) => {
  const win = customWindow;
  const nav = customNav;
  if (!win && !nav) return false;

  // 1. Pointer Coarse (Jari / Layar Sentuh sebagai penunjuk utama)
  const hasCoarsePointer = Boolean(win?.matchMedia && win.matchMedia("(pointer: coarse)").matches);

  // 2. Hardware Touch Points
  const hasTouchPoints = Boolean(nav && typeof nav.maxTouchPoints === "number" && nav.maxTouchPoints > 0);

  // 3. User Agent Mobile / Tablet
  const ua = (nav?.userAgent || "").toLowerCase();
  const isMobileUa = /android|iphone|ipad|ipod|tablet/i.test(ua);

  // 4. iPadOS 13+ (Safari di iPad modern melaporkan diri sebagai MacIntel dengan touch points > 1)
  const isIPadOS = Boolean(nav?.platform === "MacIntel" && nav.maxTouchPoints > 1);

  return hasCoarsePointer || hasTouchPoints || isMobileUa || isIPadOS;
};

/**
 * Memeriksa apakah pengguna sedang aktif mengetik di elemen input teks/esai/pecahan.
 *
 * @param {Document} [customDoc]
 * @returns {boolean}
 */
export const isWritingInputActive = (
  customDoc = typeof document !== "undefined" ? document : null
) => {
  if (!customDoc) return false;
  const active = customDoc.activeElement;
  if (!active) return false;

  const tag = (active.tagName || "").toUpperCase();
  if (tag === "BODY" || tag === "HTML") return false;
  if (tag === "TEXTAREA") return true;

  if (tag === "INPUT") {
    const type = (active.type || "text").toLowerCase();
    // Abaikan radio & checkbox (karena interaksi pilihan ganda hanya 1 klik cepat),
    // hanya kecualikan input yang memunculkan keyboard virtual (esai angka, pecahan, dsb).
    return ["text", "number", "search", "tel", "url", "password", "email"].includes(type);
  }

  return Boolean(active.isContentEditable);
};
