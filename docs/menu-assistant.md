# Local menu assistant

The assistant is a lightweight browser feature, not a hosted LLM. A small Cloudflare Worker fetches approved restaurant pages that the static app cannot read because of browser cross-origin rules. Menu extraction, language detection, dietary labels, and the English line classifier run in the browser.

## User flow

1. Opening a restaurant detail checks the device's parsed-menu cache. Otherwise, the app sends the listed public HTTPS menu URL to the Worker.
2. The Worker uses Cloudflare's platform fetch API, accepts only generated allowlisted hosts, follows up to three allowlisted redirects, forwards no restaurant cookies or authorization headers, and returns at most 500,000 bytes.
3. The browser extracts structured restaurant product cards and semantic text blocks into up to 100 scrollable items. Where the source page has an image on its own HTTPS host (or Hesburger's official image CDN), the item can show that image. It shows the source link and each item's extracted source text so users can verify it.
4. If fetching or extraction fails, the list remains empty and says **Menu not available**.

## Extraction and labels

Items may include a section, name, nearby description, price, source excerpt, and an official source image. The reader recognizes Schema.org `Menu`, `MenuSection`, and `MenuItem` JSON-LD, including explicit `suitableForDiet` and allergen properties; it also reads Hesburger product cards and falls back to semantic headings, paragraphs, and list items. English uses a 234 KB character n-gram classifier trained from USDA FoodData Central FNDDS data (CC0) to filter likely non-menu lines; it does not interpret whole pages or generate item details. Finnish and Swedish use local language rules. Dietary tags and allergen notes are shown only when explicit source data is found. The assistant does not infer allergy safety or interpret symbol legends. Extraction is heuristic and may miss or misread entries. A restaurant may block the Worker (for example, with HTTP 429); in that case the app keeps the menu empty and links to the source.

## Privacy, cache, and limits

- The Worker processes the requested URL and page text in transit. It sends no credentials, does not persist menu content, and uses `Cache-Control: no-store`.
- Parsed items and source excerpts are cached in browser local storage for 24 hours, up to 20 URLs. Raw source text is stored in IndexedDB for 24 hours and retained as a stale fallback for up to seven days. Both are local to the device and removed by clearing Lunumi site data.
- Worker requests are capped at 100,000 per day on Cloudflare's free plan. Hosts must be in the allowlist; restaurants may still block requests.
- Worker fetch timeout is 10 seconds; browser timeout is 15 seconds. PDF and image menus are not parsed, and JavaScript-only content may be missing from the returned HTML. Product images are loaded directly from the approved HTTPS source host; Hesburger's official `fi-www.hesburger.net` image host is also allowed. Other third-party image hosts are omitted.
- The on-device classifier's 90.2% exact-text held-out score is not a restaurant-menu evaluation. It may suppress valid dishes.

## Setup and deployment

The static app reads `VITE_MENU_READER_URL` at build time. Set GitHub Actions repository variable `MENU_READER_WORKER_URL_STAGING` to the deployed Worker URL ending in `/v1/menu`; leave the live URL unset until Staging is verified.

The Worker workflow uses repository variables `CLOUDFLARE_ACCOUNT_ID` and `MENU_READER_DEPLOY_ENABLED=true`, plus the GitHub Actions secret `CLOUDFLARE_API_TOKEN`. Keep the token only in GitHub Actions Secrets. Deploys run from `staging`. The host allowlist is generated from the restaurant data source.

## Implementation map

- UI, parsing, labels, and device caches: `src/MenuAssistant.tsx`.
- Classifier: `src/menu-classifier.ts`; weights: `public/models/menu-line-classifier.json`.
- Worker and allowlist: `menu-reader-worker/` and `scripts/build-menu-reader-hosts.mjs`.
- Deployment workflows: `.github/workflows/deploy.yml` and `.github/workflows/deploy-menu-reader.yml`.
