# Local menu assistant

The assistant is a lightweight browser feature, not a hosted LLM. A small Cloudflare Worker fetches approved restaurant pages that the static app cannot read because of browser cross-origin rules. Menu extraction, language detection, dietary labels, and the English line classifier run in the browser.

## User flow

1. Opening a restaurant detail checks the device's parsed-menu cache. Otherwise, the app sends the listed public HTTPS menu URL to the Worker.
2. The Worker uses Cloudflare's platform fetch API, accepts only generated allowlisted hosts, follows up to three allowlisted redirects, forwards no restaurant cookies or authorization headers, and returns at most 500,000 bytes of page text or 3 MB of image bytes.
3. If the listed website contains no readable items, the browser finds up to four likely menu links on that same site and tries them. It also looks for up to three same-site images clearly marked as menus and runs optional OCR on the user's device. The browser extracts structured restaurant product cards and semantic text blocks into up to 100 scrollable items. Where the source page has an image on its own HTTPS host (or Hesburger's official image CDN), the item can show that image. It shows the exact page used and each item's extracted source text so users can verify it.
4. If fetching or extraction fails, the list remains empty and says **Menu not available**.

## Extraction and labels

Items may include a section, name, nearby description, price, ingredients, explicit dietary or allergen information, source excerpt, and an official source image. The reader recognizes Schema.org `Menu`, `MenuSection`, and `MenuItem` JSON-LD; it also reads supported product cards and falls back to semantic headings, paragraphs, and list items. If a website has no menu items, same-site links with menu terms in their text or URL are tried, up to four additional pages. Section names are recognized across supported languages when language detection is uncertain, so common category headings are less likely to appear as dishes. Explicit ingredient, dietary, or allergen lines immediately following a dish are attached to that dish and kept in its source excerpt; page-wide warnings remain menu notes. A small character n-gram classifier filters likely non-menu text. English uses 234 KB weights trained from USDA FoodData Central FNDDS data (CC0); these are requested in browser idle time unless data saver or a 2G connection is reported. Separate Finnish and Swedish weights can be produced when approved examples exist. For clearly labeled menu images, Tesseract.js OCR runs locally using the detected Finnish, Swedish, or English fast model; its code is Apache-2.0. The OCR code and selected language data remain on demand: the first OCR use downloads several megabytes for the engine and one language. Language data comes from a pinned `tessdata_fast` revision via jsDelivr and is cached by the browser. The image and recognized text are not sent to those CDNs. Dietary tags, ingredients, and allergen notes are shown only when explicitly stated in source data. The assistant does not infer allergy safety or interpret symbol legends. Extraction and OCR are heuristic and may miss or misread entries. A restaurant may block the Worker (for example, with HTTP 429); in that case the app keeps the menu empty and links to the source.

## Privacy, cache, and limits

- The Worker processes requested URLs, page text, or bounded image bytes in transit. It sends no credentials, does not persist menu content, and uses `Cache-Control: no-store`. OCR runs in a browser worker; images and OCR text are not uploaded to the OCR package or model hosts.
- Parsed items and source excerpts are cached in browser local storage for 24 hours, up to 20 URLs. Raw source text is stored in IndexedDB for 24 hours and retained as a stale fallback for up to seven days. Both are local to the device and removed by clearing Lunumi site data.
- Worker requests are capped at 100,000 per day on Cloudflare's free plan. Hosts must be in the allowlist; restaurants may still block requests.
- Worker fetch timeout is 10 seconds; browser timeout is 15 seconds and each search reads at most five pages. OCR supports clearly labeled same-site menu images up to 3 MB; image-only PDFs and unlabeled images are not OCR'd. The OCR engine is lazy-loaded and may take extra time on first use; JavaScript-only content may be missing from returned HTML. Product images are loaded directly from the approved HTTPS source host; Hesburger's official `fi-www.hesburger.net` image host is also allowed. Other third-party image hosts are omitted.
- The on-device classifier's 90.2% exact-text held-out score is not a restaurant-menu evaluation. It may suppress valid dishes.

## Setup and deployment

The static app reads `VITE_MENU_READER_URL` at build time. Set GitHub Actions repository variable `MENU_READER_WORKER_URL_STAGING` to the deployed Worker URL ending in `/v1/menu`; leave the live URL unset until Staging is verified.

The Worker workflow uses repository variables `CLOUDFLARE_ACCOUNT_ID` and `MENU_READER_DEPLOY_ENABLED=true`, plus the GitHub Actions secret `CLOUDFLARE_API_TOKEN`. Keep the token only in GitHub Actions Secrets. Deploys run from `staging`. The host allowlist is generated from the restaurant data source.

## Implementation map

- UI, parsing, labels, and device caches: `src/MenuAssistant.tsx`.
- Classifier: `src/menu-classifier.ts`; weights: `public/models/menu-line-classifier.json`.
- Worker and allowlist: `menu-reader-worker/` and `scripts/build-menu-reader-hosts.mjs`.
- Deployment workflows: `.github/workflows/deploy.yml` and `.github/workflows/deploy-menu-reader.yml`.
