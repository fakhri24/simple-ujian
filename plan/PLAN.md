# Rencana: Validator Config Key SEB (server-side)

Branch: `feat/seb-config-key-validation`

## Tujuan

Memastikan siswa yang diwajibkan memakai Safe Exam Browser (SEB) **tidak bisa**
mengerjakan ujian dengan konfigurasi `.seb` yang dimanipulasi (mis. mengizinkan
switch ke aplikasi lain seperti VSCode) atau dengan browser non-SEB yang
memalsukan User-Agent. **Validasi final dilakukan di server**: hanya SEB asli
yang dapat menghasilkan Config Key hash yang cocok (lewat HTTP header pada SEB
lama, atau lewat SEB JavaScript API pada SEB 3.0+). Server memegang ConfigKey
rahasia dan memverifikasi hash; client tidak bisa memalsukannya.

## Keputusan desain (terkunci)

- **Backend**: Cloud Functions (Firebase Blaze — sudah aktif).
- **Ketat**: **Config Key saja** (tanpa BEK) **+** anti-replay nonce.
  BEK dilepas karena spesifik-platform & berubah tiap update SEB (rapuh).
  Config Key lintas-platform & tahan-versi → cukup untuk mendeteksi manipulasi
  config (kasus utama: siswa mengizinkan switch app/VSCode).
- **Platform**: macOS **dan** iPad/iOS (kode sudah pakai `isMacOSOrIPad()`).
- **Transport tunggal: SEB JavaScript API saja** (lihat di bawah). Jalur HTTP
  header DIBUANG demi kesederhanaan.
- **Versi minimum: SEB 3.0+ (macOS & iOS)** — disyaratkan ke siswa agar JS API
  selalu tersedia. Client menolak versi lebih rendah (cek `SafeExamBrowser.version`).
- **Titik validasi**: saat siswa menekan "Mulai Ujian" (bukan saat login).
  Alasan: penjaga dipasang tepat di depan aset (soal), jaminan segar
  (hindari TOCTOU), tiket izin terikat per-ujian & berumur pendek (least
  privilege), cocok untuk multi-ujian/retake, dan nonce sekali-pakai natural
  di titik ini.

## Cara kerja Config Key (dasar)

- **ConfigKey**: hash deterministik dari isi setting `.seb`. Berubah hanya jika
  setting diubah. **Sama persis di Windows/macOS/iOS** untuk config yang sama,
  dan tidak berubah saat versi SEB di-update → jangkar lintas-platform.

SEB menyediakan ke server nilai **`SHA256( URL_tanpa_fragment + ConfigKey )`**.
Server menyimpan ConfigKey sah (dari SEB Config Tool), menghitung ulang hash
yang sama memakai URL terkait, lalu membandingkan.

### Transport tunggal: SEB JavaScript API

Sejak SEB 3.0 (macOS & iOS) engine pindah ke **WKWebView yang TIDAK pernah
mengirim CK via HTTP header**; sebagai gantinya tersedia JS API. Karena armada
disyaratkan SEB 3.0+, kita pakai **hanya** JS API:

- Client baca `SafeExamBrowser.security.configKey` (sudah =
  `SHA256(URL_halaman_tanpa_fragment + CK)`; CK mentah TIDAK pernah bocor ke JS).
- Client kirim ke Function: `{ configKeyHash, pageUrl(location.href) }`.
- Function pegang CK mentah, hitung ulang `SHA256(pageUrl_tanpa_fragment + CK)`,
  bandingkan.
- Client juga cek `SafeExamBrowser.version` ≥ 3.0; jika JS API tak ada / versi
  lebih rendah → tolak ("Gunakan SEB versi 3 atau lebih baru").

Jalur HTTP header & rekonstruksi `x-forwarded-*` TIDAK dipakai lagi.

### Anti-replay (nonce)

`configKey` di-hash dengan **URL halaman**. Maka halaman ujian dibuka dengan
nonce di URL: `exam.html?examId=X&nonce=N`. Client kirim `location.href` +
`configKeyHash` → Function cek nonce sekali-pakai (milik uid+examId, belum
dipakai) lalu cocokkan `SHA256(href_tanpa_fragment + CK)`.

## Bentuk data

```
// Nonce sekali-pakai (ditulis & dihapus oleh Function)
seb_challenges/{nonce}
  { uid, examId, createdAt, expiresAt }      // TTL ~60 detik

// Tiket izin ujian (ditulis HANYA oleh Function via Admin SDK)
exam_clearance/{uid}_{examId}
  { uid, examId, issuedAt, expiresAt }       // TTL ~10 menit

// ConfigKey sah — rahasia (Secret Manager / functions config)
//   { configKey }                            // bisa per-exam; BEK TIDAK dipakai
```

