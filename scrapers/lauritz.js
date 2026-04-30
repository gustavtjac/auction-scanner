require('dotenv').config();
const { chromium } = require('playwright');

const BASE_URL = 'https://www.lauritz.com';

const AREA_IDS = {
  københavn: '100',
  roskilde: '101',
  hørsholm: '102',
  odense: '103',
  vejle: '104',
  aarhus: '105',
  aalborg: '106',
  ekstern: '109',
};

module.exports = async function scrape() {
  const scanDays = parseInt(process.env.SCAN_DAYS || '1', 10);
  const locationName = (process.env.LAURITZ_LOCATION || 'københavn').toLowerCase();
  const areaId = AREA_IDS[locationName];
  if (!areaId) throw new Error(`[lauritz] Unknown location "${locationName}". Valid options: ${Object.keys(AREA_IDS).join(', ')}`);

  const endsWithin = scanDays * 86400;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const items = [];

  try {
    let skip = 0;

    while (true) {
      const skipParam = skip > 0 ? `&skip=${skip}` : '';
      await page.goto(
        `${BASE_URL}/da/auctions?areaId=${areaId}&locations=${areaId}%2C${areaId}&isAuction=true&isActive=true&newItem=true&usedItem=true&endsWithin=${endsWithin}&sortType=endsOn&sortDirection=asc&take=180${skipParam}`,
        { waitUntil: 'load', timeout: 30000 }
      );

      const lots = await page.evaluate(() => {
        const seen = new Set();
        const results = [];

        for (const link of document.querySelectorAll('a[href*="/da/auction/"]')) {
          const href = link.getAttribute('href');
          if (!href || !/\/da\/auction\/[^/]+\/\d+/.test(href)) continue;

          const url = href.startsWith('http') ? href : `https://www.lauritz.com${href}`;
          if (seen.has(url)) continue;
          seen.add(url);

          const card = link.closest('div[class*="card"]') || link.closest('article') || link.closest('li') || link.parentElement;
          if (!card) continue;

          const heading = card.querySelector('h1,h2,h3,h4,h5');
          const title = (heading || link).textContent.trim();
          if (!title) continue;

          let price = 0;
          const allP = Array.from(card.querySelectorAll('p'));
          for (let i = 0; i < allP.length - 1; i++) {
            if (/næste\s+bud/i.test(allP[i].textContent)) {
              price = parseFloat(allP[i + 1].textContent.trim().replace(/\./g, '').replace(',', '.')) || 0;
              break;
            }
          }

          const tagPs = Array.from(card.querySelectorAll('div[class*="tag"] p, div[class*="tag__root"] p'));
          const location = tagPs.map(p => p.textContent.trim()).find(t => t && t !== 'MARKET' && !/^\d/.test(t)) || '';

          const img = card.querySelector('img');
          const imageUrl = img ? img.src : null;

          // Closing indicator: "HH:MM" (today) or "DD. MMM" (future)
          const allTagDivs = Array.from(card.querySelectorAll('div[class*="tag__root"]'));
          const endsAt = allTagDivs.map(d => d.textContent.trim())
            .find(t => /^\d{1,2}:\d{2}$/.test(t) || /^\d{1,2}\.\s*\w+$/.test(t)) || null;

          results.push({ title, price, location, url, imageUrl, source: 'lauritz', endsAt });
        }

        return results;
      });

      if (lots.length === 0) break;
      items.push(...lots);
      if (lots.length < 180) break;
      skip += 180;
    }

    for (const item of items) {
      item.description = await fetchDescription(page, item.url);
    }
  } finally {
    await browser.close();
  }

  return items;
};

async function fetchDescription(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    return await page.evaluate(() => {
      const selectors = [
        '[class*="description"]',
        '[class*="Description"]',
        '[class*="lot-text"]',
        '[class*="lotText"]',
        '[class*="item-text"]',
        '[data-testid*="description"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.innerText.trim();
          if (text.length > 20) return text.slice(0, 800);
        }
      }
      const main = document.querySelector('main') || document.body;
      const paras = Array.from(main.querySelectorAll('p'))
        .map(p => p.innerText.trim())
        .filter(t => t.length > 40 && !/cookie|privacy|terms/i.test(t));
      return paras.slice(0, 4).join(' ').slice(0, 800) || null;
    });
  } catch {
    return null;
  }
}
