# Project Overview

Kita akan membangun MVP (Minimum Viable Product) untuk platform Computer Based Test (CBT) yang ringan, responsif, dan sangat fleksibel. Aplikasi ini tidak menggunakan framework JS berat (seperti React/Vue), melainkan Vanilla JavaScript, HTML5, CSS3, dan Firebase (Firestore & Auth) sebagai backend.

# Developer Persona

Kamu adalah Full-stack Web Developer ahli yang berfokus pada performa, arsitektur kode vanilla yang modular, dan UI/UX yang bersih. Kode yang kamu hasilkan harus DRY (Don't Repeat Yourself), mudah dibaca, dan menggunakan ES6+ features (Modules, async/await, arrow functions).

# Core Tech Stack

- Frontend: HTML5, CSS3 (atau TailwindCSS via CDN untuk kecepatan layouting), Vanilla JavaScript (ES6+).
- Backend: Firebase Auth, Cloud Firestore (Modular SDK v10+).
- Ekstensi Wajib:
  - KaTeX / MathJax (untuk rendering rumus matematika).
  - Atribut `dir="auto"` pada container teks (untuk deteksi otomatis bahasa Arab/RTL).

# Database Schema (Firestore)

Fokus pada koleksi `exams` dan `questions`. Format JSON untuk `questions` harus sangat fleksibel untuk mengakomodasi 5 mode soal:

1. `pg` (Pilihan Ganda - 1 jawaban benar)
2. `pgk` (Pilihan Ganda Kompleks - >1 jawaban benar)
3. `tf` (True/False atau Benar/Salah)
4. `essay` (Isian bebas)
5. `match` (Menjodohkan)

Contoh struktur data standar yang harus kamu dukung:
{
"id": "q_001",
"type": "pgk", // pg, pgk, tf, essay, match
"content": "<p>Teks soal, bisa panjang, bisa memuat tag HTML, rumus LaTeX, atau huruf Arab.</p>",
"options": [
{"id": "opt_A", "text": "Pilihan 1", "isCorrect": true},
{"id": "opt_B", "text": "Pilihan 2", "isCorrect": false}
],
"matchPairs": [ // Hanya untuk tipe 'match'
{"left": "Ibukota Indonesia", "right": "Jakarta"},
{"left": "Ibukota Jepang", "right": "Tokyo"}
],
"scoreWeight": 100 // Bobot nilai
}

# Key Features & Implementation Rules

## 1. Role-Based Access Control (RBAC) Sederhana

- Implementasikan pengecekan role (Admin vs Siswa) di setiap halaman.
- Admin memiliki halaman dashboard untuk membuat ujian dan menambah soal.
- Siswa hanya melihat daftar ujian yang aktif dan halaman eksekusi ujian.
- Buat akun dummy siswa dan guru yang sudah bisa login, dibuat manual via script seed.
- Buat beberapa soal dummy untuk setiap tipe soal, untuk mata pelajaran berbeda, seperti yang membutuhkan katex dan bahasa arab.

## 2. Dynamic Question Renderer (Engine Inti)

- Buat sebuah modul JS (`questionRenderer.js`) yang menerima objek JSON soal dan merender HTML yang sesuai.
- **PG & TF:** Render menggunakan input `<input type="radio">`.
- **PGK:** Render menggunakan input `<input type="checkbox">`.
- **Essay:** Render menggunakan `<textarea>`.
- **Menjodohkan (Match):** Menggunakan UI drag-and-drop HTML5 dengan fallback Click-to-Pair untuk keselarasan perangkat layar sentuh. Tampilkan deck kartu pilihan acak di sisi kanan dan area penampung slot di sisi kiri.
- Buatkan satu soal per tampilan (next/prev).
- Untuk soal menjodohkan buat acak setiap render.
- Kunci jawaban ada dalam dokumen soal, dalam satu struktur bank soal.

## 3. Eksekusi Ujian (Student View)

- Tampilkan satu soal per halaman (Pagination) atau scroll-based (pilih yang paling simpel untuk MVP).
- Sediakan array `answers` di frontend untuk menyimpan state jawaban siswa secara lokal (bisa di `localStorage` sebagai fallback jika koneksi putus).
- Jalankan KaTeX renderer setelah DOM dimuat ulang saat berpindah soal agar rumus matematika terproses.

## 4. Scoring Engine

- Buat fungsi utilitas terpisah `calculateScore(userAnswers, correctKey)`.
- Untuk PGK, gunakan logika scoring Parsial Berpenalti (Partial Scoring with Penalty). Nilai dihitung berdasarkan rasio jawaban benar dikurangi jawaban salah dibagi total kunci jawaban benar, dengan nilai minimal 0.
- Untuk essai tidak auto menambah skor, tapi manual review.

# Coding Standards

1. Pisahkan logika UI dan logika data. Gunakan struktur folder: `/js/auth.js`, `/js/db.js`, `/js/examEngine.js`.
2. Jangan gunakan jQuery. Gunakan murni `document.querySelector` dan Vanilla DOM API.
3. Gunakan Template Literals (``) untuk merender komponen HTML dari JavaScript.
4. Selalu bungkus operasi database dengan `try...catch` dan berikan feedback visual kepada user (loading spinner/alert).
5. Selalu test aplikasi yang sudah di-update dengan smoke/E2E. Cek bug yang ada, buktikan bug. Selesaikan, buktikan bug sudah diselesaikan.

# Firebase config

```
const firebaseConfig = {
  apiKey: "AIzaSyD6aFkE8CEYA7ACXlF--BMV7XLkfi4fvWI",
  authDomain: "simple-ujian.firebaseapp.com",
  projectId: "simple-ujian",
  storageBucket: "simple-ujian.firebasestorage.app",
  messagingSenderId: "133707273043",
  appId: "1:133707273043:web:213433c1b1016f721587a6"
};
```
