# Menu model training

This guide describes historical classifier-training artifacts. The shipped assistant uses the shared SmolLM2 GPU worker and source-backed parser documented in menu-assistant.md. The app does not load the old menu classifiers.

## Commercially reusable source

The bootstrap corpus comes from USDA FoodData Central's FNDDS 2021–2023 survey-food records. USDA publishes FoodData Central data under CC0 1.0 and requests attribution. The training workflow records the source, release, and license in the ignored corpus and the generated model. This source is public-domain food data, not restaurant menu-page text; it teaches basic food-name versus category/noise distinctions, not site-specific menu layouts.

Do not use the previously reviewed Souslab sample for production training: its CC BY-NC 4.0 license excludes commercial use of trained models without a separate commercial license. Any future input source must have documented rights for model training, releasing the weights, and commercial use. Public visibility or RSS availability is not permission. The RSS collector requires an explicit `commercialUseApproved: true` review gate as well as model-release approval.

Synthetic examples can help exercise formatting variants (prices, separators, line wrapping) if generated deterministically from commercially reusable source data and clearly marked synthetic. They cannot replace real menu pages for evaluating real-world extraction. Do not use OpenAI-generated outputs as training examples. Keep raw sources and labeled data in Git-ignored local storage.

## Local workflow

1. Run `npm run model:prepare`. It downloads the pinned USDA FNDDS JSON archive if needed, extracts it under `data/private-menu-training/`, and prepares English `dish`, `section`, and `other` examples in ignored `labels.jsonl`.
2. Run `npm run model:train`. It trains the Node.js standard-library character n-gram Naive Bayes model, reports a deterministic 80/20 exact-text holdout evaluation, and writes only model weights to `public/models/menu-line-classifier.json` for the browser app. The evaluation is not restaurant-disjoint and is not a substitute for testing on real menus.
3. Do not commit `data/private-menu-training/`. The weights include source/license metadata and can be distributed commercially because their training source is CC0; keep the source attribution in the app and published documentation.

The browser downloads the small English weights only after the user presses **Find lunch menu** and applies them locally as a conservative filter. If weights fail to load, current rules still work. Menu text is not sent to the model-training source, an AI service, or Lunumi servers. Dietary labels still come only from explicit page text. The app always shows the restaurant page used so users can verify current details.

## Future data collection

For real Finnish, Swedish, or English menu-page training, use restaurant-provided samples or source feeds whose terms explicitly allow commercial model training and weight release. Keep a separate restaurant-level holdout set for evaluation. Record the exact source URL, retrieval date, language, license, review evidence, and permission basis for every source. Never infer allergy safety from the model.
