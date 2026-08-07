/**
 * answerMatcher.js — Mesin pencocokan jawaban isian singkat (essay auto-grade).
 *
 * Modul murni: tanpa DOM, tanpa Firestore. Semua fungsi bisa diuji terpisah.
 *
 * Prinsip: jangan memaksa siswa menulis format tertentu. Apa pun yang mereka
 * tulis (3/4, 0,75, 75%, ¾, \frac{3}{4}, 6/8) dinormalisasi ke satu nilai
 * kanonik berupa bilangan rasional, lalu dibandingkan sebagai angka.
 */

// ---------------------------------------------------------------------------
// Aritmetika rasional (BigInt) — supaya 1/3 vs 0,333... tidak kacau di float
// ---------------------------------------------------------------------------

const bigAbs = (value) => (value < 0n ? -value : value);

const gcdBig = (a, b) => {
  let left = bigAbs(a);
  let right = bigAbs(b);
  while (right) {
    const temp = left % right;
    left = right;
    right = temp;
  }
  return left;
};

/**
 * @param {bigint} n pembilang
 * @param {bigint} d penyebut
 * @param {boolean} exact false jika nilainya hasil hampiran (π, akar irasional)
 */
const rat = (n, d = 1n, exact = true) => {
  if (d === 0n) {
    return null;
  }
  let num = n;
  let den = d;
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const divisor = gcdBig(num, den) || 1n;
  return { n: num / divisor, d: den / divisor, exact };
};

const ratToNumber = (value) => {
  const n = Number(value.n);
  const d = Number(value.d);
  if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) {
    return n / d;
  }
  // Pembilang/penyebut terlalu besar untuk Number: bagi dulu dengan skala.
  const scale = 10n ** 20n;
  return Number((value.n * scale) / value.d) / 1e20;
};

const ratFromNumber = (x, exact = false) => {
  if (!Number.isFinite(x)) {
    return null;
  }
  // 15 digit signifikan sudah jauh di atas kebutuhan soal sekolah.
  const text = x.toPrecision(15);
  const [mantissa, exponent] = text.split(/[eE]/);
  const [intPart, fracPart = ""] = mantissa.replace("-", "").split(".");
  const sign = mantissa.trim().startsWith("-") ? -1n : 1n;
  let num = BigInt(`${intPart}${fracPart}` || "0") * sign;
  let den = 10n ** BigInt(fracPart.length);
  const exp = Number(exponent || 0);
  if (exp > 0) {
    num *= 10n ** BigInt(exp);
  } else if (exp < 0) {
    den *= 10n ** BigInt(-exp);
  }
  return rat(num, den, exact);
};

const ratAdd = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d, a.exact && b.exact);
const ratSub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d, a.exact && b.exact);
const ratMul = (a, b) => rat(a.n * b.n, a.d * b.d, a.exact && b.exact);
const ratDiv = (a, b) => (b.n === 0n ? null : rat(a.n * b.d, a.d * b.n, a.exact && b.exact));

const ratPow = (base, exponent) => {
  if (exponent.d === 1n && bigAbs(exponent.n) < 4096n) {
    const e = exponent.n;
    if (e >= 0n) {
      return rat(base.n ** e, base.d ** e, base.exact && exponent.exact);
    }
    if (base.n === 0n) {
      return null;
    }
    return rat(base.d ** -e, base.n ** -e, base.exact && exponent.exact);
  }
  const result = Math.pow(ratToNumber(base), ratToNumber(exponent));
  return ratFromNumber(result, false);
};

/** Akar bilangan bulat (Newton) — untuk mendeteksi akar yang hasilnya eksak. */
const bigIntSqrt = (value) => {
  if (value < 0n) {
    return null;
  }
  if (value < 2n) {
    return value;
  }
  let guess = value;
  let next = (guess + 1n) / 2n;
  while (next < guess) {
    guess = next;
    next = (guess + value / guess) / 2n;
  }
  return guess;
};