---

## Fase 0 — Verifikasi asumsi (GATE WAJIB)

**Tujuan**: membuktikan SEB menempelkan header `X-SafeExamBrowser-*` ke request
`fetch`/XHR, bukan hanya pemuatan halaman utama. Seluruh desain bergantung ini.

Langkah:
1. Scaffold folder `functions/` (Node, firebase-functions, firebase-admin).
2. Buat Function HTTPS `sebEcho` yang mengembalikan SELURUH header request
   (khususnya yang berawalan `x-safeexambrowser`) sebagai JSON.
3. Tambah rewrite `firebase.json`: `/sebEcho` → function (agar satu domain).
4. Deploy. Uji dari:
   - SEB asli di macOS memuat app, panggil `/sebEcho` via `fetch` → header SEB
     HARUS muncul.
   - Chrome biasa → header SEB tidak ada.

**Kriteria lulus**: header `x-safeexambrowser-configkeyhash` &
`x-safeexambrowser-requesthash` muncul pada request `fetch` dari dalam SEB.

**Jika gagal**: hentikan; desain harus diubah (mis. validasi via navigasi
dokumen yang di-serve Function, bukan fetch).

### Status Fase 0
- [x] Scaffold `functions/`, Function `sebEcho` (echo header) — deployed.
- [x] Rewrite `firebase.json`: `/sebEcho` → function — deployed.
- [x] Halaman uji `public/pages/seb-check.html` — live di
      `https://simple-ujian.web.app/pages/seb-check.html`.
- [x] Uji manual: LULUS di SEB macOS (lewat HEADER → berarti SEB tsb < 3.0).

### Fase 0b — Re-verifikasi JS API (GATE WAJIB, sebelum Fase 2)
- [x] Perluas `seb-check.html`: tampilkan JS API (version/configKey) + header.
- [x] Uji di SEB 3.6.1 macOS (lihat `public/ss-fase-0v2.jpeg`).

**HASIL & TEMUAN KUNCI:** JS API `present:false`; header ✓. SEB menampilkan
banner *"Classic WebView is deprecated..."*. Artinya: ini **bukan soal versi**
(3.6.1 sudah cukup) tapi soal **MODE WebView**. SEB 3.x macOS bisa jalan di:
- **Classic WebView** (mode `.seb` saat ini): KIRIM header, TIDAK ada JS API.
- **Modern WebView / WKWebView**: TIDAK kirim header, ADA JS API. Wajib untuk
  fitur web modern; **satu-satunya mode di iPad/iOS** (iOS tak punya classic).

**KONSEKUENSI**: karena iPad WAJIB didukung dan iPad hanya punya WKWebView,
jalur header MUSTAHIL di iPad → kita HARUS pakai modern WebView + JS API.
Classic WebView juga sudah deprecated Apple (akan hilang). Maka:

- [x] **Aktifkan modern WebView di `.seb` produksi** — via opsi **"paksa pakai
      web modern"** di SEB Config Tool.
- [x] Re-uji `seb-check.html` dari SEB modern-WebView → **LULUS**: JS API ada
      (`configKey` terisi), header tidak terbaca. Sesuai harapan & cocok iPad.

→ **FASE 0/0b SELESAI. Lanjut Fase 2.** (Sebelum end-to-end butuh nilai
ConfigKey mentah dari SEB Config Tool, disimpan sebagai secret — bukan di repo.)

### CATATAN (arsip — tidak lagi dipakai untuk validasi)
Sejak transport jadi JS-API-only, rekonstruksi URL publik dari `x-forwarded-*`
TIDAK lagi diperlukan untuk hashing (URL hash = `location.href` halaman, dikirim
client). Catatan ini disimpan untuk konteks bila suatu saat jalur header dihidupkan.

Di balik rewrite Firebase Hosting, Function melihat `host` internal Cloud Run
(`sebecho-xxxx-uc.a.run.app`), BUKAN domain publik. SEB menghitung
`ConfigKeyHash`/`BEK_Hash` atas URL **publik** yang diminta browser. Maka saat
verifikasi, server HARUS merekonstruksi URL publik dari header forwarded:

```
URL_publik = `${x-forwarded-proto}://${x-forwarded-host}${x-forwarded-url}`
           = https://simple-ujian.web.app/sebEcho?nonce=...
