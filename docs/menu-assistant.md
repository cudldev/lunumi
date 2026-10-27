# Local menu assistant

The menu assistant is a lightweight browser feature, not a hosted LLM. In staging, a small Cloudflare Worker fetches approved public restaurant pages that a static website cannot read because of browser cross-origin rules. Menu extraction, language detection, dietary labels, and the English line filter run on the user's device.

## How it works

1. Opening a restaurant detail checks the device's parsed-menu cache, then tries the listed menu URL or website.
2. When configured, the app sends the public HTTPS source URL to the Worker. The Worker accepts only generated allowlisted restaurant hosts, follows up to three redirects that remain on the allowlist, sends no cookies or authorization headers, and returns at most 500,000 bytes.
3. The browser parses readable HTML, text, JSON, or XML into up to 100 scrollable menu items. Items may show a section, name, description, price, dietary label, allergen note, and source-text excerpt. The source link stays available for verification.
4. If fetching fails or no items are identified, the list stays empty and shows **Menu not available**.

## Extraction and dietary details

A 234 KB English character n-gram classifier filters likely non-menu lines; it does not generate dishes or infer ingredients. Finnish and Swedish use local language rules. Dietary labels and allergen notices appear only when explicit text is found. Missing information stays unknown, and the assistant does not infer allergy safety or interpret menu symbol legends. Extraction is heuristic and may miss or misread entries. The 90.2% held-out classifier score is not a restaurant-menu evaluation.

Menu photos are not extracted or displayed yet. PDF and image menus open at the restaurant source. JavaScript-rendered content may be missing from the HTML returned by the restaurant.

## Privacy, cache, and limits

- The Worker fetches only the requested public page. It does not persist menu content and responds with `Cache-Control: no-store`. Restaurant pages receive a normal request from the Worker; the Worker forwards no user cookies or authorization headers.
- Parsed items and source excerpts are cached in browser local storage for 24 hours, up to 20 URLs. Raw menu text is cached in IndexedDB on the device for up to seven days as a stale fallback. Clearing Lunumi site data removes these caches.
- The Worker is limited to the generated allowlist, a 10-second source-fetch timeout, and 500,000 response bytes. The browser times out after 15 seconds. Cloudflare's free Workers plan has a 100,000-request daily limit; restaurant blocks, rate limits, or unsupported content can still prevent a menu from loading.

## Setup and deployment

Set the GitHub Actions repository variable `MENU_READER_WORKER_URL_STAGING` to the deployed Worker endpoint ending in `/v1/menu`. Set `CLOUDFLARE_ACCOUNT_ID` and `MENU_READER_DEPLOY_ENABLED=true` as repository variables, and keep `CLOUDFLARE_API_TOKEN` only in GitHub Actions Secrets. The Worker deploy workflow runs from `staging`. The Pages workflow builds both production and staging; keep `MENU_READER_WORKER_URL_LIVE` unset until staging has been verified. The staging Worker is `lunumi-menu-reader`.

## Implementation map

- UI, parsing, labels, and device caches: `src/MenuAssistant.tsx`.
- English line filter: `src/menu-classifier.ts` and `public/models/menu-line-classifier.json`.
- Worker and generated allowlist: `menu-reader-worker/` and `scripts/build-menu-reader-hosts.mjs`.
- Training data and scripts: `docs/menu-training.md` and `training/menu-extractor/`.
- Deployment workflows: `.github/workflows/deploy.yml` and `.github/workflows/deploy-menu-reader.yml`.

## Separate conversation test

The optional `chat-test/` page tests on-device AI conversation without menu tools or source fetching. See [chatbot-test.md](chatbot-test.md); it does not change this menu assistant’s source or label handling.
