/**
 * Validasi Config Key SEB sisi client (jalur JS API).
 *
 * Dipanggil sebelum memulai ujian yang `requireSEB`. Alur:
 *   1. challenge → minta nonce ke Cloud Function validateSEB.
 *   2. reload halaman dengan `?seb_nonce=N` agar SafeExamBrowser.security.configKey
 *      ter-hash dengan URL yang memuat nonce.
 *   3. verify → kirim { configKeyHash, pageUrl, nonce } ke Function; Function
 *      mencocokkan SHA256(pageUrl + ConfigKey) lalu menulis tiket exam_clearance.
 *
 * Hanya tersedia di SEB modern WebView (SEB 3.0+). Di luar itu → gagal.
 */

import { auth } from "./firebase-config.js";

async function postValidate(body) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch("/validateSEB", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ ok: false, error: "bad_response" }));
}

// Baca configKey dari SEB JS API (= SHA256(URL_halaman + ConfigKey)).
function readConfigKeyHash() {
  return new Promise((resolve) => {
    const api = window.SafeExamBrowser;
    if (!api || !api.security) return resolve(null);
    const read = () => api.security.configKey || null;
    if (typeof api.security.updateKeys === "function") {
      let done = false;
      const fin = () => { if (!done) { done = true; resolve(read()); } };
      try { api.security.updateKeys(fin); } catch (e) {}
      setTimeout(fin, 1500);
    } else {
      resolve(read());
    }
  });
}

/**
 * Pastikan ada tiket izin SEB untuk ujian ini.
 * @returns {Promise<{ok:boolean, skipped?:boolean, reason?:string}>}
 *   Jika perlu challenge, fungsi akan me-reload halaman dan tidak resolve.
 */
export async function ensureSEBClearance(examId, exam) {
  // Ujian tidak menuntut SEB → tidak perlu validasi.
  if (!exam || exam.requireSEB !== true) {
    return { ok: true, skipped: true };
  }

  const api = window.SafeExamBrowser;
  if (!api || !api.security) {
    return {
      ok: false,
      reason:
        "Ujian ini wajib dibuka melalui Safe Exam Browser (mode web modern). " +
        "Antarmuka keamanan SEB tidak terdeteksi.",
    };
  }

  const params = new URLSearchParams(location.search);
  const nonce = params.get("seb_nonce");

  // Langkah 1: belum ada nonce → minta, lalu reload dengan nonce di URL.
  if (!nonce) {
    const data = await postValidate({ step: "challenge", examId });
    if (!data || !data.ok || !data.nonce) {
      return { ok: false, reason: "Gagal meminta token validasi SEB." };
    }
    const u = new URL(location.href);
    u.searchParams.set("seb_nonce", data.nonce);
    location.replace(u.toString());
    await new Promise(() => {}); // hentikan; halaman akan reload
  }

  // Langkah 2: verify. pageUrl HARUS yang memuat nonce (yang di-hash SEB).
  const pageUrl = location.href;
  const configKeyHash = await readConfigKeyHash();

  // Bersihkan nonce dari URL agar tidak terpakai ulang saat reload manual.
  const clean = new URL(location.href);
  clean.searchParams.delete("seb_nonce");
  history.replaceState({}, "", clean.toString());

  if (!configKeyHash) {
    return { ok: false, reason: "Config Key SEB kosong / tidak terbaca." };
  }

  const data = await postValidate({ step: "verify", examId, nonce, configKeyHash, pageUrl });
  if (data && data.ok) {
    return { ok: true };
  }
  if (data && data.error === "config_key_mismatch") {
    return {
      ok: false,
      reason:
        "Konfigurasi Safe Exam Browser tidak sah (Config Key tidak cocok). " +
        "Gunakan file konfigurasi resmi tanpa modifikasi.",
    };
  }
  return { ok: false, reason: "Validasi SEB gagal: " + ((data && data.error) || "tidak diketahui") };
}
