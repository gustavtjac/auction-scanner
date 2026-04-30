require('dotenv').config();
const { chromium } = require('playwright');

const BASE_URL = 'https://auktionshuset.dk';

const DANISH_MONTHS = {
  januar: 0, februar: 1, marts: 2, april: 3, maj: 4, juni: 5,
  juli: 6, august: 7, september: 8, oktober: 9, november: 10, december: 11,
};

function parseClosingDate(text) {
  const m = text && text.match(/(\d+)\.\s+(\w+)\s+(\d{4})/);
  if (!m) return null;
  const month = DANISH_MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;
  return new Date(parseInt(m[3]), month, parseInt(m[1]));
}

function isWithinDays(date, days) {
  if (!date) return false;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return date >= start && date < end;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const geocodeCache = new Map();

async function getCoordsByPostcode(postcode) {
  if (geocodeCache.has(postcode)) return geocodeCache.get(postcode);
  try {
    const res = await fetch(`https://api.dataforsyningen.dk/postnumre/${postcode}`);
    if (!res.ok) return null;
    const data = await res.json();
    const coords = { lat: data.visueltcenter[1], lon: data.visueltcenter[0] };
    geocodeCache.set(postcode, coords);
    return coords;
  } catch {
    return null;
  }
}

function extractPostcode(text) {
  const m = text && text.match(/\b(\d{4})\b/);
  return m ? m[1] : null;
}

module.exports = async function scrape() {
  const homePostcode = process.env.HOME_POSTCODE;
  const maxDistance = parseFloat(process.env.MAX_DISTANCE_KM || '0');
  const scanDays = parseInt(process.env.SCAN_DAYS || '1', 10);

  const homeCoords = homePostcode ? await getCoordsByPostcode(homePostcode) : null;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const items = [];

  try {
    const auctions = await collectAuctions(page, scanDays);

    for (const auction of auctions) {
      if (homeCoords && maxDistance > 0) {
        const postcode = extractPostcode(auction.location);
        if (postcode) {
          const coords = await getCoordsByPostcode(postcode);
          if (coords) {
            const dist = haversineKm(homeCoords.lat, homeCoords.lon, coords.lat, coords.lon);
            if (dist > maxDistance) {
              console.log(`[auktionshuset] Skipping "${auction.title}" — ${Math.round(dist)}km away`);
              continue;
            }
          }
        }
      }

      try {
        const lots = await collectLots(page, auction);
        for (const lot of lots) {
          lot.description = await fetchDescription(page, lot.url);
        }
        items.push(...lots);
      } catch (err) {
        console.error(`[auktionshuset] Failed ${auction.url}: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  return items;
};

async function collectAuctions(page, scanDays) {
  const auctions = [];
  let pageNum = 1;

  while (true) {
    await page.goto(`${BASE_URL}/auktioner/?page=${pageNum}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const found = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href*="/auktioner/"]'))
        .filter(a => a.href.includes('auctionStatus=1') && a.querySelector('h3'))
        .map(a => {
          const paras = Array.from(a.querySelectorAll('p')).map(p => p.textContent.trim());
          const addrIdx = paras.findIndex(t => t === 'Auktionsadresse');
          const location = addrIdx >= 0
            ? paras.slice(addrIdx + 1, addrIdx + 3).filter(Boolean).join(', ')
            : paras
                .filter(t => t && !t.includes('lots') && !t.includes('kl.') && !t.includes('Se katalog'))
                .slice(0, 2)
                .join(', ');
          const closingDateText = paras.find(t => /\d+\.\s+\w+\s+\d{4}/.test(t)) || null;
          // "30. april 2026 kl. 20.00" → "30. april kl. 20:00"
          const endsAt = closingDateText
            ? closingDateText.replace(/\s+\d{4}/, '').replace(/kl\.\s*(\d+)\.(\d+)/, 'kl. $1:$2')
            : null;
          return {
            url: a.href,
            title: a.querySelector('h3')?.textContent?.trim() || '',
            location,
            closingDateText,
            endsAt,
          };
        });
    });

    if (found.length === 0) break;

    const todayAuctions = found.filter(a => isWithinDays(parseClosingDate(a.closingDateText), scanDays));
    auctions.push(...todayAuctions);

    const hasNext = await page.$(`a[href="/auktioner/?page=${pageNum + 1}"]`);
    if (!hasNext) break;
    pageNum++;
  }

  return auctions;
}

async function collectLots(page, auction) {
  const lots = [];
  let pageNum = 1;
  const auctionPath = new URL(auction.url).pathname;

  while (true) {
    await page.goto(`${BASE_URL}${auctionPath}?auctionStatus=1&page=${pageNum}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const found = await page.evaluate((location) => {
      const byUrl = new Map();

      for (const link of document.querySelectorAll('a[href*="/lots/"]')) {
        const url = link.href;
        const container = link.closest('article') || link.closest('li') || link.closest('div') || link.parentElement;
        if (!container) continue;

        const existing = byUrl.get(url);

        const img = container.querySelector('img');
        const headings = Array.from(container.querySelectorAll('h2, h3, h4'));
        const title = headings
          .find(h => !h.textContent.includes('Lot nr'))
          ?.textContent?.trim() || link.textContent?.trim();

        if (!title) continue;

        const text = container.textContent;
        const priceMatch = text.match(/Højeste bud[^0-9]*([\d.]+,\d{2})/i);
        const price = priceMatch
          ? parseFloat(priceMatch[1].replace(/\./g, '').replace(',', '.'))
          : 0;

        const imageUrl = img?.src || null;

        if (!existing) {
          byUrl.set(url, { title, price, location, url, imageUrl, source: 'auktionshuset', endsAt: auction.endsAt });
        } else {
          if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl;
          if (!existing.price && price) existing.price = price;
        }
      }

      return Array.from(byUrl.values());
    }, auction.location);

    if (found.length === 0) break;
    lots.push(...found);

    const hasNext = await page.$(`a[href*="page=${pageNum + 1}"]`);
    if (!hasNext) break;
    pageNum++;
  }

  return lots;
}

async function fetchDescription(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    return await page.evaluate(() => {
      const selectors = [
        '[class*="description"]',
        '[class*="Description"]',
        '[class*="lot-description"]',
        '[class*="lot-text"]',
        '[class*="item-description"]',
        '[class*="content"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.innerText.trim();
          if (text.length > 20) return text.slice(0, 800);
        }
      }
      const main = document.querySelector('main') || document.querySelector('article') || document.body;
      const paras = Array.from(main.querySelectorAll('p'))
        .map(p => p.innerText.trim())
        .filter(t => t.length > 40 && !/cookie|privacy|terms/i.test(t));
      return paras.slice(0, 4).join(' ').slice(0, 800) || null;
    });
  } catch {
    return null;
  }
}
