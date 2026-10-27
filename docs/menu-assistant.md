# Browser AI and menu agent

**Ask Lunumi** combines a conversational LLM with browser tools. It appears on the main screens and inside restaurant details. Ordinary messages go to the model; quick menu buttons retrieve sources directly.

## Model and agent

- SmolLM2-1.7B-Instruct (Apache 2.0), pinned to revision 31b70e2e869a7173562077fd711b654946d38674, runs through Transformers.js 4.3.2 in a dedicated worker. Desktop preparation starts during onboarding and downloads about 1.4 GB of q4 weights plus tokenizer/runtime files from Hugging Face and its file CDN. Phones, touch iPads in desktop mode, and devices reporting at most 4 GB RAM use SmolLM2-360M-Instruct, revision a10cc1512eabd3dde888204e902eca88bddb4951 (about 390 MB of q4 weights), only after an explicit Enable private AI action. Device hints are conservative heuristics, not a memory-capacity check. Browser caching avoids repeat downloads when available. See the [model card](https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct) and [function-call format](https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct/blob/main/instructions_function_calling.md).
- WebGPU is preferred, with single-thread WASM when no adapter exists. Standard-model GPU initialization failures retry in a fresh CPU worker; compact-model GPU failures stop instead of automatically allocating a second runtime. CPU inference is slower; low-memory devices may fail. One worker is shared and kept ready across restaurant and global chat panels.
- The agent uses the model’s supported function-call envelope, then proposes validated actions: search nearby restaurants, recommend places from local history/preferences, open a restaurant card, provide directions, read its menu/lunch source, or list/filter menu items. The app validates tool names and restaurant IDs before executing them. Restaurant-specific menu questions require a real menu-tool result even when the model proposes answering from memory; failed retrieval is not replaced with a guessed menu. Generated URLs are never fetch targets. Each turn allows at most three actions and prevents identical repeated actions.
- Restaurant results are linked to real site records. **Open restaurant card** opens the matching in-app card without marking it visited. Recommendations rank explicit cuisine preferences and, when learning is enabled, cuisines from Loved/favorite and disliked history. New-place results exclude IDs marked visited or carrying a past visit timestamp; this means not recorded as visited, not proof of never having been there. Disabling learning removes feedback from ranking. The existing Profile setting to hide unknown dietary compatibility also applies to agent searches and recommendations. Directions links use the exact public restaurant coordinates and open Maps on request. Recommendations use available cuisine, distance, and source facts; the agent does not have Google reviews or verified live opening status.
- Recent conversation and bounded tool receipts provide context, including the order of previously shown recommendations. Normal AI conversation streams; restaurant-tool answers render verified records, categories, prices, source excerpts, and links directly instead of letting the LLM rewrite or invent those facts. General replies do not acquire unrelated menu-source citations. The small local model can still misunderstand requests or make mistakes; source-linked entries remain available to verify restaurant facts.

## Startup readiness

Onboarding forms remain usable during preparation and save independently. AI only becomes ready after model loading and a real one-token inference check; download progress alone never counts as readiness. Progress, pause/resume, errors, and retry are visible. **Continue without AI** stops the worker and remembers that choice; discovery, recommendations via quick buttons, and menu/item tools remain available, while free conversation requires explicitly enabling AI from chat. No hosted conversation fallback is used.

Mobile/low-memory devices do not automatically load a model. A local pending-work flag also pauses automatic loading after an interrupted startup or generation, including an ordinary reload during active work; it cannot establish the cause of a crash. Completed/failed/cancelled work clears the flag. This prevents automatic retry loops when a browser kills the whole tab without delivering a worker error. Storage restrictions can prevent recovery flags from persisting. Even the compact model may exceed a phone's memory limit, and its language/tool decisions are less reliable. Returning desktop visits normally check cached files and inference unless loading was deferred or interrupted. Cache eviction can require another download. The standalone chatbot test uses the same device and recovery policy.

## Internet menus and extraction

Listed lunch feeds precede menu feeds, specific menu URLs, and restaurant websites. Website discovery tries up to four same-site menu links before accepting the original page. Each search allows five page requests, 20 seconds total, and at most 500,000 source characters per response. Redirects preserve the final source link. The source order is best effort; this is not a general web search engine.

When VITE_MENU_READER_URL is configured, the browser posts only the public restaurant URL to the existing allowlisted menu-reader Worker. The Worker fetches public HTTPS sources without restaurant cookies or authorization and stores no page content. Without that setting, direct browser CORS requests are used. The deployment workflow already provides the staging/production variables. For local development use the configured /v1/menu endpoint and localhost:5173, an approved Worker origin.

HTML, RSS, Atom, JSON Feed, and plain text are parsed locally with Finnish, Swedish, and English rules. Entries retain sections, names, descriptions, simple currency prices, source excerpts, explicit dietary labels, and allergen notes. Known menu navigation and gift-card rows are excluded; long priced continuation descriptions can attach to a preceding unpriced dish, with the original text retained. Negated dietary phrases are not promoted to positive labels. Source-defined dietary codes can be interpreted; unexplained codes and missing details remain unknown. Standalone allergen notes apply to the menu, not every dish. The app never infers ingredients, dietary suitability, or allergy safety. Labels describe source claims, not verified safety.

PDF/image menus, JavaScript-only pages, unsupported layouts, blocked sources, and unlisted menu hosts may remain unreadable. Failed searches show source links. The agent can explain the available extracted entries but must not invent missing dishes or claim today's availability without source evidence. Menu dates, prices, and completeness should be verified with the restaurant.

## Privacy and controls

Conversation and extracted menus stay in memory, outside IndexedDB, profile exports, and restaurant datasets. No chat, profile notes, or menu text is sent to a hosted AI service. Model downloads expose normal request metadata to Hugging Face/CDN hosts. Menu retrieval sends the public source URL to the configured Worker and normal request metadata to restaurant hosts; direct requests omit credentials and referrers. Google review content is not fetched or summarized.

Cancel terminates active AI work or menu retrieval. Model startup is limited to six minutes; generation with no further tokens stops after 90 seconds. Clear chat removes conversation/menu state. The main app keeps the ready model in memory; the standalone chatbot test explicitly releases its model on Clear. Model download caches can remain in browser storage and may be evicted by the browser. Closing the panel preserves the current session; reloading clears the conversation. Menu lists are limited to 100 extracted entries, result replies to eight restaurants, and AI context to bounded recent turns/tool output.

## Files and checks

- Chat and card handoff: src/ChatAssistant.tsx, src/App.tsx, src/MenuAssistant.tsx.
- Agent planning and action validation: src/browser-agent.ts; history ranking: src/recommendations.ts; shared local context: src/AssistantState.tsx; prompt context: src/ai-context.ts.
- Startup gate: src/ModelSetupScreen.tsx, src/use-model-readiness.ts, src/model-state.ts, src/model-recovery.ts.
- Local runtime: src/local-conversation.ts, src/conversation.worker.ts, src/conversation-config.ts.
- Menu retrieval and parsing: src/chat-tools.ts, src/menu-data.ts; service: menu-reader-worker/.
- Run npm run typecheck, npm test, npm run build. The optional scripts/verify-private-ai.mjs smoke test (Node 24) downloads model weights into the ignored .ai-smoke-cache directory and checks actual conversation memory and agent decisions. Add --compact to check the mobile model.

## Separate conversation test

The optional `chat-test/` page runs AI conversation without restaurant tools. See [chatbot-test.md](chatbot-test.md).
