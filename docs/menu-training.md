# Menu model training

Lunumi uses a small character n-gram classifier to filter likely menu-item lines on device. It is not a chat model and does not infer ingredients, diets, or allergen safety. The trainer can write separate English, Finnish, and Swedish weights; currently only the English model has approved training data and is shipped. Missing language weights fall back to local rules.

## Commercially reusable source

The bootstrap corpus comes from USDA FoodData Central's FNDDS 2021–2023 survey-food records. USDA publishes FoodData Central data under CC0 1.0 and requests attribution. The training workflow records the source, release, and license in the ignored corpus and the generated model. This source is public-domain food data, not restaurant menu-page text; it teaches basic food-name versus category/noise distinctions, not site-specific menu layouts.

Do not use the previously reviewed Souslab sample for production training: its CC BY-NC 4.0 license excludes commercial use of trained models without a separate commercial license. Any future input source must have documented rights for model training, releasing the weights, and commercial use. Public visibility or RSS availability is not permission. The RSS collector requires an explicit `commercialUseApproved: true` review gate as well as model-release approval.

Synthetic examples can help exercise formatting variants (prices, separators, line wrapping) if generated deterministically from commercially reusable source data and clearly marked synthetic. They cannot replace real menu pages for evaluating real-world extraction. Do not use OpenAI-generated outputs as training examples. Keep raw sources and labeled data in Git-ignored local storage.

## Local workflow

1. Run `npm run model:prepare`. It downloads the pinned USDA FNDDS JSON archive if needed, extracts it under `data/private-menu-training/`, and prepares English `dish`, `section`, and `other` examples in ignored `labels.jsonl`.
2. For additional languages, collect only explicitly licensed or permission-cleared feeds with `npm run model:collect`; manually review and label candidate text lines as `dish`, `section`, or `other` in the ignored `labels.jsonl`. Each labeled row must retain its language and source fields (`sourceName`, `sourceUrl`, `license`, `licenseUrl`, `permissionBasis`, `approvedForModelRelease`, and `commercialUseApproved`). The trainer rejects rows without commercial and weight-release approval.
3. Run `npm run model:train`. It trains one standard-library character n-gram Naive Bayes model per language present, reports precision/recall/F1 by label, and writes weights to `public/models/menu-line-classifier.json` for English and `menu-line-classifier-fi.json` / `menu-line-classifier-sv.json` when those datasets exist. It uses a deterministic source-held-out split when at least five source groups are available; otherwise it marks its exact-text split as a weak fallback. The FNDDS baseline reports 90.2% accuracy but only 21.6% precision for its section label, so the classifier must not decide category headings alone; those remain grounded in explicit page structure and rules.
4. Do not commit `data/private-menu-training/`. The weights include source/license metadata and can be distributed commercially only when every source permits commercial use; keep source attribution in the app and published documentation.

The browser requests the 235 KB English line-classifier weights during idle time, unless the device reports data saver or a 2G connection, and applies them locally as a conservative filter. Image OCR uses the separate Apache-2.0 Tesseract.js engine with pinned `tessdata_fast` language weights, loaded only when a likely menu image is found because the first engine-and-language download is several megabytes. If a language classifier is unavailable, current rules still work. Menu text is not sent to the model-training source, an AI service, or Lunumi servers. Dietary labels still come only from explicit page text. The app always shows the restaurant page used so users can verify current details.

## Future data collection

For real Finnish, Swedish, or English menu-page training, use restaurant-provided samples or source feeds whose terms explicitly allow commercial model training and weight release. Keep a separate restaurant-level holdout set for evaluation. Record the exact source URL, retrieval date, language, license, review evidence, and permission basis for every source. Never infer allergy safety from the model.
