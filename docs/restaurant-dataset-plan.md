# Helsinki metro restaurant dataset plan

## Goal

Build a small, reproducible restaurant-location dataset for Helsinki, Espoo, Vantaa and Kauniainen. Generate it locally and publish the reviewed output with the app. Keep stable place information separate from live menus, and preserve enough provenance to add or replace sources later.

## Source candidates

| Priority | Source | Use | Limits and checks |
| --- | --- | --- | --- |
| 1 | [Helsinki Metropolitan Area Service Map](https://hri.fi/data/en/dataset/paakaupunkiseudun-palvelukartan-rest-rajapinta) | Initial discovery list; service point names, addresses, coordinates, categories, service descriptions and accessibility fields | Covers the four cities and includes private services such as restaurants. Check the dataset's current license, attribution, API terms and field coverage before importing. |
| 2 | [Ruokavirasto Oiva / Tietolaari](https://www.ruokavirasto.fi/elintarvikkeet/elintarvikeala/elintarvikealan-uutiset/elintarvikevalvonnan-toimipaikkakohtaisia-tuloksia-voi-nyt-ladata-tietolaari-palvelusta/) | Validate food-business premises and optionally link inspection results | Free to download and reuse with source attribution. Covers food premises beyond restaurants and publishes inspection results, so it is a validation source rather than a complete restaurant directory. |
| 3 | [PRH / YTJ open data](https://www.ytj.fi/index/avoindata.html) | Match company identities and current registration basics | Free API and daily updates, but company records do not reliably represent individual branches; sole traders are excluded. Do not use it as a restaurant-location source. |
| 4 | Restaurant's own website and menu feed | Official website, contact/menu links and live menu endpoint | Keep the source URL and fetch time. Only store stable directory facts in the static snapshot; fetch menu contents separately at runtime or in a dedicated live-menu service. Respect each site's terms, robots rules and request limits. |
| 5 | [National Land Survey geocoding](https://www.maanmittauslaitos.fi/geokoodauspalvelu) | Fill missing coordinates from an address | Free open API with an API key and attribution. Its terms say it is not intended for mass downloads; use only for a limited set of unresolved addresses, or obtain suitable downloadable address data. |
| Optional | OpenStreetMap | Coverage gaps, extra categories and mapped links | Keep OSM provenance and ODbL obligations explicit. Do not silently combine its derived records with sources under different terms; decide how to distribute a mixed/derived database before importing it. |

The HRI catalog says the Service Map covers Helsinki, Espoo, Vantaa and Kauniainen and includes private services such as restaurants. HRI datasets are generally reusable, but the individual dataset metadata and API terms must be checked before use. Oiva downloads are expressly described as freely reusable with source attribution. PRH's open API is free and updated daily, but excludes sole traders. MML's open geocoding endpoint is free, requires an API key and attribution, and is not intended for bulk downloading.

## Build order

1. **Inspect the Service Map sample.** Query only the four target municipalities. Record which service categories identify restaurants, cafes, fast food and food courts, and whether the data provides stable IDs, website URLs, addresses, coordinates and update timestamps.
2. **Review reuse terms.** Save the source URL, license, required attribution, access terms, retrieval date and any rate limit in a source manifest. Do not ingest a source until those are recorded.
3. **Create the first canonical location list.** Use Service Map locations as the initial candidate list. Keep the source record intact beside the normalized record so mapping decisions can be revisited.
4. **Validate with Oiva.** Match by explicit identifiers when available. Otherwise use normalized name + address as a candidate match, flag uncertain matches for review, and retain unmatched records. Do not classify every Oiva premise as a restaurant.
5. **Resolve legal business identity only when useful.** Match a company to a location with Y-tunnus or other explicit identifiers when supplied. Do not collapse distinct branches just because they share a company.
6. **Enrich links and live menus from restaurant-owned sources.** Store the official homepage and feed URL as links with provenance. Keep fetched menus out of the static restaurant directory.
7. **Review and generate locally.** Produce deterministic JSON, validate required fields, duplicate candidates, municipality coverage, attribution and output size; review a diff before committing and publishing it.

## Extensible data model

Move toward a canonical place with source records, rather than making the canonical ID equal to one provider's ID:

```json
{
  "schema": 2,
  "region": "Helsinki metropolitan area",
  "generatedAt": "ISO-8601 timestamp",
  "sources": [
    { "id": "service-map", "name": "Helsinki Metropolitan Area Service Map", "url": "...", "license": "...", "attribution": "...", "retrievedAt": "..." }
  ],
  "places": [
    {
      "id": "lunumi:place:<stable-id>",
      "name": "Example restaurant",
      "category": "restaurant",
      "address": { "street": "...", "postalCode": "...", "locality": "..." },
      "location": { "lat": 60.0, "lon": 24.0 },
      "links": [{ "type": "website", "url": "https://...", "source": "service-map" }],
      "sourceRecords": [{ "source": "service-map", "recordId": "...", "sourceUrl": "..." }],
      "fieldSources": { "name": ["service-map"], "location": ["service-map"] }
    }
  ]
}
```

Every imported source record should retain its own provider ID, source URL, retrieval date and license reference. For important merged fields, retain which source supplied the value. Add new sources through independent import/normalization adapters; keep entity matching and output generation provider-neutral.

## Matching and conflict rules

- Use exact provider IDs and explicit business IDs for deterministic matches.
- Use normalized names and addresses only to suggest possible matches; ambiguous cases need manual review.
- Keep separate branches separate, even when company name and website are shared.
- Preserve conflicting values with provenance. Apply a documented display precedence only after source coverage is measured.
- Track lifecycle state such as `active`, `possibly_closed` or `needs_review` with evidence and observation dates; avoid deleting a place from one missing refresh.
- Keep menu feeds and fetched menu snapshots in a separate schema keyed to the canonical place ID. Menu records need `feedUrl`, `fetchedAt`, `validFor`/date range and parser/source metadata.

## License and publication checks

- Store source-level license and attribution metadata in the generated artifact and publish all required acknowledgements.
- Review terms per dataset/API version, including whether bulk extraction and redistribution are allowed. Free access alone does not establish redistribution rights.
- Keep records separable by source so a source can be removed or rebuilt without losing unrelated data.
- Before combining OSM-derived records with other data, review the ODbL implications for the resulting database and its distribution. If the terms do not fit the intended public dataset, omit OSM-derived records from that release.
- Do not copy restaurant photos or full menu text into the stable directory without a clear reuse basis. Prefer linking to the restaurant's own page/feed.

## First test and exit criteria

Run a local sample for the four cities and compare Service Map-only coverage against Oiva cross-checks and the current OSM snapshot. Record counts, unmatched/maybe-duplicate examples, missing address/link/coordinate rates, source freshness, download size and per-source license notes. Then decide whether to migrate the app's schema from the current OSM-only `schema: 1` format to a multi-source `schema: 2` format.

No app data or generator behavior changes until that sample and the source terms have been reviewed.
