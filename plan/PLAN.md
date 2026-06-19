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

1. [x] Uji E2E alur ujian nyata (dijalankan manual, LULUS):
   - Admin: buat/edit ujian → "Wajib Safe Exam Browser" = Ya.
   - Siswa di SEB modern WebView (macOS & iPad): buka ujian → tervalidasi
     (reload nonce) → bisa "Mulai" & kerjakan normal.
   - Siswa TANPA SEB / config dimanipulasi: diblokir saat buka ujian.
   - Ujian `requireSEB=false`: tetap jalan tanpa SEB (regression).
2. [~] (Opsional) `enforceSEB = isMacOSOrIPad()` untuk gate login lemah —
   **DISUBSUMSI Rencana II**: gate akses kini lewat `lockdownSatisfied()` /
   `lockdownPolicyOn` (L2a). `enforceSEB` sudah `@deprecated`. Tidak dikerjakan.
3. [x] Cleanup setelah lolos:
   - [x] Hapus link `<!-- TEMP-SEB-DIAG -->` di `index.html`.
   - [x] Hapus halaman `public/pages/seb-check.html` (+ `dist/`).
   - [x] Hapus Function `sebEcho` (`functions/index.js`) + rewrite `firebase.json`.
   - [ ] Hapus doc diagnostik `exam_clearance/{uid}___seb_diag__` — MANUAL
         (butuh uid; tak ada ADC lokal). Lalu `firebase deploy` agar `sebEcho`
         benar-benar hilang dari produksi.

---

## Catatan keamanan

- Nonce mencegah replay configKeyHash oleh siswa yang pernah punya SEB asli.
- Tiket `exam_clearance` ditulis HANYA oleh Function (Admin SDK melewati rules),
  client tidak boleh menulisnya → rule deny untuk client.
- ConfigKey tidak boleh masuk repo; simpan di secret.
- BEK sengaja TIDAK dipakai: spesifik-platform (macOS≠iOS) & berubah tiap
  update SEB di desktop → rapuh. Config Key cukup mendeteksi manipulasi config.

---
---

# Rencana II: Abstraksi Lockdown Browser Multi-Platform (SEB / SUB / Android)

## Latar belakang

Pekerjaan di Rencana I terkunci pada satu lockdown browser: **SEB** (macOS/iPad).
Sekarang sudah ada **SUB — Simple Ujian Browser**, browser desktop **Windows**
buatan sendiri berbasis **WebView2 + C#**. Ke depan ingin menambah **Android**.
Target: arsitektur yang **konsisten, namanya konsisten, dan fleksibel** —
SEB/SUB/Android bukan tiga jalur terpisah yang saling tabrakan, melainkan satu
payung konsep "lockdown browser" dengan strategi per-platform.

Pemetaan platform → browser yang diharapkan:

| Platform | Lockdown browser |
|---|---|
| macOS / iPadOS | **SEB** |
| Windows | **SUB** (WebView2) |
| Android (masa depan) | **SUB** (varian Android) |

## Prinsip arsitektur: pisahkan 3 lapisan

Akar tabrakan = mencampur tiga pertanyaan berbeda. Pisahkan:

| Lapisan | Pertanyaan | Diwakili sekarang |
|---|---|---|
| **1. Deteksi** | Aku jalan di lockdown browser apa? | `isSEB` |
| **2. Kebijakan platform** | Di platform ini, browser apa yang *seharusnya*? | `enforceSEB` (= `isMacOSOrIPad`) |
| **3. Validasi/clearance** | Untuk ujian ini, apakah browser-nya sah? | `requireSEB` + config key (`seb-validate.js`) |

Kunci anti-tabrakan dengan opsi admin "Wajib SEB + config key": **lapisan 2 (gate
akses) dan lapisan 3 (validasi config key) SUDAH terpisah** di kode —
`rbac.js` pakai `enforceSEB`, `seb-validate.js` pakai `requireSEB` per-ujian.
Pemisahan itu dipertahankan; kita hanya menggenerikkan nama SEB → "lockdown" lalu
**dispatch ke strategi per-browser** di lapisan 3. Config Key adalah konsep KHAS
SEB — jangan dipaksakan ke SUB; SUB punya atestasi sendiri di bawah payung sama.

## Aturan emas penamaan

Nama **generik** untuk konsep payung; nama **browser-spesifik** hanya untuk hal
yang memang khas browser itu (config key & quit-password → SEB; `postMessage`
host & UA token → SUB).

