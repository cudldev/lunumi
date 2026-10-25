# Lunumi

Lunumi is a mobile-first, local-first food discovery PWA. It uses React, TypeScript, Vite, Dexie/IndexedDB and the community-maintained [Finland Restaurant Data](https://github.com/cudldev/finland-restaurant-data) directory as its restaurant source in the Helsinki metro area. The directory stores stable location details and links to current menus; other areas still use the public Overpass API. There is no account, paid service or tracking analytics.

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

Helsinki metro searches use the verified directory from [Finland Restaurant Data](https://github.com/cudldev/finland-restaurant-data) only; Lunumi does not load the OSM restaurant snapshot for those searches. Each published location has an official source and a validation date; coordinates have separate OpenStreetMap Nominatim provenance. City Service Map records are discovery leads, not automatically published listings: maintainers check each location against its official current page first. Cafeterias can be listed with category `cafe`. Live lunch feeds remain links hosted by restaurants, and menu contents are not copied. Commons photos are shown only when the individual file page provides a reusable license; the app links the creator, file page and license, and Wikimedia hosts the image. The public Pages workflow checks out the data repository and packages the same directory into live and staging. The committed local copy at `public/data/restaurant-directory.json` supports local development; the PWA caches that file for up to 14 days.

The restaurant directory is a separate open data product under ODbL 1.0. Restaurant identity, operation status, and links are sourced from official pages; coordinate sources and required attribution are recorded on each location. Restaurant cards show the validation date, official website, and any verified menu/feed links. Photos remain external Commons links with the individual file's creator and license displayed. Do not reuse photos from restaurant websites or social media unless the exact image is explicitly licensed for reuse.

Refresh candidate leads locally in the data repository with `npm run discover`. It fetches Helsinki Metropolitan Area Service Map records under CC BY 4.0 into an ignored `.local/candidates.json` review file; those candidates are not part of the published directory until a maintainer verifies the specific branch on a current official page and independently sources its coordinates. Do not combine CC BY candidate records into the ODbL directory. For a directory update, edit `data/restaurants.json`, run `npm run validate`, and submit a pull request to the data repository. After it merges, the next Lunumi Pages build packages that public directory into both live and staging. The local app copy can be refreshed with `Copy-Item` from the data repository's `data/restaurants.json` into `public/data/restaurant-directory.json`.

Searches outside the Helsinki metro boundary still use the public Overpass API. Lunumi makes one request to `overpass.private.coffee` per uncached search. There is no client-side timeout; users can cancel a pending search or change location. A search still running after 2.5 seconds shows a message that it is taking longer than usual. The public instance is best effort and may be unavailable or slow, and its own service limits can still end a request. Successful nearby results are cached in browser storage for five minutes, with stale results kept for up to seven days as an offline/overload fallback. The cache is local to the browser and bounded to the 30 most recently saved searches. Results may be incomplete, stale or absent. OSM opening-hours syntax is shown as supplied, not interpreted as live status. Mapped diet and food tags are shown as indications only; dietary safety and menu availability must be confirmed with the restaurant. Mapped restaurant homepages and menu links open in a new tab. Straight-line distance is calculated locally. Restaurant cards do not embed maps. The Directions action hands off to Android map apps through a geo link, opens Apple Maps on iOS, and uses Google Maps on desktop browsers. Android falls back to Google Maps if no map app takes the geo link.

Dietary compatibility is always unknown in V1 because the provider does not offer reliable ingredient/allergen evidence. Unknown must not be treated as safe; confirm directly with restaurants, especially for allergies. Group matching is a local preference collection and does not transmit profiles. A user-submitted city/address lookup uses the public Nominatim endpoint once per submit; there is no autocomplete. That service is donation-funded and has a strict app-wide limit of one request per second; this client spaces submissions by 1.1 seconds per browser instance, but a static prototype cannot enforce the aggregate limit across all users. Treat it as low-volume prototype access, not an SLA. If it is unavailable, use current location. The lookup sends the entered location to OSM.

All personalization and storage run on the device. Restaurant requests send the chosen search coordinates and radius to the public Overpass service. There is no background location tracking, analytics, tracking cookies or user account.

## Manual smoke checks

- On a narrow mobile screen, complete onboarding, enable location, and verify search results stay within the chosen radius.
- Search a restaurant/cuisine term, open directions, add a favorite, record Loved/Okay/Nope, reload, and check profile history.
- Export the profile, clear site data or use another browser, import the file, and verify preferences and history return.
- Open Together and Profile from the bottom navigation; use keyboard tab/enter and check visible focus and labels.
- Build with `VITE_BASE_PATH=/lunumi/`, inspect `dist/index.html`, `dist/manifest.webmanifest`, and `dist/sw.js`, then serve `dist/` beneath `/lunumi/`. Reload that path and confirm assets load; install the PWA and verify its start URL remains `/lunumi/`.
- Repeat at desktop width; after the curated directory has been cached, go offline and confirm metro searches use it while searches elsewhere show an honest network error.
- Search inside the Helsinki metro boundary and verify results come from `restaurant-directory.json` without fetching `helsinki-metro.json` or calling Overpass; check a location outside it still uses Overpass.

## Provider architecture

`src/core.ts` contains the normalized place shape, distance helper, curated Helsinki directory reader, and Overpass adapter for other regions. Keep the UI on that normalized model when adding another provider. A future Google Places adapter would need explicit user opt-in, API key handling outside this static frontend and cost review; it is intentionally not active in V1.

Restaurant directory edits and candidate discovery are local data preparation steps. GitHub Actions only checks out the public, reviewed directory and builds the same data into the live and staging sites; it does not scrape restaurant pages or geocode addresses.
