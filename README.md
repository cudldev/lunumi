# Lunumi

Lunumi is a mobile-first, local-first food discovery PWA. It uses React, TypeScript, Vite, Dexie/IndexedDB and OpenStreetMap data. Helsinki metro searches use a prebuilt file served by GitHub Pages; other areas use the public Overpass API. There is no account, paid service or tracking analytics.

## Run locally

Install Node.js 22 or newer, then run:

```sh
npm install
npm run dev
```

Run checks and make a production build:

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

By default Vite builds for the GitHub Pages project path `/lunumi/`. Use `VITE_BASE_PATH=/` for a root-domain deployment. The app uses a single static document with in-app screen state, so reloads do not depend on server-side route rewrites. The generated web manifest and service worker use the configured base path.

## Feature and staging workflow

- Create feature branches from `staging` (for example, `feature/better-search`) and work locally. Feature branch pushes do not deploy a site.
- Open a pull request targeting `staging`. GitHub Actions runs typecheck, tests and a production build as checks; it does not deploy pull requests.
- Merge into `staging` to publish a reviewable preview at `https://<github-username>.github.io/lunumi/staging/`.
- When the preview is ready, open a pull request from `staging` into `main`. Merging it updates production at `https://<github-username>.github.io/lunumi/`.

Both paths are packaged into the same GitHub Pages deployment, so a staging update leaves the production files at the root unchanged. Each Pages deployment replaces the previous combined artifact. Keep the workflow's production base `/lunumi/` and staging base `/lunumi/staging/` aligned if you rename the repository.

## GitHub Pages setup

1. Create a public GitHub repository named `lunumi` and push this project to its `main` branch. If you use another repository name, update the workflow build command to set `VITE_BASE_PATH=/<repository-name>/` before `npm run build`.
2. In the repository, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
3. Push to `main`, or select **Actions → Deploy Lunumi to GitHub Pages → Run workflow**. The deploy job output shows the published URL, normally `https://<github-username>.github.io/lunumi/`.
4. Check the Actions run completed successfully. On a phone, open that URL, allow location if desired, add Lunumi to the home screen, and check the shell/profile still open after switching off the network. Restaurant search needs a network connection.

GitHub Pages is appropriate for this noncommercial prototype. For a commercial launch, move static hosting to a suitable provider such as Cloudflare Pages. The site stores IndexedDB data per origin; moving from `github.io` to another domain requires exporting the JSON profile and importing it on the new origin.

## Data, privacy and limitations

The local profile and food history are stored in IndexedDB. Export produces a versioned JSON file containing preferences, private notes, favorites and history; it may contain sensitive dietary information, so keep it private. Import supports replacement or merge, and the file is validated with a size limit. When a restaurant has a licensed Wikimedia Commons photo preview, the browser loads its thumbnail from Wikimedia Commons; this sends the normal image request metadata to Wikimedia, but not the user's restaurant search coordinates.

Nearby searches inside Helsinki, Espoo, Vantaa and Kauniainen can use a static, filtered OpenStreetMap dataset. It contains named restaurants, cafes, fast food and food courts inside those municipalities or within 5 km of their boundaries, with OSM ID, name, coordinates, amenity, cuisine, opening hours, dietary tags, food tags, and restaurant/menu links where mapped. It excludes raw PBF files, personal user data, addresses, phone numbers and unrelated OSM tags. Generate the dataset locally and commit the small filtered JSON file at `public/data/helsinki-metro.json`; GitHub Pages only publishes that committed file and never downloads or processes the source extract. The PWA caches the JSON for offline use. Dataset generation fails rather than producing output if a municipality boundary is missing, no named places are found, or the result exceeds 10 MB.

