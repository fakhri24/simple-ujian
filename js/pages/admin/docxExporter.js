import { Document, Packer, Paragraph, HeadingLevel, ImageRun, TextRun, PageBreak, Table, TableRow, TableCell, BorderStyle, WidthType } from "docx";
import { essayKeyToDocxLines } from "../../essayKeyDocx.js";

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

const convertHtmlToDocxElements = async (htmlString, editorTempImages = {}, isQuestion = false, qIndex = null) => {
  const container = document.createElement("div");
  container.innerHTML = htmlString;

  const docxElements = [];
  let firstBlockHandled = false;

  // Helper to handle text block with question index
  const handleTextParagraph = (text) => {
    if (isQuestion && !firstBlockHandled) {
      firstBlockHandled = true;
      return new Paragraph({
        text: `${qIndex}. ${text}`,
        heading: HeadingLevel.HEADING_2,
      });
    } else {
      return new Paragraph({ text });
    }
  };

  // Helper to handle image
  const handleImageParagraph = async (imgEl) => {
    let src = imgEl.getAttribute("src") || "";
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

      return new Paragraph({
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
      });
    }
    return null;
  };

  // Standardize the container: wrap any loose text nodes or inline elements at the root level in <p>
  const cleanNodes = [];
  let currentGroup = [];
  
  const flushGroup = () => {
    if (currentGroup.length > 0) {
      const p = document.createElement("p");
      currentGroup.forEach(node => p.appendChild(node.cloneNode(true)));
      cleanNodes.push(p);
      currentGroup = [];
    }
  };

  for (const node of [...container.childNodes]) {
    const isBlock = node.nodeType === Node.ELEMENT_NODE && 
      ["P", "DIV", "TABLE", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "OL", "UL"].includes(node.tagName);
    
    if (isBlock) {
      flushGroup();
      cleanNodes.push(node);
    } else {
      currentGroup.push(node);
    }
  }
  flushGroup();

  if (cleanNodes.length === 0) {
    const text = container.textContent.trim();
    if (text) {
      docxElements.push(handleTextParagraph(text));
    }
    return docxElements;
  }

  for (const el of cleanNodes) {
    if (el.tagName === "TABLE") {
      // Ensure question number is handled if table is first
      if (isQuestion && !firstBlockHandled) {
        docxElements.push(new Paragraph({
          text: `${qIndex}.`,
          heading: HeadingLevel.HEADING_2,
        }));
        firstBlockHandled = true;
      }

      const rows = [];
      const trElements = [...el.querySelectorAll("tr")];
      for (const tr of trElements) {
        const cells = [];
        const tdElements = [...tr.querySelectorAll("td, th")];
        for (const td of tdElements) {
          const isHeader = td.tagName === "TH";
          const cellText = td.textContent.trim();
          
          cells.push(new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: cellText,
                    bold: isHeader,
                  })
                ]
              })
            ],
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
              left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
              right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            },
            shading: isHeader ? { fill: "F2F2F2" } : undefined,
          }));
        }
        if (cells.length > 0) {
          rows.push(new TableRow({ children: cells }));
        }
      }

      if (rows.length > 0) {
        docxElements.push(new Table({
          width: {
            size: 100,
            type: WidthType.PERCENTAGE,
          },
          rows: rows,
        }));
      }
    } else if (el.tagName === "P" || el.tagName.startsWith("H") || el.tagName === "DIV" || el.tagName === "LI") {
      const text = el.textContent.trim();
      const imgs = [...el.querySelectorAll("img")];

      if (text) {
        docxElements.push(handleTextParagraph(text));
      } else if (isQuestion && !firstBlockHandled && imgs.length > 0) {
        docxElements.push(new Paragraph({
          text: `${qIndex}.`,
          heading: HeadingLevel.HEADING_2,
        }));
        firstBlockHandled = true;
      }

      for (const img of imgs) {
        const imgPara = await handleImageParagraph(img);
        if (imgPara) docxElements.push(imgPara);
      }
    }
  }

  return docxElements;
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
      text: "",
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Petunjuk Wacana / Grup Soal (Passage):",
          bold: true,
          italics: true,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Jika beberapa soal merujuk pada satu teks bacaan/wacana yang sama, gunakan penanda [GRUP SOAL: Judul Wacana] sebelum teks wacana.",
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Tuliskan isi wacana di bawahnya, lalu tulis soal-soal yang terkait seperti biasa.",
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Setelah soal terakhir dalam grup, tutup dengan penanda [TANPA GRUP SOAL] agar soal berikutnya tidak ikut tergabung dalam wacana tersebut.",
        }),
      ],
    }),
    new Paragraph({
      text: "",
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Petunjuk Essay Diperiksa Otomatis:",
          bold: true,
          italics: true,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Soal essay tanpa baris Kunci tetap menunggu koreksi guru seperti biasa. Tambahkan baris Kunci di bawah soal jika ingin jawabannya diperiksa otomatis.",
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Baris pelengkap yang bisa dipakai: Alternatif (jawaban lain yang juga benar, pisahkan dengan titik koma — bukan koma, karena koma dipakai sebagai tanda desimal), Mode (angka / teks / kata kunci), Toleransi (selisih yang masih diterima), Satuan (satuan yang wajib ditulis siswa), dan Jika salah (isi 'salah' agar jawaban tak cocok langsung dianggap salah; kosongkan agar dikirim ke koreksi guru).",
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Untuk kunci berupa angka, siswa boleh menjawab dalam bentuk apa pun yang senilai: 3/4, 0,75, 75%, atau $\\frac{3}{4}$ — semuanya dianggap benar.",
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Pengaturan lanjutan (wajib bentuk paling sederhana, toleransi salah ketik, jawaban setengah benar) hanya tersedia di editor soal dan tidak ikut tertulis di file Word ini.",
        }),
      ],
    }),
    new Paragraph({
      text: "",
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Tentang baris ID:",
          bold: true,
          italics: true,
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Pada file hasil ekspor soal, tiap soal punya baris ID berwarna abu-abu. Baris itu penanda agar soal menempel kembali ke soal yang sama ketika file diimpor ulang, sehingga jawaban siswa yang sudah mengerjakan tetap terbaca di halaman hasil. Jangan diubah atau dihapus. Untuk soal yang benar-benar baru, biarkan tanpa baris ID.",
        }),
      ],
    }),
    new Paragraph({
      children: [new PageBreak()],
    }),
  ];
  let lastPassageId = null;

  for (let idx = 0; idx < questions.length; idx++) {
    const q = questions[idx];
    
    if (q.passageId && q.passageId !== lastPassageId) {
      children.push(new Paragraph({
        children: [
          new TextRun({
            text: `[GRUP SOAL: ${q.passageTitle || "Wacana"}]`,
            bold: true,
          })
        ]
      }));
      
      const passageElements = await convertHtmlToDocxElements(q.passageContent || "", editorTempImages);
      children.push(...passageElements);
      children.push(new Paragraph({ text: "" }));
      lastPassageId = q.passageId;
    } else if (!q.passageId) {
      if (lastPassageId !== null) {
        children.push(new Paragraph({
          children: [
            new TextRun({
              text: "[TANPA GRUP SOAL]",
              bold: true,
            })
          ]
        }));
        children.push(new Paragraph({ text: "" }));
      }
      lastPassageId = null;
    }
    
    const qElements = await convertHtmlToDocxElements(q.content, editorTempImages, true, idx + 1);
    children.push(...qElements);

    // Jejak identitas soal, dibaca lagi saat dokumen ini diimpor balik. Tanpa
    // ini soal hasil impor dianggap baru dan dapat ID Firestore baru, sehingga
    // submissions.answersByQuestionId (yang berkunci ID soal) kehilangan tautan
    // dan jawaban siswa jadi tidak tampil di halaman hasil.
    if (q.id && !String(q.id).startsWith("temp_")) {
      children.push(new Paragraph({
        children: [
          new TextRun({
            text: `ID: ${q.id}`,
            size: 16,
            color: "999999",
          })
        ]
      }));
    }

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
    } else if (q.type === "essay") {
      // Hanya essay yang dinilai otomatis yang punya baris kunci.
      essayKeyToDocxLines(q).forEach((line) => {
        children.push(new Paragraph({ text: line }));
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
