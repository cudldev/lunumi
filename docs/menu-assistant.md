# Local menu assistant

The menu assistant is a lightweight browser feature, not a hosted LLM. A Cloudflare Worker fetches approved restaurant pages; menu parsing and dietary-label matching run in the browser. A bundled 234 KB character n-gram classifier filters likely non-menu lines in English. Finnish and Swedish use local language rules.

## User flow

1. Opening a restaurant detail first checks the device's menu cache. If there's no fresh entry, Lunumi automatically loads its listed menu URL, or website if no menu URL is listed.
2. The Worker permits only HTTPS hosts in the generated restaurant host allowlist, follows up to three allowlisted redirects, and requests the page without cookies or authorization headers.
3. It returns up to 500,000 bytes of readable text to the browser. The browser strips common non-content HTML elements, splits text into lines, and shows up to 100 likely menu entries in a scrollable list. The source link stays visible for verification.
4. While loading, the menu area shows a loading state. If the host is blocked, the page is too large or slow, the content is unsupported, or no entries can be identified, it shows **Menu not available** and keeps the source link available.

## What it extracts

Each entry may show its name, nearby description text, and a price when a simple currency pattern is found. The English classifier loads on-device only when an English menu is read. It is trained on USDA FoodData Central FNDDS food names, categories, portions, and nutrient labels (CC0), not restaurant pages; it only suppresses high-confidence non-menu lines and cannot identify menu links or infer ingredients. Dietary labels appear only when the same line explicitly includes a recognized phrase in Finnish, Swedish, or English. Otherwise the UI says dietary details are not stated. It does not infer dietary suitability or allergen safety from a dish name or description. Users should verify menu information with the restaurant, especially for allergies.

## Privacy and limits

- On a cache miss, the request sends the restaurant source URL to the Worker. The Worker fetches the public page and returns text to the browser; menu parsing remains on the device.
- Worker code does not persist or log menu contents. The browser caches only extracted item names, descriptions, prices and explicit dietary labels in local storage for 24 hours, up to 20 source URLs. Raw menu text is not saved in browser storage, profiles, or restaurant datasets. Users can clear this cache by clearing Lunumi's site data. Content is not sent to an AI service. Cloudflare processes cache-miss requests to run the Worker.
- The endpoint only accepts HTTPS hosts generated from Lunumi's Helsinki OSM and official restaurant datasets. Links to unlisted hosts, including many places found outside those datasets, remain source-link-only until the host is added to the reviewed data.
- Responses are capped at 500,000 bytes and fetches time out after 10 seconds. The browser request times out after 15 seconds.
- Each cache miss makes one Worker request when a source URL and Worker URL are configured. Cloudflare Workers Free currently allows 100,000 requests per day; excess requests fail on the Free plan. A paid Workers plan can incur charges under its current pricing. Check [Cloudflare's limits](https://developers.cloudflare.com/workers/platform/limits/), [pricing](https://developers.cloudflare.com/workers/platform/pricing/) and the account's plan before deployment.
- PDF and image menus are not parsed. JavaScript-rendered content may not appear in the returned HTML. A site may still deny requests or return a page that does not contain its menu.
- Extraction is heuristic. It may include unrelated text, combine a dish with its price or description, or miss valid items.
- The English model scored 90.2% on an exact-text held-out split from the source data; this is not a restaurant-page evaluation. Section predictions were too imprecise to use. The English filter may still suppress valid dishes, and it does not provide Finnish or Swedish model coverage.
- Explicit labels do not establish allergy safety. The helper does not interpret ingredient/allergen statements, cross-contamination warnings, or restaurant-specific symbol legends.

## Setup and deployment

The static app calls the Worker URL set at build time through `VITE_MENU_READER_URL`. Add the GitHub Actions repository variable `MENU_READER_WORKER_URL` with the HTTPS URL printed by Wrangler after deploying the Worker. Both production and staging builds use that variable.

The Worker can be deployed from `staging` by enabling the repository variable `MENU_READER_DEPLOY_ENABLED=true` and setting:

- `CLOUDFLARE_ACCOUNT_ID` as a repository Actions variable.
- `CLOUDFLARE_API_TOKEN` as a repository Actions secret with permission to deploy Workers.

Then push to `staging` or run the **Deploy Lunumi menu reader** workflow on the `staging` branch. For local development, run `npm run menu-reader:dev` and set `VITE_MENU_READER_URL=http://localhost:8787` for the Vite app. `npm run menu-reader:hosts` regenerates the allowlist from the checked-in restaurant datasets. The staging deployment workflow also includes the latest official directory snapshot when it generates the deployed allowlist.

## Implementation map

- Browser UI, parsing, dietary labels, and Worker call: `src/MenuAssistant.tsx`.
- On-device English classifier loading/inference: `src/menu-classifier.ts`; published weights: `public/models/menu-line-classifier.json`.
- Menu source selection and placement: `src/PlaceCard.tsx`.
- Worker endpoint and security limits: `menu-reader-worker/index.mjs` and `menu-reader-worker/wrangler.jsonc`.
- Host allowlist generation: `scripts/build-menu-reader-hosts.mjs`.
- Pages and Worker workflows: `.github/workflows/deploy.yml` and `.github/workflows/deploy-menu-reader.yml`.

Keep this page synchronized with those files whenever the assistant's fetching, parsing, labels, privacy behavior, deployment, or limitations change. Update the README summary when high-level behavior or privacy claims change.
