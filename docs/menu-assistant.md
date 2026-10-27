# Local menu assistant

The assistant is a lightweight browser feature, not a hosted LLM. A small Cloudflare Worker fetches approved restaurant pages that the static app cannot read because of browser cross-origin rules. Menu extraction, language detection, dietary labels, and the English line classifier run in the browser.

## User flow

1. Opening a restaurant detail checks the device's parsed-menu cache. Otherwise, the app sends the listed public HTTPS menu URL to the Worker.
2. The Worker uses Cloudflare's platform fetch API, accepts only generated allowlisted hosts, follows up to three allowlisted redirects, forwards no restaurant cookies or authorization headers, and returns at most 500,000 bytes of page text or 3 MB of image bytes.
3. The browser extracts structured restaurant product cards and semantic text blocks into up to 100 scrollable items. It only accepts results with menu evidence: a menu-specific source URL or heading, structured menu data, a section, or item details such as price, ingredients, explicit dietary data, or an image. If a generic homepage has no such evidence, the browser tries up to four likely same-site menu links and up to three same-site images clearly marked as menus, with optional OCR on the user's device. It shows the exact page used and each item's extracted source text so users can verify it.
4. If fetching or extraction fails, the list remains empty and says **Menu not available**.

## Extraction and labels

Items may include a section, name, nearby description, price, ingredients, explicit dietary or allergen information, source excerpt, and an official source image. The reader recognizes Schema.org `Menu`, `MenuSection`, and `MenuItem` JSON-LD; it also reads supported product cards and falls back to semantic headings, paragraphs, and list items. For tabbed menus with accessible tab panels, it matches the selected menu tab to its panel and extracts that panel’s dish rows and attached details instead of treating the whole restaurant page as menu text. A result needs evidence of an actual menu, such as structured menu data, a menu-specific URL or heading, a section, or explicit item details. Generic home-page text like contact details or marketing copy is rejected, allowing same-site menu-link and labeled-image discovery to continue. The parser recognizes section names across supported languages even when language detection is uncertain; when a known heading and dish share one line, it separates the section while keeping the original source line for verification. Explicit ingredient, dietary, or allergen lines immediately following a dish are attached to that dish and kept in its source excerpt; page-wide warnings remain menu notes. It skips common lunch-page metadata such as nutrition panels, carbon-footprint lines, opening hours, and weekday navigation. Short dietary codes are shown verbatim as listed; the assistant does not guess their meaning. A small character n-gram classifier filters likely non-menu text. English uses 234 KB weights trained from USDA FoodData Central FNDDS data (CC0); these are requested in browser idle time unless data saver or a 2G connection is reported. Separate Finnish and Swedish weights can be produced when approved examples exist. For clearly labeled menu images, Tesseract.js OCR runs locally using the detected Finnish, Swedish, or English fast model; its code is Apache-2.0. The OCR code and selected language data remain on demand: the first OCR use downloads several megabytes for the engine and one language. Language data comes from a pinned `tessdata_fast` revision via jsDelivr and is cached by the browser. The image and recognized text are not sent to those CDNs. Dietary tags, ingredients, and allergen notes are shown only when explicitly stated in source data. The assistant does not infer allergy safety or interpret symbol legends. Extraction and OCR are heuristic and may miss or misread entries. A restaurant may block the Worker (for example, with HTTP 429); in that case the app keeps the menu empty and links to the source.

## Privacy, cache, and limits

- The Worker processes requested URLs, page text, or bounded image bytes in transit. It sends no credentials, does not persist menu content, and uses `Cache-Control: no-store`. OCR runs in a browser worker; images and OCR text are not uploaded to the OCR package or model hosts.
- Parsed items and source excerpts are cached in browser local storage for 24 hours, up to 20 URLs. The parsed cache uses a versioned key so parser changes trigger re-interpretation while cached raw source text can be reused. Raw source text is stored in IndexedDB for 24 hours and retained as a stale fallback for up to seven days. Both are local to the device and removed by clearing Lunumi site data.
- Worker requests are capped at 100,000 per day on Cloudflare's free plan. Hosts must be in the allowlist; restaurants may still block requests.
- Worker fetch timeout is 10 seconds; browser timeout is 15 seconds and each search reads at most five pages. OCR supports clearly labeled same-site menu images up to 3 MB; image-only PDFs and unlabeled images are not OCR'd. The OCR engine is lazy-loaded and may take extra time on first use; JavaScript-only content may be missing from returned HTML. Product images are loaded directly from the approved HTTPS source host; Hesburger's official `fi-www.hesburger.net` image host is also allowed. Other third-party image hosts are omitted.
- The on-device classifier's 90.2% exact-text held-out score is not a restaurant-menu evaluation. It may suppress valid dishes.

## Setup and deployment

The static app reads `VITE_MENU_READER_URL` at build time. Set GitHub Actions repository variable `MENU_READER_WORKER_URL_STAGING` to the deployed Worker URL ending in `/v1/menu`; leave the live URL unset until Staging is verified.

The Staging Worker deploy runs from `staging` when `MENU_READER_DEPLOY_ENABLED=true`. It builds the host allowlist from the `staging` branch of `cudldev/finland-restaurant-data`, matching the Staging Pages directory. It uses the repository variable `CLOUDFLARE_ACCOUNT_ID` and the GitHub Actions secret `CLOUDFLARE_API_TOKEN`; keep the token only in GitHub Actions Secrets. The existing Worker uses Cloudflare's free request tier and has a 100,000-request daily cap.

The GitHub Pages workflow builds the live and Staging sites from their respective branches, then publishes the artifact to the free GitHub Pages site through the `github-pages` environment.

## Implementation map

- UI, parsing, labels, and device caches: `src/MenuAssistant.tsx`.
- Classifier: `src/menu-classifier.ts`; weights: `public/models/menu-line-classifier.json`.
- Worker and allowlist: `menu-reader-worker/` and `scripts/build-menu-reader-hosts.mjs`.
- Deployment workflows: `.github/workflows/deploy.yml` and `.github/workflows/deploy-menu-reader.yml`.
## Restaurant directory data
The GitHub Pages workflow builds the live directory from the `main` branch of `cudldev/finland-restaurant-data` and the Staging directory from that repository's `staging` branch. Staging-only source changes stay out of the live directory until they are separately promoted to `main`. The directory stores source URLs and provenance; it does not copy restaurant menu content. Both repository branches are public and use the existing free GitHub Pages workflow.


The focused UI element is 1 AXWebArea raw.githubusercontent.com/cudldev/lunumi/staging/docs/menu-assistant.md
- The verified restaurant directory is cached with a network-first service-worker rule. When online, the app waits for the latest Pages response; when offline, it can fall back to the cached directory. The cache version changes when needed to avoid older directory data.
