# Lunumi chat assistant

Lunumi has a local, task-based chatbot in **Ask Lunumi** on every main screen and inside restaurant details. It does not download or run Qwen3 or any other language model. It supports a defined set of English requests rather than unrestricted AI conversation.

## Supported tasks

- Find restaurants by name, cuisine, or mapped food tags using the current nearby results; choose a result as the menu context.
- Ask **Show menu**, **List items**, or **Find vegan items**. A selected restaurant stays in context for follow-up requests. An exact restaurant name in a menu request overrides the selection.
- Filter extracted items by text or explicit vegan, vegetarian, gluten-free, dairy-free, or halal labels.
- Open Profile, Map/history, or the Discover location picker through chat. Together is not available in this version.
- Clear the conversation and extracted-menu cache, or cancel a menu request. Closing chat preserves its current session; reloading clears it.

## Sources and extraction

Only listed restaurant links are fetched, following a user request. Lunch feeds precede menu feeds, specific menu URLs, and the website. Website pages can lead to up to four same-site lunch/menu links. Discovered links are tried before accepting the original page. A search makes at most five requests and times out after 20 seconds. Each response is read up to 500,000 characters; redirects use the final source URL.

RSS, Atom, JSON Feed, HTML, and plain text are processed by local rules in Finnish, Swedish, and English. Recognized sections, names, descriptions, simple currency prices, explicit dietary labels, and allergen notes are displayed with source excerpts and a verification link. Standalone allergen statements remain menu-level notes. Dietary codes are interpreted only when the same source defines them. Missing labels remain unknown; ingredients and allergy safety are never inferred.

## Privacy and limitations

Chat and extracted menus stay in component memory, outside IndexedDB, profile exports, and restaurant datasets. No conversation, preferences, or menu text is sent to an AI service. Restaurant fetches omit credentials and the referrer; the destination still receives normal network metadata. Google review content is not fetched or summarized.

Nearby search must already have loaded results. Chat searches only those places and the selected restaurant's extracted items; it does not scan every restaurant's dishes. Restaurant results are limited to eight per reply and extracted menus to 100 items. Requests use task rules and may require rephrasing; arbitrary questions, general food knowledge, reservations, and live opening status are unsupported. Finnish/Swedish parsing does not mean Finnish/Swedish chat requests are supported.

Browser cross-origin restrictions, PDF/image menus, and JavaScript-rendered pages can prevent reading. The assistant offers source links on failure. Extraction is heuristic and may retain unrelated text, misattach descriptions, or miss dishes. Menus and mapped restaurant data can be incomplete or stale; confirm details directly with the restaurant, especially for allergies.

## Files

- Chat interface and session context: src/ChatAssistant.tsx; styles: src/chat-assistant.css.
- Task routing, source selection, item filtering, fetching: src/chat-tools.ts.
- Multilingual extraction and link discovery: src/menu-data.ts.
- Restaurant placement: src/MenuAssistant.tsx and src/PlaceCard.tsx; global placement: src/App.tsx.

The current assistant does not load the former Qwen model or menu line classifiers. Their experimental sources and training tools remain in the repository.

## Separate conversation test

The optional `chat-test/` page tests on-device AI conversation without menu tools or source fetching. See [chatbot-test.md](chatbot-test.md); it does not change this menu assistant’s source or label handling.
