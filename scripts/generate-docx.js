import fs from "node:fs";
import { Document, Packer, Paragraph, HeadingLevel, ImageRun, Table, TableRow, TableCell, WidthType } from "docx";

const doc = new Document({
  styles: {
    default: {
      document: {
        run: {
          size: 24, // 12pt
          color: "000000",
          font: "Arial",
        },
      },
      heading1: {
        run: {
          size: 24, // 12pt
          color: "000000",
          bold: true,
          font: "Arial",
        },
      },
      heading2: {
        run: {
          size: 24, // 12pt
          color: "000000",
          bold: false,
          font: "Arial",
        },
      },
    },
  },
  sections: [
    {
      properties: {},
      children: [
        new Paragraph({
          text: "TEMPLATE IMPORT SOAL - SIMPLE UJIAN",
          heading: HeadingLevel.HEADING_1,
        }),
        new Paragraph({
          text: "Silakan gunakan template ini untuk menulis soal. Anda wajib mempertahankan format penulisan di bawah ini agar soal terbaca sempurna oleh sistem parser.",
        }),
        new Paragraph({
          text: "Penting (LaTeX): Untuk menulis rumus matematika, gunakan sintaks LaTeX biasa yang diawali dan diakhiri dengan tanda dollar ($), misalnya: $x^2 + y^2 = z^2$. JANGAN gunakan editor equation bawaan Word.",
        }),
        new Paragraph({
          text: "Petunjuk Tipe & Bobot Soal: Tipe Pilihan Ganda (PG) adalah tipe standar, sehingga Anda TIDAK PERLU menuliskan baris Tipe di bawah teks soal PG. Bobot standar soal adalah 100, sehingga Anda TIDAK PERLU menuliskan baris Bobot jika nilainya 100. Untuk tipe selain PG (seperti Essay, Menjodohkan / Match, atau Matriks Benar/Salah / TF Matrix), atau jika bobot soal bukan 100, Anda wajib mencantumkan baris Tipe (contoh: Tipe: essay) atau Bobot (contoh: Bobot: 150) di bawah konten soal.",
        }),
        new Paragraph({
          text: "",
        }),
        new Paragraph({
          text: "Petunjuk Essay Diperiksa Otomatis: Soal essay biasa (tanpa baris Kunci) tetap menunggu koreksi guru. Jika Anda ingin jawabannya diperiksa otomatis, tambahkan baris Kunci di bawah soal, lalu lengkapi bila perlu dengan Alternatif (pisahkan dengan titik koma, bukan koma, karena koma dipakai untuk desimal), Mode (angka / teks / kata kunci), Toleransi, Satuan, dan Jika salah (isi 'salah' bila jawaban yang tidak cocok langsung dianggap salah; kosongkan agar dikirim ke koreksi guru). Untuk kunci berupa angka, siswa boleh menjawab dalam bentuk apa pun yang senilai: 3/4, 0,75, 75%, atau $\\frac{3}{4}$. Contohnya ada pada soal nomor 11 (angka) dan 12 (teks). Pengaturan lanjutan (wajib bentuk paling sederhana, toleransi salah ketik, jawaban setengah benar) hanya tersedia di editor soal, tidak ikut ditulis di file Word.",
        }),
        new Paragraph({
          text: "",
        }),
        new Paragraph({
          text: "Petunjuk Wacana / Grup Soal (Passage): Jika beberapa soal merujuk pada satu teks bacaan/wacana yang sama, gunakan penanda [GRUP SOAL: Judul Wacana] sebelum teks wacana. Tuliskan isi wacana di bawahnya, lalu tulis soal-soal yang terkait seperti biasa. Setelah soal terakhir dalam grup, tutup dengan penanda [TANPA GRUP SOAL] agar soal berikutnya tidak ikut tergabung dalam wacana tersebut. Contoh penggunaannya ada di bagian bawah template ini (lihat soal nomor 7-8 dan penutupnya).",
        }),
        new Paragraph({
          text: "",
        }),
        
        // Question 1: PG
        new Paragraph({ text: "1. Perhatikan gambar grafik fungsi kuadrat di bawah ini.", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({
          children: [
            new ImageRun({
              data: fs.readFileSync("public/templates/sample-graph.jpg"),
              transformation: {
                width: 300,
                height: 300,
              },
              type: "jpg",
            }),
          ],
        }),
        new Paragraph({ text: "Fungsi kuadrat manakah yang sesuai dengan grafik tersebut?" }),
        new Paragraph({ text: "A. $y = x^2$" }),
        new Paragraph({ text: "B. $y = 2x^2$" }),
        new Paragraph({ text: "C. $y = x^2 + 2$" }),
        new Paragraph({ text: "Kunci: A" }),
        new Paragraph({ text: "" }),

        // Question 2: PGK
        new Paragraph({ text: "2. Pilih bilangan prima di bawah ini.", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "Tipe: pgk" }),
        new Paragraph({ text: "A. 2" }),
        new Paragraph({ text: "B. 3" }),
        new Paragraph({ text: "C. 4" }),
        new Paragraph({ text: "Kunci: A, B" }),
        new Paragraph({ text: "" }),

        // Question 3: TF
        new Paragraph({ text: "3. Bahasa Arab ditulis dari kanan ke kiri.", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "Tipe: tf" }),
        new Paragraph({ text: "Kunci: Benar" }),
        new Paragraph({ text: "" }),

        // Question 4: TF Matrix
        new Paragraph({ text: "4. Tentukan Benar (True) atau Salah (False) untuk masing-masing pernyataan berikut:", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "Tipe: tf_matrix" }),
        new Paragraph({ text: "Pernyataan: 2 adalah satu-satunya bilangan prima genap = Benar" }),
        new Paragraph({ text: "Pernyataan: Hasil perkalian dari $5 \\times 5$ adalah 30 = Salah" }),
        new Paragraph({ text: "Pernyataan: Bahasa Arab ditulis dari kiri ke kanan = Salah" }),
        new Paragraph({ text: "" }),

        // Question 5: Essay
        new Paragraph({ text: "5. Jelaskan arti dari teks berikut: السلام عليكم", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "Tipe: essay" }),
        new Paragraph({ text: "" }),

        // Question 6: Match
        new Paragraph({ text: "6. Jodohkan negara dengan ibu kotanya.", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "Tipe: match" }),
        new Paragraph({ text: "Pasangan: Indonesia = Jakarta" }),
        new Paragraph({ text: "Pasangan: Jepang = Tokyo" }),
        new Paragraph({ text: "Pasangan: Prancis = Paris" }),
        new Paragraph({ text: "" }),

        // Question 7 & 8: Passage
        new Paragraph({ text: "[GRUP SOAL: Wacana Sastra]" }),
        new Paragraph({ text: "Bacalah kutipan puisi di bawah ini untuk menjawab soal nomor 7 dan 8." }),
        new Paragraph({ text: "Hujan bulan Juni..." }),
        new Paragraph({ text: "" }),

        new Paragraph({ text: "7. Siapakah penyair dari puisi tersebut?", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "A. Sapardi Djoko Damono" }),
        new Paragraph({ text: "B. Chairil Anwar" }),
        new Paragraph({ text: "C. WS Rendra" }),
        new Paragraph({ text: "Kunci: A" }),
        new Paragraph({ text: "" }),

        new Paragraph({ text: "8. Jelaskan tema utama dari kutipan puisi di atas.", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "Tipe: essay" }),
        new Paragraph({ text: "" }),

        // End of Passage Group
        new Paragraph({ text: "[TANPA GRUP SOAL]" }),
        new Paragraph({ text: "" }),

        // Standalone Question 9
        new Paragraph({ text: "9. Soal ini berada di luar wacana/grup soal (mandiri).", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "A. Sapardi Djoko Damono adalah penyair terkenal." }),
        new Paragraph({ text: "B. Chairil Anwar adalah penyair Angkatan 45." }),
        new Paragraph({ text: "Kunci: A" }),
        new Paragraph({ text: "" }),

        // Standalone Question 10 (Table sample)
        new Paragraph({ text: "10. Perhatikan tabel data penjualan barang berikut:", heading: HeadingLevel.HEADING_2 }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ text: "Nama Barang" })] }),
                new TableCell({ children: [new Paragraph({ text: "Penjualan (Unit)" })] }),
              ]
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ text: "Pensil" })] }),
                new TableCell({ children: [new Paragraph({ text: "150" })] }),
              ]
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ text: "Buku" })] }),
                new TableCell({ children: [new Paragraph({ text: "300" })] }),
              ]
            })
          ]
        }),
        new Paragraph({ text: "" }),
        new Paragraph({ text: "Berdasarkan tabel di atas, barang manakah yang paling banyak terjual?" }),
        new Paragraph({ text: "A. Pensil" }),
        new Paragraph({ text: "B. Buku" }),
        new Paragraph({ text: "Kunci: B" }),
        new Paragraph({ text: "" }),

        // Question 11: Essay yang diperiksa otomatis
        new Paragraph({ text: "11. Sebuah pita sepanjang 1 meter dipotong menjadi 4 bagian sama panjang. Berapa meter panjang setiap potongan?", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "Tipe: essay" }),
        new Paragraph({ text: "Kunci: 1/4" }),
        new Paragraph({ text: "Mode: angka" }),
        new Paragraph({ text: "" }),

        // Question 12: Essay teks dengan beberapa jawaban yang diterima
        new Paragraph({ text: "12. Siapakah presiden pertama Republik Indonesia?", heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "Tipe: essay" }),
        new Paragraph({ text: "Kunci: Soekarno" }),
        new Paragraph({ text: "Alternatif: Sukarno; Ir. Soekarno" }),
        new Paragraph({ text: "Mode: teks" }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.mkdirSync("public/templates", { recursive: true });
  fs.writeFileSync("public/templates/template-soal.docx", buffer);
  console.log("Template .docx berhasil dibuat di public/templates/template-soal.docx");
});
