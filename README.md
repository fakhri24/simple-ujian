# Simple Ujian

Platform ujian online (CBT) berbasis **Vanilla JavaScript + Vite + Firebase** (Auth, Firestore, Hosting). Mendukung dua peran: **admin** (kelola soal & ujian, nilai, rekap) dan **siswa** (mengerjakan ujian).

## Fitur

- Login Firebase Auth dengan role `admin` / `siswa` dan RBAC per halaman
- 5 tipe soal: `pg`, `pgk`, `tf`, `essay`, `match` (+ `tf_matrix`)
- Engine ujian satu-soal-per-tampilan dengan autosave
- Timer countdown dengan auto-submit saat waktu habis
- Deteksi anti-cheat (keluar fullscreen, pindah tab, blur)
- Penjagaan sesi login ganda (single active session)
- Penilaian otomatis + penilaian manual essay oleh admin
- Rekap nilai dan ekspor CSV
- Dukungan rumus KaTeX dan teks RTL (`dir="auto"`)

## Stack

- Frontend: Vanilla JS, Vite (multi-page build)
- Backend: Firebase Auth, Cloud Firestore, Firebase Hosting

## Setup Lokal

```bash
npm install
cp .env.example .env   # isi dengan konfigurasi Firebase milikmu
npm run dev
```

Aplikasi dev berjalan di Vite dev server. Build produksi: `npm run build` (output ke `dist/`).

## Konfigurasi

- Salin `.env.example` ke `.env` dan isi kredensial Firebase Web SDK.
- Untuk seed/skrip admin, taruh service account di `firebase/firebase-service-account.json` (file ini diabaikan git).

## Scripts

| Perintah        | Fungsi                                  |
| --------------- | --------------------------------------- |
| `npm run dev`   | Menjalankan dev server                  |
| `npm run build` | Build produksi ke `dist/`               |
| `npm run preview` | Preview hasil build                   |
| `npm run seed`  | Seed data awal ke Firestore             |

## Struktur

```
js/
  auth.js            # Firebase Auth helper
  db.js              # akses Firestore
  session.js         # penjagaan sesi login ganda
  rbac.js            # kontrol akses per peran
  scoring.js         # penilaian otomatis
  examEngine.js      # state & timer ujian
  questionRenderer.js# render soal
  pages/             # logika tiap halaman (admin, exam, result, student, login)
pages/               # HTML tiap halaman
firestore.rules      # Firestore security rules
scripts/             # skrip seed & utilitas (firebase-admin)
```

## Integrasi Safe Exam Browser (SEB)

Untuk meningkatkan keamanan ujian pada perangkat macOS dan iOS/iPad, sistem CBT ini terintegrasi dengan **Safe Exam Browser (SEB)**. Pengguna Windows tetap diizinkan menggunakan browser biasa demi kepraktisan (karena ukuran aplikasi SEB yang cukup besar).

### Alur Kerja & Deteksi Platform
1. **Deteksi Otomatis:** Halaman login mendeteksi sistem operasi siswa secara otomatis.
   - **macOS & iOS/iPad:** Siswa wajib menggunakan SEB. Jika membuka di browser biasa, mereka akan dihalangi dan diberikan tautan untuk mengunduh aplikasi resmi SEB serta file konfigurasi ujian (`.seb`).
   - **Windows / OS Lain:** Bebas masuk menggunakan browser biasa (seperti Google Chrome).
2. **Keluar SEB Aman (Smart Logout):**
   - Siswa tetap bisa kembali dari halaman hasil ujian ke dashboard daftar ujian.
   - Penutupan SEB secara otomatis dipicu ketika siswa menekan tombol **Logout** pada dashboard siswa (`student.html`).
   - Jika siswa mencoba keluar SEB secara paksa menggunakan tombol bawaan SEB atau shortcut (`Alt+F4` / `Cmd+Q`), mereka harus memasukkan **Quit Password** pengawas.

### Kredensial Konfigurasi SEB (`.seb`)
File konfigurasi ujian tersimpan di [public/simple-ujian.seb](file:///Users/fakhri246/project/ujian/simple-ujian/public/simple-ujian.seb). Berikut adalah kredensial pengamanannya:
* **Admin Password:** `Admin123!` (digunakan jika ingin mengedit setelan konfigurasi SEB).
* **Quit Password (Pengawas):** `Rahasia123!` (digunakan untuk keluar darurat/manual dari SEB sebelum logout).
* **Start URL:** `http://localhost:5173/` (dapat disesuaikan jika ingin di-deploy ke production, misalnya `https://simple-ujian.web.app/`).
* **Quit URL:** `http://localhost:5173/pages/exit-seb.html` (URL pemicu exit otomatis tanpa password).

## Firestore Rules

`firestore.rules` menerapkan kebijakan berbasis peran: admin menulis `exams`/`questions`, siswa hanya menulis attempt & submission miliknya sendiri dengan validasi waktu dan status. Deploy:

```bash
npx -y firebase-tools@latest deploy --only firestore:rules
```

## Catatan Keamanan

- File sensitif (`.env`, `users.json`, service account, daftar password) **tidak** di-commit — lihat `.gitignore`.
- Penilaian saat ini dihitung di sisi client; pemindahan ke Cloud Function direncanakan agar kunci jawaban tidak terekspos ke siswa.

