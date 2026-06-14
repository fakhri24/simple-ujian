import { Document, Packer, Paragraph, HeadingLevel, ImageRun, TextRun, PageBreak } from "docx";

const fetchImageAsArrayBuffer = async (url) => {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Gagal mengunduh gambar.");
    return await res.arrayBuffer();
  } catch (err) {
    console.error("Gagal mendownload gambar untuk embed docx:", err);
    return null;
  }
};

const getArrayBufferFromBase64 = (base64String) => {
  const parts = base64String.split(";base64,");
  if (parts.length < 2) return null;
  const raw = window.atob(parts[1]);
  const rawLength = raw.length;
  const uInt8Array = new Uint8Array(rawLength);
  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }
  return uInt8Array.buffer;
};

const getImageDimensions = (src) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || 300, height: img.naturalHeight || 200 });
    };
    img.onerror = () => {
      resolve({ width: 300, height: 200 });
    };
    img.src = src;
  });
};

export const exportQuestionsToDocx = async (questions, filename, editorTempImages = {}, feedbackEl) => {
  const children = [
    new Paragraph({
      children: [
        new TextRun({
          text: "TEMPLATE IMPORT SOAL - SIMPLE UJIAN",
          bold: true,
        }),
      ],
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph({
      text: "",
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Silakan gunakan template ini untuk menulis soal.",
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Anda wajib mempertahankan format penulisan di bawah ini agar soal terbaca sempurna oleh sistem parser.",
        }),
      ],
    }),
    new Paragraph({
      text: "",
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Penting (LaTeX):",
          bold: true,
          italics: true,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Untuk menulis rumus matematika, gunakan sintaks LaTeX biasa yang diawali dan diakhiri dengan tanda dollar ($), misalnya: $x^2 + y^2 = z^2$.",
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "JANGAN gunakan editor equation bawaan Word.",
        }),
      ],
    }),
    new Paragraph({
      text: "",
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Petunjuk Tipe & Bobot Soal:",
          bold: true,
          italics: true,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Tipe Pilihan Ganda (PG) adalah tipe standar, sehingga Anda TIDAK PERLU menuliskan baris Tipe di bawah teks soal PG.",
        }),
      ],
    }),
    new Paragraph({
      text: "",
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Bobot standar soal adalah 10, sehingga Anda TIDAK PERLU menuliskan baris Bobot jika nilainya 10.",
        }),
      ],
    }),
    new Paragraph({
      text: "",
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Untuk tipe selain PG (seperti Essay, Menjodohkan / Match, atau Matriks Benar/Salah / TF Matrix), atau jika bobot soal bukan 10, Anda wajib mencantumkan baris Tipe (contoh: Tipe: essay) atau Bobot (contoh: Bobot: 15) di bawah konten soal.",
        }),
      ],
    }),
    new Paragraph({
      children: [new PageBreak()],
    }),
  ];

  for (let idx = 0; idx < questions.length; idx++) {
    const q = questions[idx];
    
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = q.content;
    
    const imgElements = [...tempDiv.querySelectorAll("img")];
    const paragraphsInQ = [...tempDiv.querySelectorAll("p, div, li")];
    let qTextParts = [];
    if (paragraphsInQ.length > 0) {
      paragraphsInQ.forEach((pEl) => {
        const text = pEl.textContent.trim();
        if (text) qTextParts.push(text);
      });
    } else {
      const text = tempDiv.textContent.trim();
      if (text) qTextParts.push(text);
    }
    
    const firstTextPart = qTextParts.shift() || "Soal bergambar/tanpa teks";
    children.push(new Paragraph({
      text: `${idx + 1}. ${firstTextPart}`,
      heading: HeadingLevel.HEADING_2,
    }));

    for (const img of imgElements) {
      let src = img.getAttribute("src") || "";
      if (editorTempImages[src]) {
        src = editorTempImages[src];
      }
      let buffer = null;
      let imgType = "png";
      
      if (src.startsWith("data:image")) {
        buffer = getArrayBufferFromBase64(src);
        const match = src.match(/data:image\/([a-zA-Z+]+);/);
        if (match) imgType = match[1];
      } else if (src.startsWith("http") || src.startsWith("/")) {
        buffer = await fetchImageAsArrayBuffer(src);
        if (src.endsWith(".jpg") || src.endsWith(".jpeg")) imgType = "jpg";
      }
      
      if (buffer) {
        let width = 300;
        let height = 200;
        try {
          const dims = await getImageDimensions(src);
          const maxW = 400; // Safe maximum width for Docx A4 paper layout
          if (dims.width > maxW) {
            height = Math.round((maxW / dims.width) * dims.height);
            width = maxW;
          } else {
            width = dims.width || 300;
            height = dims.height || 200;
          }
        } catch (err) {
          console.error("Gagal mendeteksi dimensi gambar asli:", err);
        }

        children.push(new Paragraph({
          children: [
            new ImageRun({
              data: buffer,
              transformation: {
                width: width,
                height: height,
              },
              type: imgType === "jpg" ? "jpg" : "png",
            }),
          ],
        }));
      }
    }

    qTextParts.forEach((partText) => {
      children.push(new Paragraph({
        text: partText,
      }));
    });

    if (q.type !== "pg") {
      children.push(new Paragraph({ text: `Tipe: ${q.type}` }));
    }
    if (q.scoreWeight !== 10 && q.scoreWeight !== undefined && q.scoreWeight !== null) {
      children.push(new Paragraph({ text: `Bobot: ${q.scoreWeight}` }));
    }

    if (q.type === "pg" || q.type === "pgk") {
      (q.options || []).forEach((opt, oIdx) => {
        const letter = String.fromCharCode(65 + oIdx);
        children.push(new Paragraph({ text: `${letter}. ${opt.text}` }));
      });
      
      const correctLetters = (q.options || [])
        .map((opt, oIdx) => opt.isCorrect ? String.fromCharCode(65 + oIdx) : null)
        .filter(Boolean)
        .join(", ");
      
      children.push(new Paragraph({ text: `Kunci: ${correctLetters}` }));
    } else if (q.type === "tf") {
      const isTrue = (q.options || []).find(o => o.id === "true")?.isCorrect;
      children.push(new Paragraph({ text: `Kunci: ${isTrue ? "Benar" : "Salah"}` }));
    } else if (q.type === "tf_matrix") {
      (q.statements || []).forEach((stmt) => {
        const val = stmt.isCorrect === "true" || stmt.isCorrect === true ? "Benar" : "Salah";
        children.push(new Paragraph({ text: `Pernyataan: ${stmt.text} = ${val}` }));
      });
    } else if (q.type === "match") {
      (q.matchPairs || []).forEach((pair) => {
        children.push(new Paragraph({ text: `Pasangan: ${pair.left} = ${pair.right}` }));
      });
    }

    children.push(new Paragraph({ text: "" }));
  }

  try {
    const doc = new Document({
      styles: {
        default: {
          document: {
            run: {
              size: 24,
              color: "000000",
              font: "Arial",
            },
          },
          heading1: {
            run: {
              size: 24,
              color: "000000",
              bold: true,
              font: "Arial",
            },
          },
          heading2: {
            run: {
              size: 24,
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
          children: children,
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    if (feedbackEl) {
      feedbackEl.textContent = "Word berhasil diekspor & diunduh!";
    }
  } catch (err) {
    if (feedbackEl) {
      feedbackEl.textContent = `Gagal mengekspor: ${err.message}`;
    }
    alert(`Gagal mengekspor ke Word: ${err.message}`);
  }
};
