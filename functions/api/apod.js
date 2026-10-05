/* Cloudflare Pages Function: GET /api/apod?date=YYYY-MM-DD
 *
 * Serves NASA's Astronomy Picture of the Day for the Birthday Cosmos portal.
 * NASA's api.nasa.gov APOD endpoint is currently degraded (returns a generic
 * "NASA Science" placeholder with the NASA logo instead of the real image
 * for every date, following NASA's science.nasa.gov site migration).
 *
 * Fallback chain per date:
 *   1. api.nasa.gov APOD API (structured JSON; used when it returns real data)
 *   2. apod.nasa.gov archive page (apYYMMDD.html -> 301 to the new CMS
 *      image-article page, parsed for title / image / explanation / credit)
 *   3. science.nasa.gov APOD RSS feed (covers the most recent ~30 days, for
 *      dates whose archive redirect only points at the generic APOD landing)
 *
 * Successful responses are cached at the edge for 24h (APOD entries are
 * immutable per date). Only ?date= is accepted; dates are restricted to the
 * APOD archive range 1995-06-16 .. today.
 */

const NASA_API_KEY = 'DEMO_KEY'; // shared demo key; replace with a free api.nasa.gov key if rate-limited
const MIN_DATE = '1995-06-16';
const UA_API = 'poptanilabs-birthday-cosmos/1.0 (contact: poptanilabs.com)';
const UA_WEB = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function yymmdd(iso) {
  const [y, m, d] = iso.split('-');
  return y.slice(2) + m + d;
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, ' ');
}

function unescapeHtml(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function cleanText(s) {
  return unescapeHtml(stripTags(s)).replace(/\s+/g, ' ').trim();
}

/* Parse a science.nasa.gov APOD image-article page (or the migrated
 * apod.nasa.gov archive page, which serves the same CMS content). */
function parseArticle(html, date) {
  // Title: "APOD: 2020 October 9 - The Very Large Array at Moonset - NASA Science"
  const tm = html.match(/<title>\s*APOD:\s*\d{4}\s+[A-Za-z]+\s+\d{1,2}\s*-\s*(.*?)\s*-\s*NASA Science\s*<\/title>/is);
  if (!tm) return null;
  const title = cleanText(tm[1]);
  if (!title) return null;

  // Video days embed YouTube/Vimeo in the article body.
  let media_type = 'image';
  let url = null;
  let hdurl = null;
  const vm = html.match(/(?:youtube\.com|youtube-nocookie\.com)\/embed\/([A-Za-z0-9_-]{6,})/) ||
             html.match(/player\.vimeo\.com\/video\/(\d+)/);
  if (vm) {
    media_type = 'video';
    url = vm[0].includes('vimeo')
      ? 'https://player.vimeo.com/video/' + vm[1]
      : 'https://www.youtube.com/embed/' + vm[1];
  }

  // Image: og:image rendition (1280px). Skip NASA logo placeholders.
  const im = html.match(/<meta property="og:image" content="([^"]+)"/);
  const imgUrl = im ? im[1] : null;
  if (imgUrl && !imgUrl.includes('nasa-logo')) {
    hdurl = imgUrl;
    if (!url) url = imgUrl;
  }
  if (!url) return null;

  // Explanation paragraph: <strong>Explanation:</strong> ... </p>
  let explanation = '';
  const em = html.match(/<strong>Explanation:<\/strong>\s*([\s\S]*?)<\/p>/i);
  if (em) explanation = cleanText(em[1]);

  // Credit line: "Image Credit: ..." — may contain inline links, so capture
  // across tags up to the enclosing element boundary, then strip tags.
  let copyright = '';
  const cm = html.match(/(?:Image|Video) Credit:\s*([\s\S]{1,400}?)<\/(?:td|p|div|li|span)>/i);
  if (cm) copyright = cleanText(cm[1]);

  return { date, title, explanation, url, hdurl: hdurl || url, media_type, copyright };
}

