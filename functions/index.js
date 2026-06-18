/**
 * Cloud Functions — SEB config key validation (JS-API-only).
 *
 * - `sebEcho`     : diagnostik Fase 0 (echo header request). Dipakai oleh
 *                   public/pages/seb-check.html.
 * - `validateSEB` : Fase 2. Gerbang "Mulai Ujian". Memverifikasi Config Key
 *                   yang dibaca client dari SEB JavaScript API
 *                   (SafeExamBrowser.security.configKey), lalu menerbitkan
 *                   tiket izin (exam_clearance) berumur pendek.
 *
 * Alur (dua langkah, lihat plan/PLAN.md):
 *   A. challenge → terbitkan nonce sekali-pakai (60 dtk).
 *   B. verify    → client membuka exam.html?examId=X&nonce=N, membaca
 *                  SafeExamBrowser.security.configKey (= SHA256(URL_halaman + CK)),
 *                  lalu mengirim { examId, nonce, configKeyHash, pageUrl }.
 *                  Function menghitung ulang SHA256(pageUrl_tanpa_fragment + CK)
 *                  dengan CK rahasia, membandingkan, dan menulis clearance.
 */

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

// Config Key mentah dari SEB Config Tool (64 hex). Disimpan sbg secret:
//   firebase functions:secrets:set SEB_CONFIG_KEY
const SEB_CONFIG_KEY = defineSecret("SEB_CONFIG_KEY");

const NONCE_TTL_MS = 60 * 1000; // nonce berlaku 60 detik
const CLEARANCE_TTL_MS = 10 * 60 * 1000; // tiket izin berlaku 10 menit

// Verifikasi Firebase ID token dari header Authorization: Bearer <token>.
async function getUid(req) {
  const authz = req.headers.authorization || "";
  const m = authz.match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(m[1]);
    return decoded.uid;
  } catch (e) {
    return null;
  }
}

// ---- Diagnostik Fase 0: echo header (dipakai seb-check.html) ----
exports.sebEcho = onRequest({ region: "us-central1", cors: true }, (req, res) => {
  const sebHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (key.toLowerCase().startsWith("x-safeexambrowser")) sebHeaders[key] = value;
  }
  res.json({
    ok: true,
    receivedAt: new Date().toISOString(),
    method: req.method,
    userAgent: req.headers["user-agent"] || null,
    sebHeaders,
  });
});

// ---- Fase 2: validateSEB (challenge + verify) ----
exports.validateSEB = onRequest(
  { region: "us-central1", cors: true, secrets: [SEB_CONFIG_KEY] },
  async (req, res) => {
    try {
      const body = req.body || {};
      const step = req.query.step || body.step;

      const uid = await getUid(req);
      if (!uid) {
        res.status(401).json({ ok: false, error: "unauthenticated" });
        return;
      }

      // --- Langkah A: challenge ---
      if (step === "challenge") {
        const examId = String(req.query.examId || body.examId || "");
        if (!examId) {
          res.status(400).json({ ok: false, error: "examId_required" });
          return;
        }
        const nonce = crypto.randomBytes(24).toString("hex");
        const now = Date.now();
        await db.collection("seb_challenges").doc(nonce).set({
          uid,
          examId,
          createdAt: now,
          expiresAt: now + NONCE_TTL_MS,
        });
        res.json({ ok: true, nonce });
        return;
      }

      // --- Langkah B: verify ---
      if (step === "verify") {
        const { examId, nonce, configKeyHash, pageUrl } = body;
        if (!examId || !nonce || !configKeyHash || !pageUrl) {
          res.status(400).json({ ok: false, error: "missing_fields" });
          return;
        }

        // 1. Cek & konsumsi nonce (sekali-pakai) secara atomik → cegah replay.
        const ref = db.collection("seb_challenges").doc(String(nonce));
        const consumed = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return { ok: false, reason: "nonce_invalid" };
          const d = snap.data();
          if (d.uid !== uid || d.examId !== examId) {
            return { ok: false, reason: "nonce_mismatch" };
          }
          tx.delete(ref); // konsumsi apapun hasilnya
          if (Date.now() > d.expiresAt) return { ok: false, reason: "nonce_expired" };
          return { ok: true };
        });
        if (!consumed.ok) {
          res.status(403).json({ ok: false, error: consumed.reason });
          return;
        }

        // 2. pageUrl HARUS memuat nonce → ikat hash ke URL sekali-pakai.
        if (!String(pageUrl).includes(String(nonce))) {
          res.status(403).json({ ok: false, error: "url_nonce_mismatch" });
          return;
        }

        // 3. Hitung ulang SHA256(pageUrl_tanpa_fragment + ConfigKey) & bandingkan.
        const url = String(pageUrl).split("#")[0];
        const expected = crypto
          .createHash("sha256")
          .update(url + SEB_CONFIG_KEY.value())
          .digest("hex");
        if (expected.toLowerCase() !== String(configKeyHash).toLowerCase()) {
          logger.warn("validateSEB: config key mismatch", { uid, examId });
          res.status(403).json({ ok: false, error: "config_key_mismatch" });
          return;
        }

        // 4. Terbitkan tiket izin (hanya Function via Admin SDK).
        const now = Date.now();
        await db.collection("exam_clearance").doc(`${uid}_${examId}`).set({
          uid,
          examId,
          issuedAt: now,
          expiresAt: now + CLEARANCE_TTL_MS,
        });
        res.json({ ok: true, expiresAt: now + CLEARANCE_TTL_MS });
        return;
      }

      res.status(400).json({ ok: false, error: "unknown_step" });
    } catch (e) {
      logger.error("validateSEB error", e);
      res.status(500).json({ ok: false, error: "internal" });
    }
  }
);