const ratSqrt = (value) => {
  if (value.n < 0n) {
    return null;
  }
  const rootN = bigIntSqrt(value.n);
  const rootD = bigIntSqrt(value.d);
  if (rootN !== null && rootD !== null && rootN * rootN === value.n && rootD * rootD === value.d) {
    return rat(rootN, rootD, value.exact);
  }
  return ratFromNumber(Math.sqrt(ratToNumber(value)), false);
};

const PI_RAT = rat(314159265358979323846n, 100000000000000000000n, false);

// ---------------------------------------------------------------------------
// Pra-proses: LaTeX, Unicode, satuan, pemisah ribuan
// ---------------------------------------------------------------------------

const VULGAR_FRACTIONS = {
  "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4",
  "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅙": "1/6",
  "⅚": "5/6", "⅐": "1/7", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8",
  "⅞": "7/8", "⅑": "1/9", "⅒": "1/10",
};

const SUPERSCRIPTS = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
};

/** Ambil isi `{...}` yang seimbang mulai dari posisi kurung buka. */
const readBracedGroup = (source, openIndex) => {
  if (source[openIndex] !== "{") {
    return null;
  }
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return { body: source.slice(openIndex + 1, i), end: i + 1 };
      }
    }
  }
  return null;
};

/**
 * Argumen sebuah perintah LaTeX: `{...}`, atau token setelahnya.
 *
 * `single` mengikuti aturan LaTeX asli — `\frac34` berarti 3/4, bukan 34/?.
 * Untuk `\sqrt` kita lebih longgar: `\sqrt16` dibaca √16 karena itu yang
 * dimaksud siswa saat menulis tanpa kurung kurawal.
 */
const readLatexArgument = (source, index, { single = false } = {}) => {
  let i = index;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  const braced = readBracedGroup(source, i);
  if (braced) {
    return braced;
  }
  const pattern = single
    ? /^\d|^[a-zA-Z]/
    : /^-?\d+(?:[.,]\d+)?|^[a-zA-Z]/;
  const match = pattern.exec(source.slice(i));
  if (!match) {
    return null;
  }
  return { body: match[0], end: i + match[0].length };
};

const expandFractions = (source) => {
  let out = source;
  const commands = ["\\dfrac", "\\tfrac", "\\cfrac", "\\frac"];
  for (let guard = 0; guard < 50; guard += 1) {
    let found = false;
    for (const command of commands) {
      const index = out.indexOf(command);
      if (index === -1) continue;
      const first = readLatexArgument(out, index + command.length, { single: true });
      if (!first) continue;
      const second = readLatexArgument(out, first.end, { single: true });
      if (!second) continue;
      out = `${out.slice(0, index)}((${first.body})/(${second.body}))${out.slice(second.end)}`;
      found = true;
      break;
    }
    if (!found) break;
  }
  return out;
};

const expandRoots = (source) => {
  let out = source;
  for (let guard = 0; guard < 50; guard += 1) {
    const index = out.indexOf("\\sqrt");
    if (index === -1) break;
    let cursor = index + "\\sqrt".length;
    let degree = null;
    const degreeMatch = /^\s*\[([^\]]*)\]/.exec(out.slice(cursor));
    if (degreeMatch) {
      degree = degreeMatch[1];
      cursor += degreeMatch[0].length;
    }
    const arg = readLatexArgument(out, cursor);
    if (!arg) break;
    const replacement = degree
      ? `((${arg.body})^(1/(${degree})))`
      : `√(${arg.body})`;
    out = `${out.slice(0, index)}${replacement}${out.slice(arg.end)}`;
  }
  return out;
};

const unwrapCommand = (source, command) => {
  let out = source;
  for (let guard = 0; guard < 50; guard += 1) {
    const index = out.indexOf(command);
    if (index === -1) break;
    const arg = readLatexArgument(out, index + command.length);
    if (!arg) break;
    out = `${out.slice(0, index)}${arg.body}${out.slice(arg.end)}`;
  }
  return out;
};

