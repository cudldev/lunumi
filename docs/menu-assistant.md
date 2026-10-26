# Local menu assistant

The menu assistant is a lightweight browser feature, not a hosted LLM or backend service. The browser attempts to fetch the restaurant's listed menu URL (or website) directly, then parses the returned text locally. A bundled 234 KB character n-gram classifier filters likely non-menu lines in English. Finnish and Swedish use local language rules. The parser organizes extracted text into displayable menu records without asking a model to invent missing fields.

## User flow

1. Opening a restaurant detail first checks the device's menu cache. If there's no fresh entry, Lunumi automatically tries the listed menu URL, or website if no menu URL is listed.
2. The browser makes a credential-free HTTPS request directly to that restaurant website. The site must allow cross-origin access (CORS); Lunumi cannot bypass a restaurant's browser security policy.
3. The browser reads up to 500,000 bytes, strips common non-content HTML elements, splits text into lines, and shows up to 100 likely menu entries in a scrollable list. Records can include a section, name, nearby description, price, explicit dietary or allergen statements, and the source text used for extraction. The source link stays visible for verification.
4. While loading, the menu area shows a loading state. If the site blocks browser access, the page is too large or slow, the content is unsupported, or no entries can be identified, it shows **Menu not available** and keeps the source link available.

## What it extracts

Each entry may show a section, name, nearby description, and price when a simple currency pattern is found. The English classifier loads on-device only when an English menu is read. It is trained on USDA FoodData Central FNDDS food names, categories, portions, and nutrient labels (CC0), not restaurant pages; it only filters high-confidence non-menu lines and does not generate item details. Dietary labels appear only when the same item line explicitly includes a recognized phrase in Finnish, Swedish, or English. Standalone allergen statements are displayed as menu-level notes instead of being attributed to a dish. The extracted source text can be expanded for each item. It does not infer dietary suitability or allergen safety from a dish name or description. Users should verify menu information with the restaurant, especially for allergies.

## Privacy and limits

- Menu content is fetched directly from the restaurant website by the user's browser. Lunumi does not proxy or receive the response on a backend, and sends no cookies or authorization headers. Browser networking still reveals the user's IP address to that restaurant website.
- The browser caches structured item fields, short source excerpts, menu-level allergen notes, and the resolved source URL in local storage for 24 hours, up to 20 source URLs. The complete fetched page text is not saved in browser storage, profiles, or restaurant datasets. Users can clear this cache by clearing Lunumi's site data. Content is not sent to an AI service.
- Cross-origin restrictions (CORS) are controlled by each restaurant website. Most sites do not allow another website to read their pages, so direct loading may fail; users can still open the source link. This static-app design has no usage quota or third-party processing service for menu requests.
- Responses are capped at 500,000 bytes and the browser request times out after 15 seconds.
- PDF and image menus are not parsed. JavaScript-rendered content may not be available in the initial response even when CORS allows access.
- Extraction is heuristic. It may include unrelated text, attach a continuation line to the wrong dish, combine a dish with its price or description, or miss valid items. The source excerpts and link are shown for verification.
- The English model scored 90.2% on an exact-text held-out split from the source data; this is not a restaurant-page evaluation. Section predictions were too imprecise to use. The English filter may still suppress valid dishes, and it does not provide Finnish or Swedish model coverage.
- Explicit labels do not establish allergy safety. The helper does not interpret ingredient/allergen statements, cross-contamination warnings, or restaurant-specific symbol legends.

## Setup and deployment

No Worker, API key, or service credentials are needed. The static app can be deployed through the existing GitHub Pages workflow. Menu fetching works only for sources that permit browser cross-origin access.

## Implementation map

- Browser UI, direct fetch, parsing, dietary labels, and cache: `src/MenuAssistant.tsx`.
- On-device English classifier loading/inference: `src/menu-classifier.ts`; published weights: `public/models/menu-line-classifier.json`.
- Menu source selection and placement: `src/PlaceCard.tsx`.
- Pages deployment workflow: `.github/workflows/deploy.yml`.

Keep this page synchronized with those files whenever the assistant's fetching, parsing, labels, privacy behavior, deployment, or limitations change. Update the README summary when high-level behavior or privacy claims change.
