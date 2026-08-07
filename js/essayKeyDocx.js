/**
 * essayKeyDocx.js — Terjemahan kunci essay auto-grade ke/dari baris teks .docx.
 *
 * Impor (adminPage) dan ekspor (docxExporter) memakai modul yang sama supaya
 * dokumen yang diunduh guru bisa diunggah kembali tanpa kehilangan kuncinya.
 *
 * Bentuk barisnya:
 *   Tipe: essay
 *   Kunci: 3/4
 *   Alternatif: 0,75; 75%
 *   Mode: angka
 *   Toleransi: 0,01
 *   Satuan: cm
 *   Jika salah: salah
 *
 * Pemisah alternatif memakai titik koma, bukan koma, karena koma dipakai
 * sebagai tanda desimal dalam penulisan angka Indonesia (0,75).
 */

/** Label baris → nama field internal. Semua label bersifat baku (reserved). */
const LINE_FIELDS = {
  alternatif: "alternatif",
  "alternatif jawaban": "alternatif",
  mode: "mode",
  toleransi: "toleransi",
  satuan: "satuan",
  "jika salah": "jikaSalah",
  "jika tidak cocok": "jikaSalah",
};

const MODE_FROM_LABEL = {
  angka: "numeric",
  numerik: "numeric",
  numeric: "numeric",
  matematika: "numeric",
  teks: "text",
  text: "text",
  "kata kunci": "keywords",
  keywords: "keywords",
  otomatis: "auto",
  auto: "auto",
};

const MODE_TO_LABEL = {
  numeric: "angka",
  text: "teks",
  keywords: "kata kunci",
};

/** "0,01" → 0.01 dan "1.000,5" → 1000.5, mengikuti cara menulis angka id-ID. */
const parseIdNumber = (raw) => {
  const text = String(raw ?? "").trim();
  if (!text) {
    return 0;
  }
  const normalized = text.includes(",")
    ? text.split(".").join("").replace(",", ".")
    : text;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
};

const formatIdNumber = (value) => String(value).replace(".", ",");

const splitAccepted = (raw) =>
  String(raw ?? "")
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * Kenali baris pelengkap kunci essay pada dokumen impor.
 * Baris `Kunci:` sengaja tidak ditangani di sini — parser utama sudah
 * membacanya untuk semua tipe soal.
 *
 * @returns {{field: string, value: string}|null}
 */
export const matchEssayKeyLine = (rawText) => {
  const text = String(rawText ?? "");
  const colon = text.indexOf(":");
  if (colon === -1) {
    return null;
  }
  const field = LINE_FIELDS[text.slice(0, colon).trim().toLowerCase()];
  if (!field) {
    return null;
  }
  return { field, value: text.slice(colon + 1).trim() };
};

/**
 * Susun kunci essay dari baris-baris dokumen.
 * Tanpa baris `Kunci:`, soal essay tetap menunggu koreksi guru seperti biasa.
 *
 * @param {{kunci?: string, alternatif?: string, mode?: string,
 *          toleransi?: string, satuan?: string, jikaSalah?: string}} lines
 */
export const buildEssayKeyFromDocx = (lines = {}) => {
  const accepted = [...splitAccepted(lines.kunci), ...splitAccepted(lines.alternatif)];
  if (accepted.length === 0) {
    return { autoGrade: false, answerKey: null, onMismatch: "manual" };
  }

  const answerKey = {
    mode: MODE_FROM_LABEL[String(lines.mode ?? "").trim().toLowerCase()] || "auto",
    accepted,
    tolerance: parseIdNumber(lines.toleransi),
    requireSimplified: false,
    requireUnit: String(lines.satuan ?? "").trim(),
    ignoreCase: true,
    ignorePunctuation: true,
    typoTolerance: 0,
  };

  const mismatch = String(lines.jikaSalah ?? "").trim().toLowerCase();
  const onMismatch = mismatch === "salah" || mismatch === "wrong" ? "wrong" : "manual";

  return { autoGrade: true, answerKey, onMismatch };
};

/**
 * Kebalikannya: kunci essay menjadi baris teks untuk dokumen ekspor.
 * Opsi lanjutan (wajib bentuk sederhana, toleransi salah ketik, jawaban
 * setengah benar) tidak ikut ditulis — itu hanya ada di editor.
 *
 * @returns {string[]} baris siap tulis; kosong bila soal tidak dinilai otomatis
 */
export const essayKeyToDocxLines = (question) => {
  if (!question || question.type !== "essay" || !question.autoGrade) {
    return [];
  }
  const key = question.answerKey || {};
  const accepted = (key.accepted || []).map((item) => String(item).trim()).filter(Boolean);
  if (accepted.length === 0) {
    return [];
  }

  const lines = [`Kunci: ${accepted[0]}`];
  if (accepted.length > 1) {
    lines.push(`Alternatif: ${accepted.slice(1).join("; ")}`);
  }
  if (MODE_TO_LABEL[key.mode]) {
    lines.push(`Mode: ${MODE_TO_LABEL[key.mode]}`);
  }
  if (Number(key.tolerance)) {
    lines.push(`Toleransi: ${formatIdNumber(Number(key.tolerance))}`);
  }
  if (String(key.requireUnit || "").trim()) {
    lines.push(`Satuan: ${String(key.requireUnit).trim()}`);
  }
  if (question.onMismatch === "wrong") {
    lines.push("Jika salah: salah");
  }
  return lines;
};