/**
 * Rapikan satu token angka sesuai konvensi id-ID.
 * "1.000" → 1000, "0,75" → 0.75, "1.234,5" → 1234.5, "1,234,567" → 1234567.
 */
const normalizeNumberToken = (token) => {
  const hasDot = token.includes(".");
  const hasComma = token.includes(",");

  if (hasDot && hasComma) {
    const decimalSep = token.lastIndexOf(".") > token.lastIndexOf(",") ? "." : ",";
    const groupSep = decimalSep === "." ? "," : ".";
    return token.split(groupSep).join("").replace(decimalSep, ".");
  }
  if (hasComma) {
    // Koma ganda = pemisah ribuan gaya Inggris; koma tunggal = desimal (id-ID).
    return (token.match(/,/g) || []).length > 1
      ? token.split(",").join("")
      : token.replace(",", ".");
  }
  if (hasDot) {
    const isThousandGrouped = /^\d{1,3}(\.\d{3})+$/.test(token);
    if (isThousandGrouped || (token.match(/\./g) || []).length > 1) {
      return token.split(".").join("");
    }
  }
  return token;
};

const normalizeNumberTokens = (source) =>
  source.replace(/\d[\d.,]*/g, (token) => normalizeNumberToken(token));

const stripLatexNoise = (source) =>
  source
    .replace(/\$\$?/g, " ")
    .replace(/\\[()[\]]/g, " ")
    .replace(/\\left|\\right/g, " ")
    .replace(/\\[,;!:> ]/g, " ")
    .replace(/\\quad|\\qquad/g, " ");

/** Ubah tulisan apa pun menjadi ekspresi ASCII yang siap di-tokenize. */
const toMathSource = (raw) => {
  let out = String(raw ?? "").trim();
  if (!out) {
    return "";
  }

  out = stripLatexNoise(out);
  out = unwrapCommand(out, "\\text");
  out = unwrapCommand(out, "\\mathrm");
  out = unwrapCommand(out, "\\operatorname");
  // Banyak siswa menulis hasilnya sebagai persamaan: "x = 3/4", "L=12 cm".
  // Ruas kirinya nama besaran, bukan bagian jawaban — buang saja.
  out = out.replace(/^\s*(?:[a-zA-Z][a-zA-Z0-9_\s]*)?=\s*/, "");
  out = expandFractions(out);
  out = expandRoots(out);

  out = out
    .replace(/\\times|\\cdot|×|·|∙/g, "*")
    .replace(/\\div|÷/g, "/")
    .replace(/\\pi/g, "π")
    .replace(/\bpi\b/gi, "π")
    .replace(/\\%/g, "%")
    .replace(/[−–—]/g, "-")
    .replace(/[⁄∕]/g, "/");

  // Rasio "3 : 4" dibaca sebagai pembagian, sama dengan 3/4.
  out = out.replace(/(\d)\s*:\s*(?=\d)/g, "$1/");

  out = out.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒]/g, (char) => ` ${VULGAR_FRACTIONS[char]} `);
  out = out.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (run) =>
    `^${[...run].map((char) => SUPERSCRIPTS[char]).join("")}`
  );

  // Notasi ilmiah harus lebih dulu, sebelum huruf sisa dianggap satuan.
  out = out.replace(/(\d[\d.,]*)\s*[eE]\s*([+-]?\d+)/g, "$1*10^($2)");
  // "x" sebagai tanda kali di antara dua angka.
  out = out.replace(/(\d)\s*[xX]\s*(?=[\d(√π])/g, "$1*");

  return out.replace(/\s+/g, " ").trim();
};

