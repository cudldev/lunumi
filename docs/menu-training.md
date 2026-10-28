# Menu model training

The training scripts and classifier artifacts in this guide are historical experiments. The shipped assistant uses the shared SmolLM2 GPU worker and source-backed menu parser described in [menu-assistant.md](menu-assistant.md); it does not warm up or run the old menu classifiers. Prepared training datasets are not automatically used by the live model.

## Commercially reusable source

The English bootstrap corpus comes from USDA FoodData Central's FNDDS 2021–2023 survey-food records under CC0 1.0. NYC MenuStat adds historical restaurant item names and food categories under NYC Open Data public-use terms. The [official FAQ](https://www.nyc.gov/opendata/get-started/FAQs) says there are no restrictions on using NYC Open Data; the [City's data standards](https://cityofnewyork.github.io/opendatatsm/citystandards.html) ask that NYC data be attributed, and its [portal terms](https://data.cityofnewyork.us/stories/s/Terms-of-Use/k9k7-3cje) disclaim warranties of completeness and accuracy. MenuStat contains 65,219 historical rows across 94 chain restaurants; its menu data was last updated in 2019 and does not represent current menus. It can teach item-name vocabulary, not page layout or source discovery. The training workflow records provenance in ignored files and generated weights. Lunumi credits NYC DOHMH MenuStat and states its accuracy limitation in the app.

French weights can use [CROUStillant — Menus du CROUS](https://www.data.gouv.fr/datasets/menus-du-crous), published on data.gouv.fr by Paul Bayfield under the declared Licence Ouverte / Open Licence 2.0. The dataset describes menus at CROUS university restaurants in France and overseas; its page lists 22 October 2026 as the latest dataset update. Record the downloaded resource's actual modified date when refreshing the corpus. Retain attribution to CROUStillant, Paul Bayfield, and data.gouv.fr, plus the resource update date, in released weights and app documentation. This relies on the publisher's declared license and does not independently establish rights in every underlying menu record. It supports French menu-line classification tests, not broad extraction-quality claims.

Do not use the previously reviewed Souslab sample for production training: its CC BY-NC 4.0 license excludes commercial use of trained models without a separate commercial license. Any future input source must have documented rights for model training, releasing the weights, and commercial use. Public visibility or RSS availability is not permission. The RSS collector requires an explicit `commercialUseApproved: true` review gate as well as model-release approval, and rejects license labels that clearly indicate NonCommercial or NoDerivatives unless separate written permission is recorded.

The [GastroCorp menu corpus](https://zenodo.org/records/19183413) is another noncommercial-only source: its menu portion is under an academic-use agreement and CC BY-NC 4.0. It is useful only for a separately approved noncommercial experiment, not Lunumi's commercial model.

Do not treat a dataset's repository license as proof that its underlying menu text is cleared. For example, [`jdnvn/menu-items-allmenus`](https://huggingface.co/datasets/jdnvn/menu-items-allmenus) is labeled Apache-2.0, but its rows link to AllMenus and the dataset README is empty. [AllMenus' terms](https://www.allmenus.com/terms-conditions/) restrict use to personal, noncommercial purposes and prohibit scraping and systematic data mining. Exclude it unless the rights holder grants written permission for commercial model training and weight release.

Synthetic examples can help exercise formatting variants (prices, separators, line wrapping) if generated deterministically from commercially reusable source data and clearly marked synthetic. They cannot replace real menu pages for evaluating real-world extraction. Do not use OpenAI-generated outputs as training examples. Keep raw sources and labeled data in Git-ignored local storage.

## Local workflow

1. Run `npm run model:prepare`. It downloads the pinned USDA FNDDS JSON archive if needed, extracts it under `data/private-menu-training/`, and prepares English `dish`, `section`, and `other` examples, including 40 Lunumi-authored synthetic page-noise lines, in ignored `labels.jsonl`. To keep this corpus separate from other locally combined labels, pass another Git-ignored output path, for example `npm run model:prepare -- data/private-menu-training/fndds-labels.jsonl`.
2. Run `npm run model:prepare:menustat` to download NYC DOHMH's [historical MenuStat dataset](https://data.cityofnewyork.us/Health/MenuStat/qgc5-ecnb) and append restaurant-grouped English item-name and category examples to the private labels. NYC Open Data says its datasets have no use restrictions; its technical standards ask that NYC data be attributed, and the portal terms state it is provided without accuracy or completeness warranties. Lunumi credits NYC DOHMH MenuStat and notes this limitation in the app. Raw CSV and labels stay in Git-ignored storage.
3. For additional languages, create the ignored local manifest `data/menu-training-sources.local.json` and collect only sources with a verified commercial license, written permission, or official open-data reuse terms using `npm run model:collect`. A source entry looks like this:

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
4. Run `npm run model:train`. It trains one standard-library character n-gram Naive Bayes model per language present, reports precision/recall/F1 by label, and writes weights to `public/models/menu-line-classifier.json` for English and `menu-line-classifier-fi.json` / `menu-line-classifier-sv.json` when those datasets exist. It holds out distinct sources when at least five are present; otherwise it holds out item groups when the data provides at least five, and falls back to exact-text holdout only when neither grouped split can cover every label. Read the split and per-source group counts recorded in the generated model before interpreting metrics. The current English model was trained on 45,454 examples from USDA FNDDS (CC0), NYC MenuStat, and Lunumi-authored synthetic page-noise text. On 13,033 deterministic held-out groups (restaurant groups for MenuStat and food-category groups for FNDDS), it reports 95.3% accuracy, 99.8% dish precision and 95.4% recall, 64.9% `other` precision and 94.4% recall. The MenuStat holdout contains 15 of 94 restaurant IDs, with zero restaurant overlap between training and validation. At the app's `other` filter threshold (0.9), precision is 74.4% and dish retention 99.4% on 308 selected lines. This validates line classification on food/menu-item vocabulary, not extraction from full restaurant pages. The classifier must not decide category headings alone; those remain grounded in explicit page structure and rules.
5. Do not commit `data/private-menu-training/`. The weights include source/license metadata and can be distributed commercially only when every source permits commercial use; keep source attribution in the app and published documentation.

Parser regression tests use synthetic page structures and Lunumi-authored example text, not copied restaurant menus. They check extraction behavior but do not measure real-world menu accuracy. Real-world evaluation still requires source-cleared menu pages annotated with expected items, evaluated with restaurant-level holdouts.

The browser requests the 235 KB English line-classifier weights during idle time, unless the device reports data saver or a 2G connection, and applies them locally as a conservative filter. Finnish and Swedish weights are also bundled and load after language detection. Image OCR uses the separate Apache-2.0 Tesseract.js engine with pinned `tessdata_fast` language weights, loaded only when a likely menu image is found because the first engine-and-language download is several megabytes. If a language classifier is unavailable, current rules still work. Menu text is not sent to the model-training source, an AI service, or Lunumi servers. Dietary labels still come only from explicit page text. The app always shows the restaurant page used so users can verify current details.

The trainer also records precision and dish/section retention for the same `other` confidence threshold (`0.9`) used by the app. Use this to check false filtering behavior, but treat metrics from food-name or synthetic-only corpora as vocabulary checks, not restaurant-menu accuracy.

French classifier weights also load after language detection. The French weights are trained from CROUStillant item labels under its declared Open Licence 2.0; app UI and model metadata link to the source and carry its update date.

## French CROUStillant model

Save the current CROUStillant CSV to `data/private-menu-training/menus-du-crous.csv`, then run `npm run model:prepare:crous -- data/private-menu-training/menus-du-crous.csv 2026-10-27`, passing that resource's actual update date as the second argument. Preparation writes deduplicated French dish names, category headings, and meal labels grouped by restaurant ID, plus source/license metadata, to the ignored `crous-labels.jsonl` and manifest. Run `npm run model:train:crous` to hold out complete restaurant groups and write `public/models/menu-line-classifier-fr.json`. On the 27 October 2026 snapshot (7,207 menu rows, 454 restaurants, 5,114 deduplicated line labels), the holdout contained 93 restaurants with zero restaurant overlap: 90.1% accuracy, dish precision 94.8%/recall 90.5%, section precision 74.0%/recall 84.1%, and other precision 98.2%/recall 100%. The 90% other-line filter retained 99.7% of held-out dishes. These metrics measure line classification on this source; they do not validate extraction on unrelated restaurant pages.

The generative-model training data is separate from those line labels. Run `npm run model:prepare:crous:instruct -- data/private-menu-training/menus-du-crous.csv 2026-10-27` to make deterministic, French instruction/JSON pairs from real CROUS menu rows. Formatting variants are authored transforms; names and category labels come directly from the licensed source. All examples from a restaurant stay in one split, with about 20% of restaurant IDs held out for evaluation. This is a small first task dataset: three authored line-format variants per menu are not independent restaurant pages, and results do not establish extraction quality on arbitrary websites. The earlier Qwen3 training target is no longer the active assistant. Current model revisions, GPU requirements, privacy, and limitations are documented in menu-assistant.md.

### Fine-tune and evaluate the generative model

The repeatable LoRA workflow is in `training/menu-assistant/`. On Windows with an NVIDIA GPU and CUDA 12.8 support, install its isolated dependencies into the ignored private-data folder and run the scripts from the repository root:

```powershell
python -m venv data/private-menu-training/python-env
data/private-menu-training/python-env/Scripts/python.exe -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 -r training/menu-assistant/requirements.txt
data/private-menu-training/python-env/Scripts/python.exe training/menu-assistant/evaluate.py --limit 5 --output data/private-menu-training/base-eval.json
data/private-menu-training/python-env/Scripts/python.exe training/menu-assistant/train.py
data/private-menu-training/python-env/Scripts/python.exe training/menu-assistant/evaluate.py --adapter data/private-menu-training/qwen3-crous-lora --output data/private-menu-training/adapter-eval.json
```

Training reads only the ignored instruction JSONL, requires CUDA and bfloat16, verifies restaurant groups do not overlap, and saves the LoRA adapter and run manifest under `data/private-menu-training/`. Evaluation defaults to one deterministic format variant per unique held-out menu and round-robins restaurants; `--all-variants` evaluates all three authored formats. It reports strict JSON validity separately from complete responses recovered by keeping whole item objects from truncated output, plus exact item precision/recall/F1, section-pair recall, and source-quote grounding. A small `--limit` run is a smoke check only; compare full held-out results with the base model before adopting the adapter. The LoRA adapter is not used by the browser runtime yet. Do not commit training data, checkpoints, or generated adapter weights. This Windows training recipe is not the browser deployment/export pipeline.

## Finnish and Swedish bootstrap

The bundled Finnish and Swedish line-filter weights were trained from 4,238 Fineli food names and 4,238 generated menu-line combinations per language under CC BY 4.0, plus 70 Lunumi-authored CC0 synthetic page-noise lines per language. Their deterministic item-group-held-out results are not menu-page evaluation: Finnish achieved 99.4% accuracy, with 60.0% precision on only 15 held-out `other` examples; Swedish achieved 99.8% accuracy, with 82.4% precision on 15 held-out `other` examples. Regenerate them with `npm run model:prepare:fineli` and `npm run model:train:fineli`; the archive and labels remain Git-ignored. The app credits Fineli and THL when these weights are used. These examples are not restaurant menus and do not provide dietary or allergen facts.

## Future data collection

For real Finnish, Swedish, or English menu-page training, use restaurant-provided samples or source feeds whose terms explicitly allow commercial model training and weight release. Keep a separate restaurant-level holdout set for evaluation. Record the exact source URL, retrieval date, language, license, review evidence, and permission basis for every source. Never infer allergy safety from the model.
