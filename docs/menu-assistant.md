# Local menu assistant

The menu assistant is a lightweight browser feature. It does not download an LLM. Restaurant-page fetching runs through a small Cloudflare Worker because a static GitHub Pages app cannot read most cross-origin restaurant sites directly. Menu extraction and dietary-label matching still run in the user's browser.

## User flow

1. The assistant appears in a restaurant detail when a menu URL or website URL is listed.
2. The user presses **Read menu**. Lunumi sends the selected URL to the menu reader Worker.
3. The Worker permits only HTTPS hosts in the generated restaurant host allowlist, follows up to three allowlisted redirects, and requests the page without cookies or authorization headers.
4. It returns up to 500,000 bytes of readable text to the browser. The browser strips common non-content HTML elements, splits text into lines, and shows up to 100 likely menu entries. The original source link is displayed so users can verify it.
5. If the host is not in the allowlist, the request is blocked, the page is too large or slow, or the content is not supported, Lunumi explains the issue and offers the source link.

## What it extracts

Each entry may show its name, nearby description text, and a price when a simple currency pattern is found. Dietary labels appear only when the same line explicitly includes **vegan**, **vegetarian**, **gluten-free**, **dairy-free**, **halal**, or **keto/ketogenic**. Otherwise the UI says dietary details are not stated. It does not infer ingredients, dietary suitability, or allergen safety from a dish name or description. Users should verify menu information with the restaurant, especially for allergies.

## Privacy and limits

- The request sends the restaurant source URL to the Worker. The Worker fetches the public page and returns text to the browser; menu parsing remains on the device.
- Worker code does not persist or log menu contents, and the browser does not store menu text in IndexedDB, profiles, or restaurant datasets. Content is not sent to an AI service. Cloudflare processes the request to run the Worker.
- The endpoint only accepts HTTPS hosts generated from Lunumi's Helsinki OSM and official restaurant datasets. Links to unlisted hosts, including many places found outside those datasets, remain source-link-only until the host is added to the reviewed data.
- Responses are capped at 500,000 bytes and fetches time out after 10 seconds. The browser request times out after 15 seconds.
- PDF and image menus are not parsed. JavaScript-rendered content may not appear in the returned HTML. A site may still deny requests or return a page that does not contain its menu.
- Extraction is heuristic. It may include unrelated text, combine a dish with its price or description, or miss valid items.
- Explicit labels do not establish allergy safety. The helper does not interpret ingredient/allergen statements, cross-contamination warnings, or restaurant-specific symbol legends.

## Setup and deployment

The static app calls the Worker URL set at build time through `VITE_MENU_READER_URL`. Add the GitHub Actions repository variable `MENU_READER_WORKER_URL` with the HTTPS URL printed by Wrangler after deploying the Worker. Both production and staging builds use that variable.

The Worker can be deployed from `staging` by enabling the repository variable `MENU_READER_DEPLOY_ENABLED=true` and setting:

- `CLOUDFLARE_ACCOUNT_ID` as a repository Actions variable.
- `CLOUDFLARE_API_TOKEN` as a repository Actions secret with permission to deploy Workers.

Then push to `staging` or run the **Deploy Lunumi menu reader** workflow on the `staging` branch. For local development, run `npm run menu-reader:dev` and set `VITE_MENU_READER_URL=http://localhost:8787` for the Vite app. `npm run menu-reader:hosts` regenerates the allowlist from the checked-in restaurant datasets. The staging deployment workflow also includes the latest official directory snapshot when it generates the deployed allowlist.

## Implementation map

- Browser UI, parsing, dietary labels, and Worker call: `src/MenuAssistant.tsx`.
- Menu source selection and placement: `src/PlaceCard.tsx`.
- Worker endpoint and security limits: `menu-reader-worker/index.mjs` and `menu-reader-worker/wrangler.jsonc`.
- Host allowlist generation: `scripts/build-menu-reader-hosts.mjs`.
- Pages and Worker workflows: `.github/workflows/deploy.yml` and `.github/workflows/deploy-menu-reader.yml`.

Keep this page synchronized with those files whenever the assistant's fetching, parsing, labels, privacy behavior, deployment, or limitations change. Update the README summary when high-level behavior or privacy claims change.
