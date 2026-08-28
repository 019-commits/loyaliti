const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const { parseRates, hasCoreRates } = require('./rates');

const execFileAsync = promisify(execFile);

async function preprocess(buffer, variant = 0) {
  let image = sharp(buffer, { failOn: 'none' });
  const meta = await image.metadata();

  // Do not enlarge the Telegram image. Upscaling made Tesseract slower on Render
  // and did not improve this high-resolution card.
  if (variant === 0) {
    image = image.normalize().sharpen({ sigma: 0.6 });
  } else {
    image = image.grayscale().normalize().linear(1.25, -15).sharpen({ sigma: 0.6 });
  }

  return image.png().toBuffer();
}

async function runTesseract(buffer, psm) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'swift-ocr-'));
  const input = path.join(dir, `${crypto.randomBytes(8).toString('hex')}.png`);
  try {
    await fs.writeFile(input, buffer);
    const { stdout, stderr } = await execFileAsync('tesseract', [
      input, 'stdout', '-l', 'rus+eng', '--psm', String(psm),
      '--dpi', '300', '-c', 'user_defined_dpi=300'
    ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    return { text: String(stdout || '').trim(), stderr: String(stderr || '').trim() };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function recognizeRates(buffer) {
  const attempts = [];
  let best = { rates: {}, rawText: '' };

  // One normal pass should solve this card in ~5–7 seconds on a small Render CPU.
  for (const psm of [11, 6]) {
    const prepared = await preprocess(buffer, 0);
    const result = await runTesseract(prepared, psm);
    const rates = parseRates({}, result.text);
    attempts.push({ psm, chars: result.text.length });

    if (Object.keys(rates).length > Object.keys(best.rates).length) {
      best = { rates, rawText: result.text };
    }
    if (hasCoreRates(rates)) {
      return { rates, rawText: result.text, regions: {}, errors: [], attempts };
    }
  }

  // Only then try the contrast rescue pass.
  const prepared = await preprocess(buffer, 1);
  const result = await runTesseract(prepared, 11);
  const rates = parseRates({}, result.text);
  attempts.push({ psm: 11, variant: 1, chars: result.text.length });
  if (Object.keys(rates).length > Object.keys(best.rates).length) best = { rates, rawText: result.text };
  if (hasCoreRates(rates)) {
    return { rates, rawText: result.text, regions: {}, errors: [], attempts };
  }

  const err = new Error('OCR не распознал все 10 курсов на карточке.');
  err.rates = best.rates;
  err.rawText = best.rawText;
  err.attempts = attempts;
  throw err;
}

module.exports = { recognizeRates };