const CURRENCY_PREFIX = /^(rp|idr|usd|us\$|\$|€|£)\s*/i;
const TRAILING_UNIT = /([a-zA-Z°µΩ][a-zA-Z0-9°µΩ./^²³⁻¹\s]*)$/;

/** Pisahkan angka dari satuannya: "12 cm" → { body: "12", unit: "cm" }. */
const splitUnit = (source) => {
  let body = source;
  let unit = "";

  const currency = CURRENCY_PREFIX.exec(body);
  if (currency) {
    unit = currency[1].toLowerCase();
    body = body.slice(currency[0].length);
  }

  const trailing = TRAILING_UNIT.exec(body);
  if (trailing) {
    const candidate = trailing[1].trim();
    // "π" bukan huruf latin, jadi aman; tapi jaga-jaga token murni operator.
    if (candidate && !/^[eE]$/.test(candidate)) {
      unit = unit ? `${unit} ${candidate}` : candidate;
      body = body.slice(0, trailing.index);
    }
  }

  return { body: body.trim(), unit: unit.trim() };
};

const normalizeUnit = (unit) =>
  String(unit || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3");

// ---------------------------------------------------------------------------
// Tokenizer + parser ekspresi (rasional)
// ---------------------------------------------------------------------------

const tokenize = (source) => {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (/\d/.test(char) || (char === "." && /\d/.test(source[i + 1] || ""))) {
      const match = /^\d*\.?\d*/.exec(source.slice(i));
      tokens.push({ type: "number", value: match[0] });
      i += match[0].length;
      continue;
    }
    if ("+-*/^()%".includes(char)) {
      tokens.push({ type: char });
      i += 1;
      continue;
    }
    if (char === "√" || char === "π") {
      tokens.push({ type: char });
      i += 1;
      continue;
    }
    return null; // karakter tak dikenal → jawaban tidak terbaca
  }
  return tokens;
};

const numberToRat = (text) => {
  if (!text || text === ".") {
    return null;
  }
  const [intPart = "", fracPart = ""] = text.split(".");
  const digits = `${intPart}${fracPart}` || "0";
  if (!/^\d+$/.test(digits)) {
    return null;
  }
  return rat(BigInt(digits), 10n ** BigInt(fracPart.length));
};

/**
 * Grammar:
 *   expr    := term (('+'|'-') term)*
 *   term    := unary (('*'|'/'|implisit) unary)*
 *   unary   := ('-'|'+') unary | power
 *   power   := postfix ('^' unary)?
 *   postfix := primary '%'*
 *   primary := number | '(' expr ')' | '√' unary | 'π'
 */