```

JANGAN pakai `req.get("host")` / `req.originalUrl` mentah untuk hashing —
hasilnya host internal dan hash tidak akan cocok. (Header forwarded sudah
diverifikasi tersedia: `x-forwarded-host`, `x-forwarded-proto`,
`x-forwarded-url`.)

---

## Fase 1 — Scaffold backend

1. Pastikan project Blaze & `firebase init functions` (atau setup manual). [x]
2. Struktur `functions/` siap deploy; pasang dependency. [x]
3. Simpan **ConfigKey** sah ke secret/functions config (placeholder dulu).

---

## Fase 2 — Function `validateSEB` (challenge + verify, transport ganda)

**Langkah A — challenge** (`GET /validateSEB?step=challenge&examId=X`):
1. Verifikasi ID token Firebase → `uid`.
2. Buat `nonce` acak; simpan `seb_challenges/{nonce}` (TTL 60 dtk).
3. Balas `{ nonce }`.

Status: [x] kode + rewrite. [x] secret `SEB_CONFIG_KEY` di-set. [x] deployed
(`validateSEB` live, auth-gate OK, rewrite OK). [ ] **MENUNGGU tes E2E** dari
SEB modern-WebView via `seb-check.html` (bagian B) → buktikan ConfigKey cocok
(`ok:true`) sebelum Fase 3. Catatan: tes ini menulis doc diagnostik
`exam_clearance/{uid}___seb_diag__` (boleh dihapus nanti).

**Langkah B — verify** (`POST /validateSEB`, body
`{ examId, nonce, configKeyHash, pageUrl }` hasil `SafeExamBrowser.security.configKey`):
1. Verifikasi ID token → `uid`; cek nonce valid (milik uid+examId, belum
   kedaluwarsa, belum dipakai); langsung hapus (cegah replay).
2. Pastikan `pageUrl` memuat `nonce` yang sah & sesuai examId.
3. Hitung `SHA256(pageUrl_tanpa_fragment + configKey)`, bandingkan dgn
   `configKeyHash` (hex, case-insensitive).
4. Cocok → tulis `exam_clearance/{uid}_{examId}` (TTL 10 mnt), balas `200`.
   Tidak cocok / tanpa key → `403`, tidak menulis apa pun.

---

## Fase 3 — Firestore Rules + integrasi client  [SELESAI, ter-deploy]

Keputusan: enforcement **per-ujian** lewat flag `requireSEB` (bukan global).

1. [x] `firestore.rules`: helper `hasClearance(examId)` + `examRequiresSEB(exam)`.
   Syarat clearance dipasang pada `exam_attempts` **create** dan cabang **retake**
   (`update`), HANYA jika `examRequiresSEB`. Tambah match `exam_clearance`
   (read: pemilik/admin; write: false) & `seb_challenges` (read,write: false).
2. [x] Client: `js/seb-validate.js` (`ensureSEBClearance`) — challenge → reload
   `?seb_nonce=N` → baca `SafeExamBrowser.security.configKey` → verify. Dipanggil
   di `examPage.js` bootstrap pada skenario mulai-baru (bukan resume); gagal →
   `showFatalError`. Skip otomatis jika `exam.requireSEB !== true`.
3. [x] Admin UI: toggle "Wajib Safe Exam Browser" di form buat & edit
   (`pages/admin.html` + `adminPage.js`) → simpan `requireSEB`.
4. [x] TTL clearance dinaikkan ke 30 mnt (jeda baca instruksi sebelum "Mulai").

---

## Fase 4 — Uji end-to-end & cleanup

1. [ ] Uji E2E alur ujian nyata:
   - Admin: buat/edit ujian → "Wajib Safe Exam Browser" = Ya.
   - Siswa di SEB modern WebView (macOS & iPad): buka ujian → tervalidasi
     (reload nonce) → bisa "Mulai" & kerjakan normal.
   - Siswa TANPA SEB / config dimanipulasi: diblokir saat buka ujian.
   - Ujian `requireSEB=false`: tetap jalan tanpa SEB (regression).
2. [ ] (Opsional) `js/seb-utils.js`: `enforceSEB = isMacOSOrIPad()` untuk gate
   login lemah (UX). Catatan: enforcement kuat sudah ditangani per-ujian via
   `requireSEB`, jadi ini hanya pelengkap UX.
3. [ ] Cleanup setelah lolos: hapus link `<!-- TEMP-SEB-DIAG -->` di
   `index.html`, halaman `public/pages/seb-check.html`, Function `sebEcho` +
   rewrite-nya, dan doc diagnostik `exam_clearance/{uid}___seb_diag__`.

---

## Catatan keamanan

- Nonce mencegah replay configKeyHash oleh siswa yang pernah punya SEB asli.
- Tiket `exam_clearance` ditulis HANYA oleh Function (Admin SDK melewati rules),
  client tidak boleh menulisnya → rule deny untuk client.
- ConfigKey tidak boleh masuk repo; simpan di secret.
- BEK sengaja TIDAK dipakai: spesifik-platform (macOS≠iOS) & berubah tiap
  update SEB di desktop → rapuh. Config Key cukup mendeteksi manipulasi config.