async function fetchText(url, ua) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'User-Agent': ua, 'Accept': 'text/html,application/xhtml+xml' },
    });
    if (!r.ok) return null;
    return { finalUrl: r.url, body: await r.text() };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/* Source 1: official NASA APOD API. Rejects the placeholder responses the
 * API currently emits (generic "NASA Science" title + nasa-logo image). */
async function fromNasaApi(date) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(
      `https://api.nasa.gov/planetary/apod?api_key=${NASA_API_KEY}&date=${date}&thumbs=true`,
      { signal: ctl.signal, headers: { 'User-Agent': UA_API } }
    );
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const u = j.url || '';
    if (!u || u.includes('nasa-logo') || j.title === 'NASA Science') return null;
    return {
      date: j.date || date,
      title: j.title || '',
      explanation: j.explanation || '',
      url: u,
      hdurl: j.hdurl || u,
      media_type: j.media_type || 'image',
      copyright: (j.copyright || '').trim(),
      nasa_url: `https://apod.nasa.gov/apod/ap${yymmdd(date)}.html`,
      source: 'nasa-api',
    };
  } catch {
    return null;
  }
}

/* Source 2: apod.nasa.gov archive page (follows the 301 to the new CMS article). */
async function fromArchive(date) {
  const got = await fetchText(`https://apod.nasa.gov/apod/ap${yymmdd(date)}.html`, UA_WEB);
  if (!got) return null;
  // Very recent dates redirect to the generic APOD landing page — no per-date content.
  if (/^https:\/\/science\.nasa\.gov\/apod\/?(\?.*)?$/.test(got.finalUrl)) return null;
  const p = parseArticle(got.body, date);
  if (!p) return null;
  p.nasa_url = got.finalUrl;
  p.source = 'apod-archive';
  return p;
}

/* Source 3: science.nasa.gov APOD RSS feed (last ~30 days) matched by pubDate. */
async function fromRss(date) {
  const got = await fetchText('https://science.nasa.gov/feed/apod-basic/', UA_WEB);
  if (!got) return null;
  const items = got.body.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const it of items) {
    const pd = it.match(/<pubDate>([^<]+)<\/pubDate>/);
    const lk = it.match(/<link>([^<]+)<\/link>/);
    if (!pd || !lk) continue;
    const d = new Date(pd[1]);
    if (isNaN(d)) continue;
    if (d.toISOString().slice(0, 10) !== date) continue;
    const art = await fetchText(lk[1].trim(), UA_WEB);
    if (!art) continue;
    const p = parseArticle(art.body, date);
    if (p) {
      p.nasa_url = art.finalUrl;
      p.source = 'apod-rss';
      return p;
    }
  }
  return null;
}

/* Resolve with the first non-null result from parallel source attempts. */
function firstResult(promises) {
  return new Promise((resolve) => {
    let pending = promises.length;
    if (!pending) return resolve(null);
    const done = (v) => {
      if (v) return resolve(v);
      if (--pending === 0) resolve(null);
    };
    promises.forEach((p) => Promise.resolve(p).then(done, () => done(null)));
  });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const date = (url.searchParams.get('date') || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: 'Missing or invalid ?date=YYYY-MM-DD' }, 400);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (date < MIN_DATE || date > today) {
    return json({ error: `Date must be between ${MIN_DATE} and ${today}` }, 400);
  }

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // Race the two primary sources so a slow/degraded NASA API doesn't hold up
  // the archive fallback; RSS covers recent dates whose archive redirect
  // only points at the generic APOD landing page.
  const data =
    (await firstResult([fromNasaApi(date), fromArchive(date)])) ||
    (await fromRss(date));

  if (!data) {
    return json(
      { error: 'Could not load this date from NASA right now. Please try again in a little while.' },
      502
    );
  }

  const res = json(data);
  res.headers.set('Cache-Control', 'public, max-age=86400');
  res.headers.set('Access-Control-Allow-Origin', '*');
  await cache.put(cacheKey, res.clone());
  return res;
}
