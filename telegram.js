const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const MAX_PAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function cleanChannel(value) {
  const clean = String(value || '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\/(?:s\/)?/i, '').replace(/\/$/, '');
  if (!/^[A-Za-z0-9_]{5,64}$/.test(clean)) {
    throw new Error('Некорректный TELEGRAM_CHANNEL. Нужен public username канала, например LoyaltySwift');
  }
  return clean;
}

function normalizeMediaUrl(value) {
  if (!value) return null;
  let u = String(value).replace(/&amp;/g, '&').trim();
  if (u.startsWith('//')) u = `https:${u}`;
  return /^https?:\/\//i.test(u) ? u : null;
}

function postUrl(channel, id) {
  return `https://t.me/${channel}/${id}`;
}

function extractPhotoUrl(node) {
  const candidates = [];
  const photo = node.find('.tgme_widget_message_photo_wrap').first();
  if (photo.length) {
    candidates.push(photo.attr('style'));
    candidates.push(photo.attr('data-src'));
    candidates.push(photo.attr('data-lazy-src'));
  }

  node.find('[style]').each((_, el) => candidates.push(node.find(el).attr('style')));
  node.find('img').each((_, el) => {
    candidates.push(node.find(el).attr('src'));
    candidates.push(node.find(el).attr('data-src'));
  });

  const found = new Set();
  for (const value of candidates) {
    if (!value) continue;
    const text = String(value).replace(/&amp;/g, '&');
    const matches = text.match(/(?:url\(["']?([^)'" ]+)["']?\))|(?:https?:\/\/cdn\d+\.telesco\.pe\/file\/[^"'<>\s]+)/gi) || [];
    for (const match of matches) {
      const inner = match.match(/url\(["']?([^)'" ]+)["']?\)/i)?.[1] || match;
      const url = normalizeMediaUrl(inner);
      if (url) found.add(url);
    }
  }
  return [...found].at(-1) || null;
}

function parsePosts(html, channel) {
  const $ = cheerio.load(html);
  const posts = [];

  $('.tgme_widget_message_wrap').each((_, wrapper) => {
    const node = $(wrapper);
    const message = node.find('.tgme_widget_message').first();
    const dataPost = message.attr('data-post') || node.find('[data-post]').first().attr('data-post') || '';
    const parts = String(dataPost).split('/');
    const id = Number(parts.at(-1));
    if (!Number.isInteger(id) || id <= 0) return;

    const timeNode = node.find('time').first();
    const date = timeNode.attr('datetime') || null;
    const text = node.find('.tgme_widget_message_text').first().text().replace(/\s+/g, ' ').trim();
    const imageUrl = extractPhotoUrl(node);

    posts.push({
      id,
      date,
      text,
      imageUrl,
      postUrl: postUrl(channel, id)
    });
  });

  return posts.sort((a, b) => a.id - b.id);
}

async function fetchPage(channel, before = null) {
  const clean = cleanChannel(channel);
  const url = new URL(`https://t.me/s/${clean}`);
  if (before) url.searchParams.set('before', String(before));

  const response = await axios.get(url.toString(), {
    timeout: 25_000,
    maxContentLength: MAX_PAGE_BYTES,
    maxBodyLength: MAX_PAGE_BYTES,
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8'
    },
    validateStatus: status => status >= 200 && status < 300
  });

  return {
    url: url.toString(),
    posts: parsePosts(String(response.data), clean)
  };
}

async function getLatestImagePost(channel, maxPages = 5) {
  const clean = cleanChannel(channel);
  let before = null;
  let best = null;
  let feedUrl = null;

  for (let page = 0; page < maxPages; page += 1) {
    const feed = await fetchPage(clean, before);
    feedUrl = feed.url;
    if (!feed.posts.length) break;

    const candidates = feed.posts.filter(post => post.imageUrl);
    if (candidates.length) best = candidates.at(-1);
    if (best) break;

    const oldest = feed.posts[0].id;
    before = oldest - 1;
    if (before <= 0) break;
  }

  if (!best || !best.imageUrl) {
    throw new Error(`Не найдено изображение в публичной ленте @${clean}`);
  }

  const imageResponse = await axios.get(best.imageUrl, {
    responseType: 'arraybuffer',
    timeout: 30_000,
    maxContentLength: MAX_IMAGE_BYTES,
    maxBodyLength: MAX_IMAGE_BYTES,
    headers: { 'User-Agent': UA },
    validateStatus: status => status >= 200 && status < 300
  });

  const buffer = Buffer.from(imageResponse.data);
  if (!buffer.length) throw new Error('Telegram CDN вернул пустой файл');

  return {
    ...best,
    channel: clean,
    feedUrl,
    buffer
  };
}

module.exports = { cleanChannel, parsePosts, fetchPage, getLatestImagePost };