The generated file carries OSM attribution and ODbL license metadata. Restaurant cards show mapped restaurant websites and menu links when available, including a live feed URL when mapped. Menu contents are not copied into the snapshot; links open the restaurant's current menu or feed. For photo previews, generation resolves OSM `wikimedia_commons` file and category tags through the Commons API and records only the thumbnail URL, file page, author credit, and license metadata for CC0, CC BY, CC BY-SA, and public-domain files. Images stay hosted by Wikimedia; the app displays the source and license links. Other image tags are omitted because their reuse rights are not established by the tag alone. To generate the file locally, install `osmium-tool`, request a custom PBF extract from [BBBike](https://extract.bbbike.org/) that includes all four municipality boundaries and the 5 km margin, then run `npm run data:helsinki -- <regional.osm.pbf> public/data/helsinki-metro.json`. The generator requires a local file and will not download the full Finland extract. Review the generated file, commit it, and push; the normal Pages deployment will publish the committed JSON. Do not combine additional datasets into this file until their license and attribution can be recorded with the output.

Searches outside the Helsinki metro boundary still use the public Overpass API. Lunumi makes one request to `overpass.private.coffee` per uncached search. There is no client-side timeout; users can cancel a pending search or change location. A search still running after 2.5 seconds shows a message that it is taking longer than usual. The public instance is best effort and may be unavailable or slow, and its own service limits can still end a request. Successful nearby results are cached in browser storage for five minutes, with stale results kept for up to seven days as an offline/overload fallback. The cache is local to the browser and bounded to the 30 most recently saved searches. Results may be incomplete, stale or absent. OSM opening-hours syntax is shown as supplied, not interpreted as live status. Mapped diet and food tags are shown as indications only; dietary safety and menu availability must be confirmed with the restaurant. Mapped restaurant homepages and menu links open in a new tab. Straight-line distance is calculated locally. Each result card includes a lazy-loaded OpenStreetMap embed centered on that place (no API key or additional service account). It loads only as the card approaches the screen; OSM map tiles are donation-funded best effort and subject to the tile usage policy. Google Maps is opened only for outbound directions.

Dietary compatibility is always unknown in V1 because the provider does not offer reliable ingredient/allergen evidence. Unknown must not be treated as safe; confirm directly with restaurants, especially for allergies. Group matching is a local preference collection and does not transmit profiles. A user-submitted city/address lookup uses the public Nominatim endpoint once per submit; there is no autocomplete. That service is donation-funded and has a strict app-wide limit of one request per second; this client spaces submissions by 1.1 seconds per browser instance, but a static prototype cannot enforce the aggregate limit across all users. Treat it as low-volume prototype access, not an SLA. If it is unavailable, use current location. The lookup sends the entered location to OSM.

All personalization and storage run on the device. Restaurant requests send the chosen search coordinates and radius to the public Overpass service. There is no background location tracking, analytics, tracking cookies or user account.

## Manual smoke checks

- On a narrow mobile screen, complete onboarding, enable location, and verify search results stay within the chosen radius.
- Search a restaurant/cuisine term, open directions, add a favorite, record Loved/Okay/Nope, reload, and check profile history.
- Export the profile, clear site data or use another browser, import the file, and verify preferences and history return.
- Open Together and Profile from the bottom navigation; use keyboard tab/enter and check visible focus and labels.
- Build with `VITE_BASE_PATH=/lunumi/`, inspect `dist/index.html`, `dist/manifest.webmanifest`, and `dist/sw.js`, then serve `dist/` beneath `/lunumi/`. Reload that path and confirm assets load; install the PWA and verify its start URL remains `/lunumi/`.
- Repeat at desktop width; after the Helsinki data file has been cached, go offline and confirm metro searches use it while searches elsewhere show an honest network error.
- Search inside the Helsinki metro boundary and verify the prebuilt data loads without an Overpass request; check a location outside it still uses Overpass.

## Provider architecture

`src/core.ts` contains the normalized place shape, distance helper and current Overpass adapter. Keep the UI on that normalized model when adding another provider. A future Google Places adapter would need explicit user opt-in, API key handling outside this static frontend and cost review; it is intentionally not active in V1.

`scripts/build-osm-food-data.mjs` filters a locally supplied regional extract to the four Helsinki metro municipality boundaries and the amenity tags Lunumi displays. Restaurant data generation is a local step; only publishing the app and committed JSON runs in GitHub Actions. If no JSON file is committed, metro searches fall back to the online search provider.
