import { test, expect } from '@playwright/test';
import {
  matchEssayKeyLine,
  buildEssayKeyFromDocx,
  essayKeyToDocxLines,
} from '../js/essayKeyDocx.js';
import { matchAnswer } from '../js/answerMatcher.js';

/** Tiruan alur impor: baris dokumen → kunci essay. */
const fromLines = (lines) => {
  const collected = {};
  for (const line of lines) {
    if (line.toLowerCase().startsWith('kunci:')) {
      collected.kunci = line.substring(line.indexOf(':') + 1).trim();
      continue;
    }
    const matched = matchEssayKeyLine(line);
    if (matched) {
      collected[matched.field] = matched.value;
    }
  }
  return buildEssayKeyFromDocx(collected);
};

test.describe('essayKeyDocx — membaca baris kunci dari dokumen', () => {
  test('label yang dikenali dan yang bukan', () => {
    expect(matchEssayKeyLine('Alternatif: 0,75; 75%')).toEqual({
      field: 'alternatif',
      value: '0,75; 75%',
    });
    expect(matchEssayKeyLine('Mode: angka')).toEqual({ field: 'mode', value: 'angka' });
    expect(matchEssayKeyLine('toleransi : 0,01')).toEqual({ field: 'toleransi', value: '0,01' });
    expect(matchEssayKeyLine('Jika salah: salah')).toEqual({ field: 'jikaSalah', value: 'salah' });
    // Baris soal biasa tidak boleh ikut tertelan.
    expect(matchEssayKeyLine('A. Pilihan pertama')).toBeNull();
    expect(matchEssayKeyLine('Pasangan: Indonesia = Jakarta')).toBeNull();
    expect(matchEssayKeyLine('Berapa hasilnya')).toBeNull();
  });

  test('essay tanpa baris Kunci tetap menunggu koreksi guru', () => {
    expect(fromLines(['Tipe: essay'])).toEqual({
      autoGrade: false,
      answerKey: null,
      onMismatch: 'manual',
    });
    // Baris pelengkap tanpa kunci pun tidak menyalakan pemeriksaan otomatis.
    expect(fromLines(['Mode: angka', 'Toleransi: 0,01']).autoGrade).toBe(false);
  });

  test('kunci angka beserta alternatif dan toleransi', () => {
    const key = fromLines([
      'Kunci: 3/4',
      'Alternatif: 0,75; 75%',
      'Mode: angka',
      'Toleransi: 0,01',
      'Satuan: cm',
    ]);
    expect(key).toMatchObject({
      autoGrade: true,
      onMismatch: 'manual',
      answerKey: {
        mode: 'numeric',
        accepted: ['3/4', '0,75', '75%'],
        tolerance: 0.01,
        requireUnit: 'cm',
      },
    });
  });

  test('kunci boleh mengandung titik dua, koma tidak memisah alternatif', () => {
    // "3:4" adalah rasio, bukan label baris.
    expect(fromLines(['Kunci: 3:4']).answerKey.accepted).toEqual(['3:4']);
    // Koma adalah tanda desimal, jadi "0,75" tetap satu jawaban utuh.
    expect(fromLines(['Kunci: 0,75']).answerKey.accepted).toEqual(['0,75']);
  });

  test('"Jika salah: salah" membuat jawaban tak cocok langsung salah', () => {
    expect(fromLines(['Kunci: 3/4', 'Jika salah: salah']).onMismatch).toBe('wrong');
    expect(fromLines(['Kunci: 3/4', 'Jika salah: koreksi guru']).onMismatch).toBe('manual');
    expect(fromLines(['Kunci: 3/4']).onMismatch).toBe('manual');
  });

  test('mode ditulis dalam bahasa Indonesia maupun Inggris', () => {
    expect(fromLines(['Kunci: 3/4', 'Mode: angka']).answerKey.mode).toBe('numeric');
    expect(fromLines(['Kunci: Soekarno', 'Mode: teks']).answerKey.mode).toBe('text');
    expect(fromLines(['Kunci: fotosintesis', 'Mode: kata kunci']).answerKey.mode).toBe('keywords');
    // Tanpa baris Mode, mesin menebak sendiri saat menilai.
    expect(fromLines(['Kunci: 3/4']).answerKey.mode).toBe('auto');
  });

  test('kunci hasil impor langsung bisa dipakai menilai', () => {
    const { answerKey } = fromLines(['Kunci: 1/4', 'Mode: angka']);
    expect(matchAnswer(answerKey, '0,25').match).toBe(true);
    expect(matchAnswer(answerKey, '25%').match).toBe(true);
    expect(matchAnswer(answerKey, '1/3').match).toBe(false);
  });
});

test.describe('essayKeyDocx — menulis baris kunci ke dokumen', () => {
  const essay = (extra) => ({ type: 'essay', autoGrade: true, onMismatch: 'manual', ...extra });

  test('hanya essay auto-grade yang punya baris kunci', () => {
    expect(essayKeyToDocxLines(essay({ autoGrade: false, answerKey: { accepted: ['3/4'] } }))).toEqual([]);
    expect(essayKeyToDocxLines(essay({ answerKey: { accepted: [] } }))).toEqual([]);
    expect(essayKeyToDocxLines({ type: 'pg', options: [] })).toEqual([]);
  });

  test('baris ditulis ringkas: yang default tidak ikut', () => {
    expect(essayKeyToDocxLines(essay({ answerKey: { mode: 'auto', accepted: ['3/4'], tolerance: 0 } })))
      .toEqual(['Kunci: 3/4']);
  });

  test('kunci lengkap ditulis utuh', () => {
    const lines = essayKeyToDocxLines(
      essay({
        onMismatch: 'wrong',
        answerKey: {
          mode: 'numeric',
          accepted: ['3/4', '0,75'],
          tolerance: 0.01,
          requireUnit: 'cm',
        },
      })
    );
    expect(lines).toEqual([
      'Kunci: 3/4',
      'Alternatif: 0,75',
      'Mode: angka',
      'Toleransi: 0,01',
      'Satuan: cm',
      'Jika salah: salah',
    ]);
  });

  test('ekspor lalu impor kembali menghasilkan kunci yang sama', () => {
    const question = essay({
      onMismatch: 'wrong',
      answerKey: {
        mode: 'text',
        accepted: ['Soekarno', 'Sukarno', 'Ir. Soekarno'],
        tolerance: 0,
        requireSimplified: false,
        requireUnit: '',
        ignoreCase: true,
        ignorePunctuation: true,
        typoTolerance: 0,
      },
    });

    const restored = fromLines(essayKeyToDocxLines(question));
    expect(restored.autoGrade).toBe(true);
    expect(restored.onMismatch).toBe('wrong');
    expect(restored.answerKey).toEqual(question.answerKey);
  });

  test('perjalanan pulang-pergi untuk kunci angka', () => {
    const question = essay({
      answerKey: {
        mode: 'numeric',
        accepted: ['12', '12,0'],
        tolerance: 0.5,
        requireSimplified: false,
        requireUnit: 'cm',
        ignoreCase: true,
        ignorePunctuation: true,
        typoTolerance: 0,
      },
    });

    const restored = fromLines(essayKeyToDocxLines(question));
    expect(restored.answerKey).toEqual(question.answerKey);
    expect(matchAnswer(restored.answerKey, '12,4 cm').match).toBe(true);
  });
});
