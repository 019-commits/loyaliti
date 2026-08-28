const RATE_KEYS = [
  'USD_SWIFT', 'USD_IDUBID',
  'JPY_INTERNAL', 'JPY_SWIFT', 'JPY_CASH', 'JPY_QR',
  'CNY', 'KRW', 'THB', 'AED'
];

function cleanNumber(value) {
  let s = String(value ?? '').trim().replace(',', '.');
  s = s.replace(/[^0-9.]/g, '');
  // OCR can produce more than one decimal dot. Keep the first and remove the rest.
  const parts = s.split('.');
  if (parts.length > 2) s = parts.shift() + '.' + parts.join('');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeOcr(text) {
  return String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[，]/g, ',')
    .replace(/[：]/g, ':')
    .replace(/[–—]/g, '-')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function round6(value) { return Number(Number(value).toFixed(6)); }
function valid(value, min = 0, max = 100000) {
  return Number.isFinite(value) && value > min && value < max;
}

// Converts common OCR variants where the decimal point was lost.
// Example: 2360 -> 23.60, 274 -> 2.74, 5690 -> 56.90.
function repairDecimal(raw, kind) {
  const n = cleanNumber(raw);
  if (n == null) return null;

  const ranges = {
    KRW: { min: 1, max: 100 },
    AED: { min: 1, max: 100 },
    USD: { min: 1, max: 200 },
    JPY: { min: 1, max: 100 },
    CNY: { min: 1, max: 50 },
    THB: { min: 0.1, max: 20 }
  };
  const r = ranges[kind];
  if (!r) return n;

  if (n > r.max && n < r.max * 100) {
    const x = n / 100;
    if (x > r.min && x < r.max) return round6(x);
  }
  if (n >= 100 && n < 1000) {
    const x = n / 100;
    if (x > r.min && x < r.max) return round6(x);
  }
  if (n >= 10 && kind === 'THB') {
    // 274 -> 2.74 is especially common for this card.
    const x = n / 100;
    if (x > 0.1 && x < 20) return round6(x);
  }
  return n;
}

function parseRates(_regions = {}, rawText = '') {
  const text = normalizeOcr(rawText).replace(/,/g, '.');
  const result = {};

  const values = [...text.matchAll(/=\s*([0-9OolI.,]{1,12})/g)]
    .map(m => cleanNumber(m[1]))
    .filter(n => n != null);

  // Fixed card order. This is only a fallback; the primary parser uses the
  // image coordinates in ocr.js so damaged labels cannot shift the fields.
  if (values.length >= 10) {
    result.KRW = Number((repairDecimal(values[0], 'KRW') / 1000).toFixed(6));
    result.AED = repairDecimal(values[1], 'AED');
    result.USD_SWIFT = repairDecimal(values[2], 'USD');
    result.JPY_INTERNAL = repairDecimal(values[3], 'JPY') / 100;
    result.JPY_SWIFT = repairDecimal(values[4], 'JPY') / 100;
    result.CNY = repairDecimal(values[5], 'CNY');
    result.THB = repairDecimal(values[6], 'THB');
    result.USD_IDUBID = repairDecimal(values[7], 'USD');
    result.JPY_CASH = repairDecimal(values[8], 'JPY') / 100;
    result.JPY_QR = repairDecimal(values[9], 'JPY') / 100;
  }

  if (result.JPY_CASH != null) result.JPY_AFA_CASH = result.JPY_CASH;
  if (result.JPY_QR != null) result.JPY_AFA_QR = result.JPY_QR;
  if (result.USD_SWIFT != null) result.USD = result.USD_SWIFT;
  return result;
}

function hasCoreRates(rates) {
  return RATE_KEYS.every(key => Number.isFinite(rates[key])) &&
    rates.KRW > 0 && rates.KRW < 0.2 &&
    rates.AED > 1 && rates.AED < 100 &&
    rates.USD_SWIFT > 1 && rates.USD_SWIFT < 200 &&
    rates.USD_IDUBID > 1 && rates.USD_IDUBID < 200 &&
    rates.JPY_INTERNAL > 0.01 && rates.JPY_INTERNAL < 1 &&
    rates.JPY_SWIFT > 0.01 && rates.JPY_SWIFT < 1 &&
    rates.JPY_CASH > 0.01 && rates.JPY_CASH < 1 &&
    rates.JPY_QR > 0.01 && rates.JPY_QR < 1 &&
    rates.CNY > 1 && rates.CNY < 50 &&
    rates.THB > 0.1 && rates.THB < 20;
}

module.exports = { RATE_KEYS, parseRates, hasCoreRates, normalizeOcr, cleanNumber, repairDecimal };
