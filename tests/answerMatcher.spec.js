import { test, expect } from '@playwright/test';
import {
  parseNumeric,
  normalizeText,
  matchAnswer,
  inferMode,
  describeAnswer,
} from '../js/answerMatcher.js';
import { scoreQuestion, calculateScore } from '../js/scoring.js';

const readAs = (raw) => parseNumeric(raw)?.readAs ?? null;

test.describe('parseNumeric — normalisasi bentuk jawaban', () => {
  test('pecahan biasa, spasi, dan LaTeX dibaca sama', () => {
    const forms = [
      '3/4',
      '3 / 4',
      ' 3/4 ',
      '\\frac{3}{4}',
      '\\dfrac{3}{4}',
      '\\tfrac{3}{4}',
      '\\frac34',
      '\\frac{3}4',
      '$\\frac{3}{4}$',
      '$$\\frac{3}{4}$$',
      '\\(\\frac{3}{4}\\)',
      '\\left(\\frac{3}{4}\\right)',
      '¾',
      '0,75',
      '0.75',
      '.75',
      '75%',
      '6/8',
      '75/100',
      '3÷4',
      '3:4',
      '1/2+1/4',
      '\\frac{1}{2}+\\frac{1}{4}',
    ];
    for (const form of forms) {
      expect.soft(readAs(form), `bentuk: ${form}`).toBe('3/4');
    }
  });

  test('pecahan campuran', () => {
    expect(readAs('1 1/2')).toBe('3/2');
    expect(readAs('1½')).toBe('3/2');
    expect(readAs('2 3/4')).toBe('11/4');
    expect(readAs('1 1/2 cm')).toBe('3/2 cm');
  });

  test('desimal dan pemisah ribuan gaya Indonesia', () => {
    expect(readAs('1.000')).toBe('1000');
    expect(readAs('1.000.000')).toBe('1000000');
    expect(readAs('1.234,5')).toBe('2469/2');
    expect(readAs('1,234')).toBe('617/500'); // 1,234 = 1.234 (id-ID)
    expect(readAs('1,234,567')).toBe('1234567');
    expect(readAs('2,5')).toBe('5/2');
  });

  test('persen, negatif, dan nol', () => {
    expect(readAs('50%')).toBe('1/2');
    expect(readAs('100%')).toBe('1');
    expect(readAs('-3/4')).toBe('-3/4');
    expect(readAs('- 3 / 4')).toBe('-3/4');
    expect(readAs('−0,5')).toBe('-1/2'); // minus Unicode
    expect(readAs('0')).toBe('0');
  });

  test('pangkat, notasi ilmiah, akar, dan pi', () => {
    expect(readAs('2^3')).toBe('8');
    expect(readAs('2³')).toBe('8');
    expect(readAs('10^-2')).toBe('1/100');
    expect(readAs('1,5 x 10^3')).toBe('1500');
    expect(readAs('1,5e3')).toBe('1500');
    expect(readAs('1.5E-2')).toBe('3/200');
    expect(readAs('√9')).toBe('3');
    expect(readAs('\\sqrt{9}')).toBe('3');
    expect(readAs('\\sqrt[3]{8}')).toBe('2');
    expect(parseNumeric('π').readAsDecimal).toBe('3.141593');
    expect(parseNumeric('2\\pi').readAsDecimal).toBe('6.283185');
  });

  test('satuan dipisahkan dari angkanya', () => {
    expect(parseNumeric('12 cm')).toMatchObject({ readAs: '12 cm', unit: 'cm' });
    expect(parseNumeric('12cm')).toMatchObject({ unit: 'cm' });
    expect(parseNumeric('12 m/s')).toMatchObject({ unit: 'm/s' });
    expect(parseNumeric('Rp12.000')).toMatchObject({ readAs: '12000 rp' });
    // Pangkat pada satuan dikanonkan: cm² dan cm^2 dianggap satuan yang sama.
    expect(parseNumeric('12 cm²')).toMatchObject({ unit: 'cm^2' });
    expect(
      matchAnswer({ mode: 'numeric', accepted: ['12'], requireUnit: 'cm²' }, '12 cm^2').match
    ).toBe(true);
  });

  test('jawaban ditulis sebagai persamaan', () => {
    // Siswa sering menulis hasil beserta nama besarannya; itu tetap jawaban.
    expect(readAs('x = 3/4')).toBe('3/4');
    expect(readAs('n=5')).toBe('5');
    expect(readAs('= 0,75')).toBe('3/4');
    expect(parseNumeric('L = 12 cm')).toMatchObject({ readAs: '12 cm', unit: 'cm' });
    expect(readAs('$x = \\frac{3}{4}$')).toBe('3/4');
    // "3=4" bukan penamaan besaran, jadi tetap ditolak.
    expect(parseNumeric('3=4')).toBeNull();
  });

  test('input rusak ditolak, bukan ditebak', () => {
    const broken = ['', '   ', 'abc', '3//4', '4/0', '3/', '/4', '(3/4', '3 4', '???', '\\frac{}{}'];
    for (const form of broken) {
      expect.soft(parseNumeric(form), `bentuk: ${form}`).toBeNull();
    }
  });

  test('jawaban sangat panjang tidak menggantung', () => {
    const started = Date.now();
    expect(parseNumeric('9'.repeat(400))).not.toBeNull();
    expect(parseNumeric('a'.repeat(5000))).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

test.describe('matchAnswer — mode numeric', () => {
  const key = { mode: 'numeric', accepted: ['3/4'] };

  test('semua bentuk setara dianggap benar', () => {
    for (const answer of ['3/4', '0,75', '75%', '¾', '\\frac{3}{4}', '6/8', ' 0.75 ']) {
      expect.soft(matchAnswer(key, answer).match, `jawaban: ${answer}`).toBe(true);
    }
  });

  test('jawaban salah tetap salah', () => {
    for (const answer of ['4/3', '0,7', '3/5', '7,5']) {
      expect.soft(matchAnswer(key, answer).match, `jawaban: ${answer}`).toBe(false);
    }
  });

  test('jawaban tak terbaca ditandai unreadable', () => {
    const result = matchAnswer(key, 'tiga per empat');
    expect(result.match).toBe(false);
    expect(result.unreadable).toBe(true);
  });

  test('jawaban kosong tidak dianggap salah ketik', () => {
    expect(matchAnswer(key, '   ')).toMatchObject({ match: false, reason: 'empty', hasKey: true });
  });

  test('alternatif jawaban', () => {
    const multi = { mode: 'numeric', accepted: ['3/4', '0,8'] };
    expect(matchAnswer(multi, '80%').match).toBe(true);
    expect(matchAnswer(multi, '75%').match).toBe(true);
  });

  test('toleransi desimal', () => {
    const approx = { mode: 'numeric', accepted: ['3,14'], tolerance: 0.01 };
    expect(matchAnswer(approx, '3,14159').match).toBe(true);
    expect(matchAnswer(approx, 'π').match).toBe(true);
    expect(matchAnswer(approx, '3,2').match).toBe(false);
  });

  test('1/3 vs 0,333 hanya benar bila diberi toleransi', () => {
    expect(matchAnswer({ mode: 'numeric', accepted: ['1/3'] }, '0,333').match).toBe(false);
    expect(
      matchAnswer({ mode: 'numeric', accepted: ['1/3'], tolerance: 0.001 }, '0,333').match
    ).toBe(true);
  });

  test('requireSimplified menolak pecahan yang belum sederhana', () => {
    const strict = { mode: 'numeric', accepted: ['3/4'], requireSimplified: true };
    expect(matchAnswer(strict, '3/4').match).toBe(true);
    expect(matchAnswer(strict, '6/8')).toMatchObject({ match: false, reason: 'not_simplified' });
    expect(matchAnswer(strict, '0,75').match).toBe(true); // desimal bukan pecahan
  });

  test('requireUnit mewajibkan satuan benar', () => {
    const withUnit = { mode: 'numeric', accepted: ['12'], requireUnit: 'cm' };
    expect(matchAnswer(withUnit, '12 cm').match).toBe(true);
    expect(matchAnswer(withUnit, '12cm').match).toBe(true);
    expect(matchAnswer(withUnit, '12')).toMatchObject({ match: false, reason: 'unit' });
    expect(matchAnswer(withUnit, '12 m')).toMatchObject({ match: false, reason: 'unit' });
  });

  test('tanpa requireUnit, satuan diabaikan', () => {
    expect(matchAnswer({ mode: 'numeric', accepted: ['12'] }, '12 cm').match).toBe(true);
  });
});

test.describe('matchAnswer — mode text & keywords', () => {
  test('huruf besar/kecil, spasi, dan tanda baca diabaikan', () => {
    const key = { mode: 'text', accepted: ['Ir. Soekarno'] };
    for (const answer of ['ir. soekarno', 'IR SOEKARNO', '  Ir.   Soekarno  ', 'Ir, Soekarno']) {
      expect.soft(matchAnswer(key, answer).match, `jawaban: ${answer}`).toBe(true);
    }
    expect(matchAnswer(key, 'Soeharto').match).toBe(false);
  });

  test('toleransi typo hanya jika diaktifkan', () => {
    const key = { mode: 'text', accepted: ['fotosintesis'] };
    expect(matchAnswer(key, 'fotosintesa').match).toBe(false);
    expect(matchAnswer({ ...key, typoTolerance: 1 }, 'fotosintess').match).toBe(true);
    expect(matchAnswer({ ...key, typoTolerance: 1 }, 'respirasi').match).toBe(false);
  });

  test('teks Arab: harakat dan varian alif dinormalisasi', () => {
    const key = { mode: 'text', accepted: ['الحمد لله'] };
    expect(matchAnswer(key, 'الْحَمْدُ لِلَّهِ').match).toBe(true);
    expect(matchAnswer(key, 'السلام').match).toBe(false);
  });

  test('diakritik latin diabaikan', () => {
    expect(normalizeText('Café')).toBe('cafe');
  });

  test('keywords memberi nilai sebagian', () => {
    const key = { mode: 'keywords', accepted: ['klorofil', 'cahaya', 'air'] };
    expect(matchAnswer(key, 'butuh klorofil, cahaya, dan air').match).toBe(true);
    expect(matchAnswer(key, 'butuh klorofil dan cahaya').ratio).toBeCloseTo(2 / 3);
    expect(matchAnswer(key, 'tidak tahu').ratio).toBe(0);
  });

  test('partial memberi rasio yang ditentukan guru', () => {
    const key = {
      mode: 'numeric',
      accepted: ['3/4'],
      partial: [{ accepted: ['0,7'], ratio: 0.5 }],
    };
    expect(matchAnswer(key, '0,7')).toMatchObject({ match: false, ratio: 0.5, reason: 'partial' });
  });
});

test.describe('inferMode & describeAnswer', () => {
  test('mode ditebak dari bentuk kuncinya', () => {
    expect(inferMode(['3/4', '0,75'])).toBe('numeric');
    expect(inferMode(['Soekarno'])).toBe('text');
    expect(inferMode([])).toBe('text');
  });

  test('pratinjau untuk siswa', () => {
    expect(describeAnswer('0,75')).toMatchObject({
      ok: true,
      readAs: '3/4',
      readAsLatex: '\\frac{3}{4}',
      readAsDecimal: '0.75',
    });
    expect(describeAnswer('abc')).toMatchObject({ ok: false });
    expect(describeAnswer('Ir. Soekarno', 'text')).toMatchObject({ ok: true, readAs: 'ir soekarno' });
  });
});

test.describe('scoring — integrasi essay auto-grade', () => {
  const autoQuestion = {
    id: 'q1',
    type: 'essay',
    scoreWeight: 10,
    autoGrade: true,
    answerKey: { mode: 'numeric', accepted: ['3/4'] },
  };

  test('essay lama tanpa kunci tetap manual', () => {
    expect(scoreQuestion({ id: 'q0', type: 'essay' }, 'apa saja', 10)).toEqual({
      score: 0,
      status: 'manual',
    });
    expect(
      scoreQuestion({ id: 'q0', type: 'essay', answerKey: { accepted: ['3/4'] } }, '3/4', 10)
    ).toEqual({ score: 0, status: 'manual' }); // autoGrade mati
  });

  test('jawaban benar dinilai penuh dan ditandai otomatis', () => {
    expect(scoreQuestion(autoQuestion, '0,75', 10)).toMatchObject({
      score: 10,
      status: 'correct',
      autoGraded: true,
      readAs: '3/4',
    });
  });

  test('jawaban tidak cocok default-nya dilempar ke koreksi guru', () => {
    expect(scoreQuestion(autoQuestion, 'tiga perempat', 10)).toMatchObject({
      score: 0,
      status: 'manual',
    });
  });

  test('onMismatch "wrong" menyalahkan langsung', () => {
    const strict = { ...autoQuestion, onMismatch: 'wrong' };
    expect(scoreQuestion(strict, '4/3', 10)).toMatchObject({
      score: 0,
      status: 'wrong',
      autoGraded: true,
    });
  });

  test('nilai sebagian dihitung dari rasio', () => {
    const partial = {
      ...autoQuestion,
      answerKey: { mode: 'keywords', accepted: ['klorofil', 'cahaya'] },
    };
    expect(scoreQuestion(partial, 'perlu klorofil', 10)).toMatchObject({
      score: 5,
      status: 'partial',
    });
  });

  test('total nilai memperhitungkan essay otomatis', () => {
    const questions = [
      autoQuestion,
      { id: 'q2', type: 'pg', scoreWeight: 10, options: [{ id: 'a', isCorrect: true }] },
    ];
    const result = calculateScore(questions, { q1: '75%', q2: 'a' });
    expect(result.total).toBe(100);
    expect(result.breakdown[0]).toMatchObject({ status: 'correct', autoGraded: true });
  });

  test('breakdown tidak menulis field undefined (aman untuk Firestore)', () => {
    const { breakdown } = calculateScore([{ id: 'q0', type: 'essay', scoreWeight: 10 }], { q0: 'x' });
    expect(Object.values(breakdown[0]).every((value) => value !== undefined)).toBe(true);
    expect(breakdown[0]).not.toHaveProperty('autoGraded');
  });
});
