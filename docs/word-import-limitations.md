# Limitasi Impor Soal dari Word (.docx)

Dokumen ini mendokumentasikan limitasi yang diketahui pada fitur **Impor dari Word (.docx)** di halaman admin editor soal.

---

## Gambar yang Di-crop di Word Tidak Terpotong Saat Impor

### Gejala

Guru membuat soal di MS Word, memasukkan gambar, lalu **mengcrop** gambar tersebut di Word (misalnya untuk memotong bagian yang tidak relevan). Setelah file .docx diimpor ke simple-ujian, gambar yang tampil adalah **versi utuh/tanpa crop** — seolah crop tidak pernah dilakukan.

### Penyebab

Sistem impor soal menggunakan library **mammoth.js** untuk mengkonversi file .docx ke HTML. Prosesnya:

1. File `.docx` sebenarnya adalah file ZIP. Di dalamnya terdapat folder `word/media/` yang menyimpan **file gambar asli** (PNG, JPG, dll.) secara utuh tanpa modifikasi.

2. **Crop di MS Word bersifat non-destruktif.** Saat guru mengcrop gambar di Word, yang disimpan hanyalah metadata crop (properti XML seperti `o:cropleft`, `o:cropright`, `o:croptop`, `o:cropbottom` pada format VML lama, atau `clip-rect` pada Drawing ML modern). File gambar asli di `word/media/` tetap tidak berubah.

3. mammoth.js hanya melakukan:
   - Ekstrak file gambar dari `word/media/` di dalam ZIP
   - Konversi ke base64 data URL
   - Embed langsung ke HTML output

   mammoth.js **tidak membaca atau memproses metadata crop** dari XML Word. Hasilnya: gambar penuh (uncropped) yang dimasukkan ke editor.

4. Di frontend simple-ujian, fungsi `extractBase64ImagesToPlaceholders()` (adminPage.js) hanya menyimpan base64 ke dalam map `editorTempImages` tanpa image processing apapun.

### Dampak

- Gambar yang sengaja di-crop untuk menyembunyikan bagian tertentu akan **terekspos sepenuhnya** setelah impor.
- Ukuran file gambar yang diimpor bisa lebih besar dari yang diperlukan (karena mengandung area yang seharusnya terpotong).

### Solusi / Workaround

| Opsi | Keterangan |
|------|-----------|
| **Crop sebelum masuk Word** | Guru melakukan crop gambar menggunakan image editor (Paint, Photos, dsb.) **sebelum** memasukkannya ke dokumen Word. |
| **Crop di editor simple-ujian** | Setelah impor, guru crop manual gambar di editor soal simple-ujian (jika fitur crop tersedia). |

### Referensi Teknis

- mammoth.js tidak mendukung pemrosesan gambar (crop, rotate, effects) — di luar scope library.
- Menerapkan crop otomatis memerlukan parsing XML Word secara manual (berbeda antara format VML Word 2003 dan Drawing ML Word 2007+), lalu menerapkan canvas crop di browser. Ini memerlukan effort yang signifikan.

---

## Impor Ulang Soal Bisa Memutus Tautan ke Jawaban Siswa

### Gejala

Guru mengimpor ulang soal dari Word ke ujian yang **sudah punya hasil siswa** (misalnya untuk menambahkan kunci jawaban). Setelah disimpan, halaman detail hasil menampilkan kolom jawaban siswa **kosong** dan semua soal bertanda "❌ Salah (0/0)", padahal total nilai di bagian atas masih benar. Ekspor CSV tetap memuat jawaban siswa secara lengkap.

### Penyebab

`submissions.answersByQuestionId` adalah objek yang **kuncinya adalah ID soal**, dan `submissions.breakdown[].questionId` menunjuk ID yang sama.

Sebelum perbaikan, tiap soal hasil impor diberi ID sementara `temp_<timestamp>_<idx>`. Saat disimpan, ID berawalan `temp_` selalu masuk ke `createQuestion()` yang memakai `addDoc` — Firestore menerbitkan **ID dokumen baru**, lalu `exams.questionIds` diganti dengan deretan ID baru itu.

Akibatnya lookup di halaman hasil (`recapManager.js` dan `resultPage.js`) mencari `answersByQuestionId[q.id]` memakai ID baru dan selalu mendapat `undefined`. Ekspor CSV tidak terdampak karena ia hanya melakukan `JSON.stringify(answersByQuestionId)` mentah tanpa lookup ke soal.

Datanya sendiri tidak pernah hilang — hanya kuncinya yang tidak lagi cocok. Dokumen soal lama juga tidak dihapus (penghapusan soal hanya terjadi lewat `deleteExam`).

### Perbaikan yang Sudah Diterapkan

1. **Baris `ID:` pada file ekspor.** `docxExporter.js` menulis baris `ID: <questionId>` berwarna abu-abu di bawah tiap soal. `parseImportedHtml()` membacanya kembali sebagai `sourceId`, dan alur impor memakainya sebagai ID soal — sehingga round-trip ekspor → edit di Word → impor menempel ke dokumen soal yang sama.

2. **Pakai ulang ID berdasarkan posisi.** Untuk dokumen yang tidak punya baris `ID:` (mis. diketik ulang dari nol), `saveEditorQuestionsToFirestore()` memakai ulang `exams.questionIds` yang ada pada posisi yang sama. Dialog konfirmasi menyebutkan berapa soal yang menimpa soal lama, berapa yang dibuat baru, dan memperingatkan bila jumlah soal berubah.

### Yang Masih Perlu Diwaspadai

- **Jumlah atau urutan soal berubah.** Pemetaan berbasis posisi hanya benar bila urutan soal tetap. Jika guru menyisipkan, menghapus, atau menukar urutan soal pada ujian yang sudah ada hasilnya, jawaban siswa bisa menempel ke soal yang keliru. Dialog konfirmasi memperingatkan saat jumlahnya berubah, tapi perubahan urutan tanpa perubahan jumlah tidak terdeteksi.
- **Tombol "🤖 Nilai Ulang Otomatis"** pada submission yang tautannya masih putus akan menghitung nilai dari jawaban yang tak terbaca — hasilnya ~0 dan menimpa `breakdown` serta `totalScore`. Perbaiki tautannya lebih dulu.

### Memulihkan Data yang Sudah Terlanjur Putus

`scripts/repair-question-ids.mjs` memetakan ulang kunci `answersByQuestionId` dan `breakdown[].questionId` dari ID lama ke ID baru. Urutan ID lama diambil dari `breakdown`, yang mengikuti urutan soal ujian saat siswa mengumpulkan (lihat `calculateScore` di `js/scoring.js`).

```bash
npm run audit:question-ids                          # read-only, tidak mengubah apa pun
npm run audit:question-ids -- --exam=<examId>       # batasi ke satu ujian
npm run repair:question-ids                         # tulis perbaikan
```

Mode perbaikan menulis cadangan seluruh submission yang tersentuh ke `backup/` (gitignored, berisi jawaban siswa) sebelum mengubah apa pun. Nilai dan status penilaian tidak disentuh — yang berubah hanya ID soal yang ditunjuk.

Submission ditandai `BLOCKED` dan dilewati bila pemetaannya tidak bisa dipastikan: jumlah soal berubah, `breakdown` kosong, atau `breakdown` sudah tertimpa ID baru (tanda tombol "Nilai Ulang Otomatis" sempat ditekan). Kasus itu perlu ditangani manual — jawaban mentahnya masih bisa dibaca dari ekspor CSV.