const parseExpression = (tokens) => {
  let pos = 0;
  let failed = false;

  const peek = () => tokens[pos];
  const fail = () => {
    failed = true;
    return null;
  };

  const parseExpr = () => {
    let left = parseTerm();
    while (!failed && left && (peek()?.type === "+" || peek()?.type === "-")) {
      const op = tokens[pos].type;
      pos += 1;
      const right = parseTerm();
      if (!right) return fail();
      left = op === "+" ? ratAdd(left, right) : ratSub(left, right);
      if (!left) return fail();
    }
    return left;
  };

  const parseTerm = () => {
    let left = parseUnary();
    while (!failed && left) {
      const next = peek();
      if (!next) break;
      if (next.type === "*" || next.type === "/") {
        pos += 1;
        const right = parseUnary();
        if (!right) return fail();
        left = next.type === "*" ? ratMul(left, right) : ratDiv(left, right);
        if (!left) return fail(); // pembagian nol
        continue;
      }
      // Perkalian implisit hanya untuk "(", "√", "π" — bukan antar dua angka,
      // supaya "3 4" tetap dianggap salah tulis, bukan 12.
      if (next.type === "(" || next.type === "√" || next.type === "π") {
        const right = parseUnary();
        if (!right) return fail();
        left = ratMul(left, right);
        continue;
      }
      break;
    }
    return left;
  };

  const parseUnary = () => {
    const next = peek();
    if (!next) return fail();
    if (next.type === "-" || next.type === "+") {
      pos += 1;
      const value = parseUnary();
      if (!value) return fail();
      return next.type === "-" ? rat(-value.n, value.d, value.exact) : value;
    }
    return parsePower();
  };

  const parsePower = () => {
    const base = parsePostfix();
    if (!base || failed) return base;
    if (peek()?.type === "^") {
      pos += 1;
      const exponent = parseUnary();
      if (!exponent) return fail();
      const result = ratPow(base, exponent);
      if (!result) return fail();
      return result;
    }
    return base;
  };

  const parsePostfix = () => {
    let value = parsePrimary();
    while (!failed && value && peek()?.type === "%") {
      pos += 1;
      value = ratDiv(value, rat(100n));
      if (!value) return fail();
    }
    return value;
  };

  const parsePrimary = () => {
    const next = peek();
    if (!next) return fail();
    if (next.type === "number") {
      pos += 1;
      const value = numberToRat(next.value);
      return value || fail();
    }
    if (next.type === "(") {
      pos += 1;
      const value = parseExpr();
      if (!value || peek()?.type !== ")") return fail();
      pos += 1;
      return value;
    }
    if (next.type === "√") {
      pos += 1;
      const operand = parseUnary();
      if (!operand) return fail();
      const value = ratSqrt(operand);
      return value || fail();
    }
    if (next.type === "π") {
      pos += 1;
      return PI_RAT;
    }
    return fail();
  };

  const result = parseExpr();
  if (failed || !result || pos !== tokens.length) {
    return null;
  }
  return result;
};

// ---------------------------------------------------------------------------
// API numerik
// ---------------------------------------------------------------------------

const formatDecimal = (value) => {
  const decimal = ratToNumber(value);
  if (!Number.isFinite(decimal)) {
    return "";
  }
  return String(Number(decimal.toFixed(6)));
};

/**
 * Baca jawaban bebas menjadi nilai numerik kanonik.
 * @returns {{value: object, unit: string, written: object|null, readAs: string,
 *            readAsLatex: string, readAsDecimal: string}|null}
 */
export const parseNumeric = (raw) => {
  const source = toMathSource(raw);
  if (!source) {
    return null;
  }

  const { body, unit } = splitUnit(source);
  if (!body) {
    return null;
  }

  let prepared = normalizeNumberTokens(body);
  // Pecahan campuran: "1 3/4" → "(1+3/4)".
  prepared = prepared.replace(
    /(?<![\d.])(\d+)\s+(\d+)\s*\/\s*(\d+)/g,
    "($1+$2/$3)"
  );

  // Bentuk pecahan apa adanya (sebelum disederhanakan), untuk requireSimplified.
  const writtenMatch = /^\s*(-?\d+)\s*\/\s*(\d+)\s*$/.exec(prepared);
  const written = writtenMatch
    ? { n: BigInt(writtenMatch[1]), d: BigInt(writtenMatch[2]) }
    : null;

  const tokens = tokenize(prepared);
  if (!tokens || tokens.length === 0) {
    return null;
  }
  const value = parseExpression(tokens);
  if (!value) {
    return null;
  }

  const readAs = value.d === 1n ? String(value.n) : `${value.n}/${value.d}`;
  const readAsLatex =
    value.d === 1n
      ? String(value.n)
      : `\\frac{${value.n}}{${value.d}}`;

  return {
    value,
    unit,
    written,
    readAs: unit ? `${readAs} ${unit}` : readAs,
    readAsLatex: unit ? `${readAsLatex}\\ \\text{${unit}}` : readAsLatex,
    readAsDecimal: formatDecimal(value),
  };
};

