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
