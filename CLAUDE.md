# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

A daily bankruptcy auction scanner that scrapes multiple auction sites and emails good finds. Claude Code itself acts as the deal evaluator — no programmatic rating. Triggered each morning via a Claude.com schedule.

## Architecture

```
auction-scanner/
├── scrapers/          # One script per auction site, all output the same schema
├── scrape.js          # Runs all scrapers, writes scraped_items.json
├── mailer.js          # Reads items from stdin (JSON array), sends email via Resend
└── .env               # See .env.example for required variables
```

## Agent Workflow (run this every morning)

```bash
node scrape.js
```

Then read `preferences.md` to understand what the user wants, then read `scraped_items.json` and evaluate each item:
1. **Is it interesting?** Use `preferences.md` as the guide — keep items matching the user's stated interests, skip categories they don't want.
2. **Is the price good?** Estimate the market value in DKK. Keep only items where the current bid is clearly below market value (a genuine deal).

For each kept item, add a `reason` field (one sentence explaining why it's a good deal, e.g. `"MacBook Pro 14\" — market value ~12,000 DKK, current bid 800 DKK"`).

Then pipe the filtered array to the mailer:

```bash
echo '<json array of good items>' | node mailer.js
```

## Scraper Contract

Every file in `scrapers/` must export an async function returning an array of:

```js
{
  title: string,
  price: number,        // DKK, 0 = no bids yet
  location: string,
  url: string,
  imageUrl: string,     // optional
  source: string,       // scraper filename without extension
}
```

Adding a new site = add one file to `scrapers/`. `scrape.js` auto-discovers and runs all of them.

## Environment Variables

Copy `.env.example` to `.env`:

- `RESEND_API_KEY` — from resend.com dashboard
- `RECIPIENT_EMAIL` — where to send the digest
- `HOME_POSTCODE` — your postal code, used to filter auctions by distance
- `MAX_DISTANCE_KM` — skip auctions further than this (0 = no filter)
- `SCAN_DAYS` — how many days ahead to scan (1 = only today)