const numericEquals = (a, b, tolerance = 0) => {
  const tol = Number(tolerance) || 0;
  if (tol > 0) {
    return Math.abs(ratToNumber(a) - ratToNumber(b)) <= tol + 1e-12;
  }
  if (a.exact && b.exact) {
    return a.n * b.d === b.n * a.d;
  }
  // Salah satu hampiran (π, akar irasional): pakai toleransi relatif kecil.
  const left = ratToNumber(a);
  const right = ratToNumber(b);
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= scale * 1e-9;
};

const isSimplified = (written) =>
  !written || gcdBig(bigAbs(written.n), written.d) === 1n;

// ---------------------------------------------------------------------------
// API teks
// ---------------------------------------------------------------------------

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;

/** Normalisasi teks: spasi, huruf besar/kecil, tanda baca, diakritik, Arab. */
export const normalizeText = (raw, options = {}) => {
  const {
    ignoreCase = true,
    ignorePunctuation = true,
  } = options;

  let out = String(raw ?? "").normalize("NFC").trim();
  if (!out) {
    return "";
  }

  out = out
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىی]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ـ/g, ""); // tatweel

  // Buang diakritik latin (é → e) tanpa merusak aksara non-latin.
  out = out.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");

  out = out.replace(/[‘’‚‛]/g, "'").replace(/[“”„]/g, '"');

  if (ignorePunctuation) {
    out = out.replace(/[.,;:!?'"()[\]{}\-–—_/\\]/g, " ");
  }
  if (ignoreCase) {
    out = out.toLowerCase();
  }

  return out.replace(/\s+/g, " ").trim();
};

const levenshtein = (a, b) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous = current;
  }
  return previous[b.length];
};

// ---------------------------------------------------------------------------
// Pencocokan
// ---------------------------------------------------------------------------

