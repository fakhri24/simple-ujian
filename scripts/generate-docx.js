import fs from "node:fs";
import { Document, Packer, Paragraph, HeadingLevel, ImageRun } from "docx";

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
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.mkdirSync("public/templates", { recursive: true });
  fs.writeFileSync("public/templates/template-soal.docx", buffer);
  console.log("Template .docx berhasil dibuat di public/templates/template-soal.docx");
});
