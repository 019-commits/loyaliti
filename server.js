const express = require('express');
const path = require('path');
const { getLatestImagePost, cleanChannel } = require('./telegram');
const { recognizeRates } = require('./ocr');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const CHANNEL = cleanChannel(process.env.TELEGRAM_CHANNEL || 'LoyaltySwift');
const POLL_INTERVAL_MS = Math.max(60_000, Number(process.env.POLL_INTERVAL_MS || 10 * 60_000));
const REQUEST_TIMEOUT_MS = Math.max(45_000, Number(process.env.REQUEST_TIMEOUT_MS || 60_000));
const MAX_PAGES = Math.max(1, Number(process.env.TELEGRAM_MAX_PAGES || 3));

let state = {
  success: false, channel: CHANNEL, rates: {}, updatedAt: null,
  sourcePostId: null, sourcePostDate: null, imageUrl: null, postUrl: null,
  feedUrl: null, rawText: '', errors: [], error: null
};
let updatePromise = null;
let lastCheckAt = 0;

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.get('/health', (_req, res) => res.json({
  ok: true, service: 'loyalty-swift-rates', channel: CHANNEL,
  hasRates: state.success, sourcePostId: state.sourcePostId,
  updatedAt: state.updatedAt, lastCheckAt,
  pollIntervalMs: POLL_INTERVAL_MS, error: state.error
}));

app.get('/api/rates', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try { await updateRates(false); } catch (_) {}
  res.json(publicState());
});

app.get('/api/update', async (_req, res) => {
  try { res.json(await updateRates(true)); }
  catch (error) { res.status(502).json({ success: false, ...publicState(), error: error.message }); }
});

app.post('/api/update', async (_req, res) => {
  try { res.json(await updateRates(true)); }
  catch (error) { res.status(502).json({ success: false, ...publicState(), error: error.message }); }
});

app.get('/api/debug', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ...publicState(), rawText: state.rawText, errors: state.errors });
});

function publicState() {
  return {
    success: state.success, channel: state.channel, rates: state.rates,
    updatedAt: state.updatedAt, sourcePostId: state.sourcePostId,
    sourcePostDate: state.sourcePostDate, imageUrl: state.imageUrl,
    postUrl: state.postUrl, feedUrl: state.feedUrl, error: state.error
  };
}

async function updateRates(force) {
  if (updatePromise) return updatePromise;
  if (!force && lastCheckAt && Date.now() - lastCheckAt < 30_000) return publicState();

  updatePromise = (async () => {
    lastCheckAt = Date.now();
    console.log(`Checking @${CHANNEL} for a newer rate-card post...`);
    const source = await withTimeout(
      getLatestImagePost(CHANNEL, MAX_PAGES),
      REQUEST_TIMEOUT_MS,
      'Telegram check timeout'
    );

    // Check the post id first. We OCR only when a new image post appears.
    if (!force && state.success && state.sourcePostId === source.id) {
      state.error = null;
      console.log(`No new rate-card post. Current post: ${source.id}`);
      return publicState();
    }

    console.log(`Processing rate-card post ${source.id}: ${source.postUrl}`);
    const recognized = await withTimeout(
      recognizeRates(source.buffer),
      REQUEST_TIMEOUT_MS,
      `OCR timeout after ${REQUEST_TIMEOUT_MS} ms`
    );

    // Atomic replacement: only after ALL required rates are valid.
    state = {
      ...state,
      success: true,
      channel: CHANNEL,
      rates: recognized.rates,
      updatedAt: new Date().toISOString(),
      sourcePostId: source.id,
      sourcePostDate: source.date,
      imageUrl: source.imageUrl,
      postUrl: source.postUrl,
      feedUrl: source.feedUrl,
      rawText: recognized.rawText,
      errors: recognized.errors || [],
      error: null
    };
    console.log(`Rates updated from post ${source.id}:`, state.rates);
    return publicState();
  })().catch(error => {
    // Keep the last known-good rates when a new post cannot be read.
    state = { ...state, error: error.message };
    console.error('Update failed:', error.stack || error.message);
    throw error;
  }).finally(() => { updatePromise = null; });

  return updatePromise;
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
  ]).finally(() => clearTimeout(timer));
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening on 0.0.0.0:${PORT}`);
  console.log(`Public Telegram channel: https://t.me/${CHANNEL}`);
  console.log(`Polling every ${Math.round(POLL_INTERVAL_MS / 60000)} minute(s)`);

  // Initial check now; after that every 10 minutes.
  updateRates(true).catch(() => {});
  setInterval(() => updateRates(false).catch(() => {}), POLL_INTERVAL_MS);
});