| Lama (SEB-spesifik) | Baru (generik) | Catatan |
|---|---|---|
| `isSEB` | `activeLockdown` / `isLockdown` | `isSEB` boleh tetap untuk cek SEB spesifik |
| `enforceSEB` | `lockdownPolicyOn` + `expectedLockdown()` | dipecah: kebijakan global + peta platform |
| `requireSEB` (per-ujian) | `requireLockdown` | perlu migrasi field DB / baca dua-duanya transisi |
| `ensureSEBClearance` | `ensureLockdownClearance` (router) | `ensureSEBClearance` jadi strategi internal SEB |
| `exit-seb.html` | *(dipertahankan)* | Quit URL SEB **dan** `exitUrl` SUB; keduanya auto-quit via navigasi ke URL ini |

## Kontrak marker browser

Setiap lockdown browser WAJIB menanam penanda yang sulit dipalsukan tab biasa:

- **SEB**: `window.SafeExamBrowser` (sudah ada) / UA mengandung `SEB`.
- **SUB (WebView2)**, dipasang host C#:
  1. **User-Agent** di-append token: `... SimpleUjianBrowser/1.0`.
     `webView.CoreWebView2.Settings.UserAgent += " SimpleUjianBrowser/1.0";`
  2. **Window object** di-inject SEBELUM JS halaman jalan (tiap navigasi):
     ```csharp
     await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
       "window.SimpleUjianBrowser = { version: '1.0', platform: 'webview2' };");
     ```
     Meniru perilaku `window.SafeExamBrowser` → anti-spoof lebih kuat dari UA saja.

## Modul inti (sketsa) — `js/lockdown.js`

```js
export const Lockdown = Object.freeze({ NONE:"none", SEB:"seb", SUB:"sub" });

// LAPISAN 1 — yang AKTIF sekarang
export function detectLockdown() {
  const ua = navigator.userAgent;
  if (window.SafeExamBrowser || /SEB|SafeExamBrowser/.test(ua)) return Lockdown.SEB;
  if (window.SimpleUjianBrowser || ua.includes("SimpleUjianBrowser")) return Lockdown.SUB;
  return Lockdown.NONE;
}
export const activeLockdown = detectLockdown();   // pengganti `isSEB`
export const isLockdown = activeLockdown !== Lockdown.NONE;

// LAPISAN 2 — yang DIHARAPKAN di platform ini
export function expectedLockdown() {
  if (isMacOSOrIPad()) return Lockdown.SEB;
  if (isWindows())     return Lockdown.SUB;
  if (isAndroid())     return Lockdown.SUB;   // masa depan
  return Lockdown.NONE;
}
export const lockdownPolicyOn = false;          // kill-switch global (ganti enforceSEB=false)
export function lockdownSatisfied() {
  if (!lockdownPolicyOn) return true;
  const want = expectedLockdown();
  return want === Lockdown.NONE || activeLockdown === want;
}
```

(Tambah `isWindows()` / `isAndroid()` di sebelah `isMacOSOrIPad()` yang sudah ada.)

---

## Tahap L1 — Fondasi deteksi & exit (LOW-RISK, tidak menyentuh backend)

Menjawab kebutuhan hari ini: logout dari SUB juga diarahkan ke exit page yang sama.

1. [x] Buat `js/lockdown.js`: enum `Lockdown`, `detectLockdown`, `activeLockdown`,
       `isLockdown`, `expectedLockdown`, `lockdownPolicyOn`, `lockdownSatisfied`.
       `isWindows()` / `isAndroid()` ditambah di `seb-utils.js` (samping
       `isMacOSOrIPad`) lalu di-impor `lockdown.js`.
2. [x] `seb-utils.js`: `isSEB` dipertahankan (cek SEB spesifik); belum perlu
       re-export karena impor lama (`rbac.js`/`loginPage.js`) belum disentuh (L2).
3. [x] **Nama file `pages/exit-seb.html` DIPERTAHANKAN** (bukan di-rename) &
       isinya **tetap statis** (tanpa script sadar-browser). URL itu adalah
       **Quit URL** SEB (tertanam di `.seb` produksi terenkripsi) **sekaligus**
       `exitUrl` SUB (di `lockdown-config.json`). Kedua browser auto-quit lewat
       **navigasi ke URL ini** — mekanisme yang sama.
4. [x] `js/pages/studentPage.js`: `if (isSEB)` → `if (isLockdown)`; impor dari
       `lockdown.js`. SEB & SUB → exit page; non-lockdown → `/`.
5. [x] Sisi host C# (repo `simple-ujian-browser-desktop`): pasang **marker saja**
       (UA token + `window.SimpleUjianBrowser`) di `MainWindow.InitializeWebViewAsync`.
       **TIDAK perlu** `WebMessageReceived`/`postMessage` — SUB sudah punya
       `OnNavigationStarting` yang auto-quit saat web menavigasi ke `exitUrl`.

**Belum menyentuh** validasi config-key / DB / Cloud Function sama sekali.
Build Vite hijau setelah perubahan ini.

### TEMUAN KUNCI: SUB sudah punya mekanisme exit = SEB

