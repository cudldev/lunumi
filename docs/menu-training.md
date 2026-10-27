# Menu model training

Lunumi uses a small character n-gram classifier to filter likely menu-item lines on device. It is not a chat model and does not infer ingredients, diets, or allergen safety. The trainer can write separate English, Finnish, and Swedish weights; the English model is shipped today, and the optional Fineli workflow below generates Finnish and Swedish weights. Missing language weights fall back to local rules.

## Commercially reusable source

The bootstrap corpus comes from USDA FoodData Central's FNDDS 2021–2023 survey-food records. USDA publishes FoodData Central data under CC0 1.0 and requests attribution. The training workflow records the source, release, and license in the ignored corpus and the generated model. This source is public-domain food data, not restaurant menu-page text; it teaches basic food-name versus category/noise distinctions, not site-specific menu layouts.

Do not use the previously reviewed Souslab sample for production training: its CC BY-NC 4.0 license excludes commercial use of trained models without a separate commercial license. Any future input source must have documented rights for model training, releasing the weights, and commercial use. Public visibility or RSS availability is not permission. The RSS collector requires an explicit `commercialUseApproved: true` review gate as well as model-release approval.

Synthetic examples can help exercise formatting variants (prices, separators, line wrapping) if generated deterministically from commercially reusable source data and clearly marked synthetic. They cannot replace real menu pages for evaluating real-world extraction. Do not use OpenAI-generated outputs as training examples. Keep raw sources and labeled data in Git-ignored local storage.

## Local workflow

1. Run `npm run model:prepare`. It downloads the pinned USDA FNDDS JSON archive if needed, extracts it under `data/private-menu-training/`, and prepares English `dish`, `section`, and `other` examples in ignored `labels.jsonl`.
2. For additional languages, create the ignored local manifest `data/menu-training-sources.local.json` and collect only explicitly licensed or permission-cleared feeds/pages with `npm run model:collect`. A source entry looks like this:

   ```json
   {
     "sources": [{
       "sourceName": "Restaurant feed",
       "url": "https://restaurant.example/feed.json",
       "type": "feed",
       "language": "fi",
       "license": "CC BY 4.0",
       "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
       "permissionBasis": "explicit-license",
       "rightsReviewedAt": "2026-10-27",
       "rightsEvidenceUrl": "https://restaurant.example/terms",
       "approvedForModelRelease": true,
       "commercialUseApproved": true
     }]
   }
   ```

   Replace every example value with verified source details. These approval fields are declarations that you reviewed the actual license or written permission; they do not grant permission by themselves. Review each new candidate interactively with `npm run model:label`; the tool displays the source and license evidence and records `dish`, `section`, or `other` labels with the original language, source, license, permission, and rights-evidence fields. It skips previously labeled hashes and keeps the private corpus under the Git-ignored `data/private-menu-training/` directory. The trainer rejects rows without commercial and weight-release approval.
3. Run `npm run model:train`. It trains one standard-library character n-gram Naive Bayes model per language present, reports precision/recall/F1 by label, and writes weights to `public/models/menu-line-classifier.json` for English and `menu-line-classifier-fi.json` / `menu-line-classifier-sv.json` when those datasets exist. It holds out distinct sources when at least five are present; otherwise it holds out item groups when the data provides at least five, and falls back to exact-text holdout only when neither grouped split can cover every label. Read the split recorded in the generated model before interpreting metrics. The currently shipped English model metadata reports a deterministic exact-text holdout (90.2% accuracy; 97.6% dish precision and 90.3% dish recall; 21.6% section precision on 42 examples). This is a food-vocabulary check, not a restaurant-menu or source-disjoint evaluation. The classifier must not decide category headings alone; those remain grounded in explicit page structure and rules.
4. Do not commit `data/private-menu-training/`. The weights include source/license metadata and can be distributed commercially only when every source permits commercial use; keep source attribution in the app and published documentation.

The browser requests the 235 KB English line-classifier weights during idle time, unless the device reports data saver or a 2G connection, and applies them locally as a conservative filter. Image OCR uses the separate Apache-2.0 Tesseract.js engine with pinned `tessdata_fast` language weights, loaded only when a likely menu image is found because the first engine-and-language download is several megabytes. If a language classifier is unavailable, current rules still work. Menu text is not sent to the model-training source, an AI service, or Lunumi servers. Dietary labels still come only from explicit page text. The app always shows the restaurant page used so users can verify current details.

The trainer also records precision and dish/section retention for the same `other` confidence threshold (`0.9`) used by the app. Use this to check false filtering behavior, but treat metrics from food-name or synthetic-only corpora as vocabulary checks, not restaurant-menu accuracy.

## Finnish and Swedish bootstrap

Run `npm run model:prepare:fineli` to download the official Fineli open-data package into the Git-ignored local corpus and build `fineli-labels.jsonl`. If the download is blocked, save the official ZIP as `data/private-menu-training/fineli-open-data.zip` and rerun the command. It extracts Finnish and Swedish food names under Fineli's CC BY 4.0 license and adds a small set of Lunumi-authored CC0 page-noise examples. Refresh the cached package with `npm run model:prepare:fineli -- --refresh`. Then run `npm run model:train:fineli` to create the Finnish and Swedish local line-filter weights. The model metadata records both sources; credit THL and Fineli in the app. Fineli food names are not restaurant-menu pages, so these weights improve local language vocabulary but do not prove real restaurant-menu accuracy or dietary information.

## Future data collection

For real Finnish, Swedish, or English menu-page training, use restaurant-provided samples or source feeds whose terms explicitly allow commercial model training and weight release. Keep a separate restaurant-level holdout set for evaluation. Record the exact source URL, retrieval date, language, license, review evidence, and permission basis for every source. Never infer allergy safety from the model.