const toAcceptedList = (accepted) => {
  if (Array.isArray(accepted)) {
    return accepted.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  const single = String(accepted ?? "").trim();
  return single ? [single] : [];
};

/** Tebak mode dari kuncinya kalau admin/impor DOCX tidak menyebut mode. */
export const inferMode = (accepted) => {
  const list = toAcceptedList(accepted);
  if (list.length === 0) {
    return "text";
  }
  return list.every((item) => parseNumeric(item) !== null) ? "numeric" : "text";
};

const matchNumeric = (list, rawAnswer, options) => {
  const parsed = parseNumeric(rawAnswer);
  if (!parsed) {
    return { matched: false, unreadable: true, readAs: "" };
  }

  const readAs = parsed.readAs;
  const requiredUnit = normalizeUnit(options.requireUnit);
  if (requiredUnit && normalizeUnit(parsed.unit) !== requiredUnit) {
    return { matched: false, unreadable: false, readAs, reason: "unit" };
  }
  if (options.requireSimplified && !isSimplified(parsed.written)) {
    return { matched: false, unreadable: false, readAs, reason: "not_simplified" };
  }

  const matched = list.some((item) => {
    const key = parseNumeric(item);
    return key && numericEquals(parsed.value, key.value, options.tolerance);
  });

  return { matched, unreadable: false, readAs };
};

const matchText = (list, rawAnswer, options) => {
  const answer = normalizeText(rawAnswer, options);
  if (!answer) {
    return { matched: false, unreadable: true, readAs: "" };
  }
  const tolerance = Number(options.typoTolerance) || 0;
  const matched = list.some((item) => {
    const key = normalizeText(item, options);
    if (!key) return false;
    if (key === answer) return true;
    // Toleransi typo hanya untuk kata yang cukup panjang, agar "dua" ≠ "tua".
    return tolerance > 0 && key.length > 3 && levenshtein(key, answer) <= tolerance;
  });
  return { matched, unreadable: false, readAs: answer };
};

const matchKeywords = (list, rawAnswer, options) => {
  const answer = normalizeText(rawAnswer, options);
  if (!answer) {
    return { matched: false, unreadable: true, readAs: "", ratio: 0 };
  }
  const hits = list.filter((item) => {
    const keyword = normalizeText(item, options);
    return keyword && answer.includes(keyword);
  }).length;
  const ratio = list.length > 0 ? hits / list.length : 0;
  return { matched: ratio >= 1, unreadable: false, readAs: answer, ratio };
};

const runMatch = (mode, list, rawAnswer, options) => {
  if (mode === "numeric") {
    return matchNumeric(list, rawAnswer, options);
  }
  if (mode === "keywords") {
    return matchKeywords(list, rawAnswer, options);
  }
  return matchText(list, rawAnswer, options);
};

/**
 * Cocokkan jawaban siswa dengan kunci.
 *
 * @param {object} answerKey { mode, accepted, tolerance, requireSimplified,
 *                             requireUnit, ignoreCase, ignorePunctuation,
 *                             typoTolerance, partial: [{accepted, ratio}] }
 * @param {string} rawAnswer jawaban mentah siswa
 * @returns {{match: boolean, ratio: number, readAs: string, unreadable: boolean,
 *            reason: string, hasKey: boolean}}
 */
export const matchAnswer = (answerKey, rawAnswer) => {
  const key = answerKey || {};
  const list = toAcceptedList(key.accepted);
  const empty = { match: false, ratio: 0, readAs: "", unreadable: false, reason: "", hasKey: false };

  if (list.length === 0) {
    return empty;
  }
  if (!String(rawAnswer ?? "").trim()) {
    return { ...empty, hasKey: true, unreadable: true, reason: "empty" };
  }

  const mode = key.mode === "auto" || !key.mode ? inferMode(list) : key.mode;
  const options = {
    tolerance: key.tolerance,
    requireSimplified: Boolean(key.requireSimplified),
    requireUnit: key.requireUnit || "",
    ignoreCase: key.ignoreCase !== false,
    ignorePunctuation: key.ignorePunctuation !== false,
    typoTolerance: key.typoTolerance,
  };

  const primary = runMatch(mode, list, rawAnswer, options);
  if (primary.matched) {
    return {
      match: true,
      ratio: 1,
      readAs: primary.readAs,
      unreadable: false,
      reason: "",
      hasKey: true,
    };
  }

  // Nilai sebagian: keywords memberi rasio sendiri, mode lain lewat key.partial.
  let ratio = mode === "keywords" ? primary.ratio || 0 : 0;
  let reason = primary.reason || "";

  for (const entry of key.partial || []) {
    const entryList = toAcceptedList(entry?.accepted);
    if (entryList.length === 0) continue;
    const result = runMatch(mode, entryList, rawAnswer, options);
    if (result.matched) {
      const entryRatio = Math.min(1, Math.max(0, Number(entry.ratio) || 0));
      if (entryRatio > ratio) {
        ratio = entryRatio;
        reason = "partial";
      }
    }
  }

  return {
    match: ratio >= 1,
    ratio,
    readAs: primary.readAs,
    unreadable: Boolean(primary.unreadable),
    reason,
    hasKey: true,
  };
};

/**
 * Bantu pratinjau di layar siswa/admin: "yang kamu tulis terbaca sebagai ...".
 * @returns {{ok: boolean, readAs: string, readAsLatex: string, readAsDecimal: string}}
 */
export const describeAnswer = (rawAnswer, mode = "numeric", options = {}) => {
  if (mode === "numeric") {
    const parsed = parseNumeric(rawAnswer);
    if (!parsed) {
      return { ok: false, readAs: "", readAsLatex: "", readAsDecimal: "" };
    }
    return {
      ok: true,
      readAs: parsed.readAs,
      readAsLatex: parsed.readAsLatex,
      readAsDecimal: parsed.readAsDecimal,
    };
  }
  const normalized = normalizeText(rawAnswer, options);
  return {
    ok: Boolean(normalized),
    readAs: normalized,
    readAsLatex: normalized,
    readAsDecimal: "",
  };
};
