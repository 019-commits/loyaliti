const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const { parseRates, hasCoreRates, cleanNumber, repairDecimal } = require('./rates');

const execFileAsync = promisify(execFile);

// Coordinates are percentages of the 957x1280 Loyalty Swift rate-card.
// We crop ONLY the numeric value, not the country/logo/text. This is much more
// reliable than asking OCR to understand the entire graphic.
const VALUE_REGIONS = {
  KRW:         [0.318, 0.285, 0.102, 0.050],
  AED:         [0.763, 0.277, 0.110, 0.055],
  USD_SWIFT:   [0.772, 0.398, 0.105, 0.052],
  JPY_INTERNAL:[0.291, 0.420, 0.105, 0.050],
  JPY_SWIFT:   [0.291, 0.562, 0.105, 0.050],
  CNY:         [0.768, 0.543, 0.105, 0.050],
  THB:         [0.256, 0.688, 0.084, 0.047],
  USD_IDUBID:  [0.768, 0.672, 0.110, 0.052],
  JPY_CASH:    [0.256, 0.803, 0.105, 0.050],
  JPY_QR:      [0.772, 0.803, 0.105, 0.050]
};

const KINDS = {
  KRW: 'KRW', AED: 'AED', USD_SWIFT: 'USD', USD_IDUBID: 'USD',
  JPY_INTERNAL: 'JPY', JPY_SWIFT: 'JPY', JPY_CASH: 'JPY', JPY_QR: 'JPY',
  CNY: 'CNY', THB: 'THB'
};

function tmpFile() {
  return path.join(os.tmpdir(), `swift-${crypto.randomBytes(8).toString('hex')}.png`);
}

async function prepareRegion(buffer, box) {
  const meta = await sharp(buffer, { failOn: 'none' }).metadata();
  const W = meta.width || 957;
  const H = meta.height || 1280;
  const [x, y, w, h] = box;
  const left = Math.max(0, Math.floor(W * x));
  const top = Math.max(0, Math.floor(H * y));
  const width = Math.min(W - left, Math.floor(W * w));
  const height = Math.min(H - top, Math.floor(H * h));

  // 4x enlargement makes the small decimal point much easier for Tesseract.
  return sharp(buffer, { failOn: 'none' })
    .extract({ left, top, width, height })
    .resize({ width: width * 4, height: height * 4, fit: 'fill' })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 0.7 })
    .png()
    .toBuffer();
}

async function runTesseract(buffer, psm = 8) {
  const input = tmpFile();
  try {
    await fs.writeFile(input, buffer);
    const { stdout } = await execFileAsync('tesseract', [
      input, 'stdout', '-l', 'eng', '--psm', String(psm),
      '-c', 'tessedit_char_whitelist=0123456789.',
      '--dpi', '300', '-c', 'user_defined_dpi=300'
    ], { timeout: 12_000, maxBuffer: 256 * 1024 });
    const text = String(stdout || '').trim();
    return text;
  } finally {
    await fs.rm(input, { force: true }).catch(() => {});
  }
}

async function runTesseractConfidence(buffer, psm = 8) {
  const input = tmpFile();
  try {
    await fs.writeFile(input, buffer);
    const { stdout } = await execFileAsync('tesseract', [
      input, 'stdout', '-l', 'eng', '--psm', String(psm), 'tsv',
      '-c', 'tessedit_char_whitelist=0123456789.',
      '--dpi', '300', '-c', 'user_defined_dpi=300'
    ], { timeout: 12_000, maxBuffer: 256 * 1024 });
    let best = { value: null, confidence: -1, text: '' };
    for (const line of String(stdout || '').split(/\r?\n/).slice(1)) {
      const cols = line.split('\t');
      if (cols.length < 12) continue;
      const text = cols[11].trim();
      if (!text) continue;
      const conf = Number(cols[10]);
      if (conf > best.confidence) best = { value: text, confidence: conf, text };
    }
    return best;
  } finally {
    await fs.rm(input, { force: true }).catch(() => {});
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function normalizeField(key, raw) {
  const n = cleanNumber(raw);
  if (n == null) return null;
  const kind = KINDS[key];
  const repaired = repairDecimal(n, kind);
  if (repaired == null) return null;
  if (key === 'KRW') return Number((repaired / 1000).toFixed(6));
  if (key.startsWith('JPY_')) return Number((repaired / 100).toFixed(6));
  return Number(repaired.toFixed(6));
}

function fieldValid(key, value) {
  if (!Number.isFinite(value)) return false;
  if (key === 'KRW') return value > 0.001 && value < 0.2;
  if (key.startsWith('JPY_')) return value > 0.01 && value < 1;
  if (key === 'THB') return value > 0.1 && value < 20;
  if (key === 'CNY') return value > 1 && value < 50;
  if (key === 'AED') return value > 1 && value < 100;
  if (key.startsWith('USD_')) return value > 1 && value < 200;
  return false;
}

async function recognizeRates(buffer) {
  const keys = Object.keys(VALUE_REGIONS);

  // Primary pass: psm 8 is excellent for a single numeric line.
  const crops = await mapLimit(keys, 3, async key => ({ key, buffer: await prepareRegion(buffer, VALUE_REGIONS[key]) }));
  const first = await mapLimit(crops, 3, async item => {
    const result = await runTesseractConfidence(item.buffer, 8);
    return { key: item.key, buffer: item.buffer, ...result };
  });

  const rates = {};
  const debug = {};
  for (const item of first) {
    const value = normalizeField(item.key, item.value);
    rates[item.key] = value;
    debug[item.key] = { psm: 8, ocr: item.value, confidence: item.confidence, value };
  }

  // Fallback only for fields that failed validation or have suspicious OCR confidence.
  const missing = first.filter(item => {
    const value = normalizeField(item.key, item.value);
    return !fieldValid(item.key, value) || item.confidence < 20;
  });
  if (missing.length) {
    const retry = await mapLimit(missing, 3, async item => {
      const result = await runTesseractConfidence(item.buffer, 7);
      return { key: item.key, ...result };
    });
    for (const item of retry) {
      const value = normalizeField(item.key, item.value);
      const old = debug[item.key];
      const oldValue = old?.value;
      // Prefer valid retry. If both are valid, choose higher confidence.
      if (fieldValid(item.key, value) && (!fieldValid(item.key, oldValue) || item.confidence > old.confidence)) {
        rates[item.key] = value;
        debug[item.key] = { psm: 7, ocr: item.value, confidence: item.confidence, value };
      } else {
        debug[item.key].retry = { psm: 7, ocr: item.value, confidence: item.confidence, value };
      }
    }
  }

  // Add compatibility aliases expected by the original calculator.
  rates.JPY_AFA_CASH = rates.JPY_CASH;
  rates.JPY_AFA_QR = rates.JPY_QR;
  rates.USD = rates.USD_SWIFT;

  const missingKeys = RATE_KEYS().filter(key => !fieldValid(key, rates[key]));
  if (missingKeys.length) {
    const err = new Error(`OCR не распознал курсы: ${missingKeys.join(', ')}`);
    err.rates = rates;
    err.rawText = JSON.stringify(debug);
    err.debug = debug;
    throw err;
  }

  return { rates, rawText: JSON.stringify(debug, null, 2), regions: debug, errors: [], attempts: first };
}

function RATE_KEYS() {
  return ['USD_SWIFT','USD_IDUBID','JPY_INTERNAL','JPY_SWIFT','JPY_CASH','JPY_QR','CNY','KRW','THB','AED'];
}

module.exports = { recognizeRates };