SUB mengambil `lockdown-config.json` dari Firebase Hosting; field `exitUrl` sudah
diset ke `https://simple-ujian.web.app/pages/exit-seb.html`. `OnNavigationStarting`
membatalkan navigasi ke `exitUrl` (`e.Cancel = true`) lalu menutup app **tanpa
password** — identik dengan Quit URL SEB. Karena navigasi dibatalkan sebelum
render, pendekatan `postMessage("quit")` jadi *dead code* di SUB → **dibatalkan**.
Satu-satunya yang kurang dulu: **marker**, agar `isLockdown` true di web sehingga
logout diarahkan ke `exitUrl` (yang lalu memicu auto-quit).

### Panduan host C# WebView2 (langkah L1.5) — marker saja

Di `MainWindow.InitializeWebViewAsync`, setelah `EnsureCoreWebView2Async()` &
setelah set `Settings` keamanan:

```csharp
// Marker agar web (js/lockdown.js) mengenali SUB → terapkan alur lockdown.
settings.UserAgent += " SimpleUjianBrowser/1.0";
await WebView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
    "window.SimpleUjianBrowser = { version: '1.0', platform: 'webview2' };");
```

Auto-quit saat logout SUDAH ditangani `OnNavigationStarting` + `exitUrl` yang ada.

L2 dipecah dua karena **atestasi SUB ditunda** (keputusan: refactor dulu).
Insight: sampai atestasi SUB ada, "requireLockdown" praktis = "requireSEB"
(cuma SEB yang bisa lolos) → rename field & clearance SUB pas dilakukan bareng
L2b, bukan dipotong setengah.

### Tahap L2a — Generalisasi gate akses  [SELESAI]

Lapisan **akses** (bukan clearance per-ujian) jadi lockdown-neutral & multi-platform.
Aman/dormant karena `lockdownPolicyOn=false` → tanpa perubahan perilaku.

1. [x] `rbac.js`: gate siswa `enforceSEB`/`isSEB` → `lockdownSatisfied()`.
2. [x] `loginPage.js`: tampil/sembunyi login & banner pakai `lockdownSatisfied()`
       / `isLockdown` (bukan `enforceSEB`/`isSEB`).
3. [x] `seb-utils.js`: `enforceSEB` ditandai `@deprecated` (digantikan
       `lockdownPolicyOn`); `isSEB` dipertahankan sebagai primitive khas SEB.
4. [ ] (Saat `lockdownPolicyOn` diaktifkan) buat teks `#seb-warning-container`
       per-platform via `expectedLockdown()` (SEB vs SUB). TODO di `loginPage.js`.

### Tahap L2b — Clearance per-ujian + atestasi SUB  [NANTI, sentuh backend + DB]

Saling bergantung & sensitif-keamanan → dikerjakan sebagai satu paket.

1. [ ] `ensureLockdownClearance(examId, exam)` sebagai **router**:
       - `activeLockdown === SEB` → `ensureSEBClearance` (alur config-key sekarang).
       - `activeLockdown === SUB` → `ensureSUBClearance` (atestasi SUB, baru).
       - lainnya → tolak. Panggil ini dari `examPage.js` (ganti `ensureSEBClearance`).
2. [ ] Rancang **atestasi SUB**: host C# kirim token bertanda-tangan yang
       diverifikasi Cloud Function — analog peran config key SEB, tapi mekanisme
       milik SUB. Plafon jaminan = deterrence (kunci bisa diekstrak dari .exe).
3. [ ] Generikkan field per-ujian `requireSEB` → `requireLockdown` (baca
       dua-duanya saat transisi); label admin "Wajib browser ujian".
4. [ ] Firestore rules: `examRequiresSEB` → `examRequiresLockdown`; clearance
       berlaku untuk SEB maupun SUB.

## Catatan koeksistensi dengan Rencana I

- Toggle admin tetap **satu** switch; platform yang menentukan browser & strategi
  validasinya → tidak menambah beban admin, tidak tabrakan.
- Alur config-key SEB (Fase 0–3 Rencana I) menjadi **satu strategi** di bawah
  `ensureLockdownClearance`, bukan dibongkar.
- Cleanup Fase 4 Rencana I (hapus `seb-check.html`, `sebEcho`, dll.) tetap berlaku
  dan independen dari Rencana II.

## Keputusan terkunci (Rencana II)

- **Exit SUB pakai mekanisme `exitUrl` yang sudah ada** (navigasi → auto-quit),
  BUKAN `postMessage("quit")`. → L1 SELESAI & terverifikasi di Windows.
- **Nama `exit-seb.html` dipertahankan** (rename memicu perubahan Config Key SEB
  → regenerasi `.seb` + update secret). Ditunda sampai memang regenerasi `.seb`.
- **Atestasi SUB ditunda** ke L2b; L2a hanya generalisasi gate akses.
