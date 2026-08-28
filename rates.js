const RATE_KEYS = [
  'USD_SWIFT', 'USD_IDUBID',
  'JPY_INTERNAL', 'JPY_SWIFT', 'JPY_CASH', 'JPY_QR',
  'CNY', 'KRW', 'THB', 'AED'
];

function normalizeOcr(text) {
  return String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[，]/g, ',')
    .replace(/[：]/g, ':')
    .replace(/[–—]/g, '-')
    .replace(/[Оо]/g, '0')
    .replace(/[Зз]/g, '3')
    .replace(/[Аа]/g, 'A')
    .replace(/[ІіLl]/g, '1')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function round6(value) { return Number(Number(value).toFixed(6)); }
function valid(value, max = 100000) { return Number.isFinite(value) && value > 0 && value < max; }

function valuesAfterEquals(text) {
  const normalized = normalizeOcr(text).replace(/,/g, '.');
  return [...normalized.matchAll(/=\s*(\d+(?:\.\d+)?)/g)]
    .map(m => Number(m[1]))
    .filter(n => valid(n, 10000));
}

function matchNumber(text, regex, max = 10000) {
  const m = normalizeOcr(text).replace(/,/g, '.').match(regex);
  if (!m) return null;
  const n = Number(m[1]);
  return valid(n, max) ? n : null;
}

function parseRates(_regions = {}, rawText = '') {
  const text = normalizeOcr(rawText).replace(/,/g, '.');
  const result = {};

  // Label-aware extraction when OCR preserved the label.
  const krw = matchNumber(text, /1000\s*KRW\s*=\s*(\d+(?:\.\d+)?)/i, 1000);
  if (krw != null) result.KRW = round6(krw / 1000);

  const aed = matchNumber(text, /1\s*A[EЕ]D\s*=\s*(\d+(?:\.\d+)?)/i, 1000);
  if (aed != null) result.AED = round6(aed);

  const thb = matchNumber(text, /1\s*THB\s*=\s*(\d+(?:\.\d+)?)/i, 100);
  if (thb != null) result.THB = round6(thb);

  const cny = matchNumber(text, /1\s*(?:CNY|VON)\s*=\s*(\d+(?:\.\d+)?)/i, 100);
  if (cny != null) result.CNY = round6(cny);

  const usd = [...text.matchAll(/(?:1\s*)?USD\s*=\s*(\d+(?:\.\d+)?)/gi)]
    .map(m => Number(m[1])).filter(n => valid(n, 1000));
  if (usd[0] != null) result.USD_SWIFT = round6(usd[0]);
  if (usd[1] != null) result.USD_IDUBID = round6(usd[1]);

  const jpy = [...text.matchAll(/100\s*JPY\s*=\s*(\d+(?:\.\d+)?)/gi)]
    .map(m => Number(m[1])).filter(n => valid(n, 1000));
  if (jpy[0] != null) result.JPY_INTERNAL = round6(jpy[0] / 100);
  if (jpy[1] != null) result.JPY_SWIFT = round6(jpy[1] / 100);

  // Fixed layout fallback. It is intentionally based on the values after "=";
  // Tesseract commonly damages the left-hand currency label but keeps the number.
  const eq = valuesAfterEquals(text);
  if (eq.length >= 10) {
    result.KRW = round6(eq[0] / 1000);
    result.AED = round6(eq[1]);
    result.USD_SWIFT = round6(eq[2]);
    result.JPY_INTERNAL = round6(eq[3] / 100);
    result.JPY_SWIFT = round6(eq[4] / 100);
    result.CNY = round6(eq[5]);
    result.THB = round6(eq[6]);
    result.USD_IDUBID = round6(eq[7]);
    result.JPY_CASH = round6(eq[8] / 100);
    result.JPY_QR = round6(eq[9] / 100);
  } else {
    const looseJpy = [...text.matchAll(/JPY\s*=\s*(\d+(?:\.\d+)?)/gi)]
      .map(m => Number(m[1])).filter(n => valid(n, 1000));
    if (result.JPY_CASH == null && looseJpy[0] != null) result.JPY_CASH = round6(looseJpy[0] / 100);
    if (result.JPY_QR == null && looseJpy[1] != null) result.JPY_QR = round6(looseJpy[1] / 100);
  }

  if (result.JPY_CASH != null) result.JPY_AFA_CASH = result.JPY_CASH;
  if (result.JPY_QR != null) result.JPY_AFA_QR = result.JPY_QR;
  if (result.USD_SWIFT != null) result.USD = result.USD_SWIFT;
  return result;
}

function hasCoreRates(rates) { return RATE_KEYS.every(key => Number.isFinite(rates[key])); }
module.exports = { RATE_KEYS, parseRates, hasCoreRates, normalizeOcr };
