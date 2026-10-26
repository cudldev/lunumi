# Lunumi

Lunumi is a mobile-first, local-first food discovery PWA. It uses React, TypeScript, Vite, Dexie/IndexedDB and public restaurant data. Helsinki metro searches combine a prebuilt OpenStreetMap snapshot with a separately maintained directory of restaurants checked against their official pages; other areas use the public Overpass API. The Map tab shows local food history and nearby places not marked visited as pins on OpenStreetMap tiles. Selecting a pin opens Lunumi's restaurant info card; the map supports zoom, drag panning and fit-to-places. Viewing the map requests the displayed tiles from OpenStreetMap, while history stays on-device. Lunumi has no user accounts or tracking analytics.

## Menu assistant

Restaurant details show a scrollable list when menu text can be read from the listed restaurant page. In staging, a Cloudflare Worker fetches approved restaurant pages when browser cross-origin rules prevent direct reading; extraction, language detection, dietary labels, and the English line filter run on the user's device. The Worker does not save menu content. Parsed items and source excerpts are cached on-device for 24 hours, and raw menu text for up to seven days as a stale fallback. Items may show section, name, description, price, explicitly stated dietary labels, and source text for verification. Missing dietary information stays unknown; the assistant does not infer ingredients or allergy safety. Menu images and PDFs are not parsed yet, and menu-item photos are not shown. The staging Worker uses Cloudflare's free-plan daily request limit; the live Worker URL remains unset until staging is verified. See [the menu assistant guide](docs/menu-assistant.md) for sources, privacy, limits, and setup.

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
