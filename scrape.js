require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function main() {
  const scraperDir = path.join(__dirname, 'scrapers');
  const scraperFiles = fs.readdirSync(scraperDir).filter(f => f.endsWith('.js'));

  console.log(`[scrape] Running ${scraperFiles.length} scraper(s)...`);

  const allItems = [];
  for (const file of scraperFiles) {
    try {
      const scraper = require(path.join(scraperDir, file));
      const items = await scraper();
      console.log(`[${file}] ${items.length} items`);
      allItems.push(...items);
    } catch (err) {
      console.error(`[${file}] Error: ${err.message}`);
    }
  }

  const outPath = path.join(__dirname, 'scraped_items.json');
  fs.writeFileSync(outPath, JSON.stringify(allItems, null, 2));
  console.log(`[scrape] Wrote ${allItems.length} items to scraped_items.json`);
}

main().catch(err => {
  console.error('[scrape] Fatal:', err.message);
  process.exit(1);
});
