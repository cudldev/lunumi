import { ModelAccess } from './use-model-readiness';
import { currentModelConfig, currentModelSize } from './conversation-config';
import { useContext, useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import { filterNearby, webDirectionsUrl, type Place } from './core';
import { matchingItems, menuSources, readRestaurantMenu, understand } from './chat-tools';
import type { MenuItem, MenuSource } from './menu-data';
import './chat-assistant.css';
import { AssistantState } from './AssistantState';
import { constrainedRestaurantQuery, hasVisited, normalizeFoodQuery, recommendPlaces } from './recommendations';
import { buildConversation } from './ai-context';
import { runAgent } from './browser-agent';
import { browserConversation, type LocalConversation } from './local-conversation';

type Message = { role: 'user' | 'assistant'; text: string; ai?: boolean; directions?: { name: string; url: string }; reasons?: Record<string, string>; places?: Place[]; items?: MenuItem[]; source?: MenuSource; links?: MenuSource[] };
type Menu = Awaited<ReturnType<typeof readRestaurantMenu>>;
type Props = { places: Place[]; initialPlace?: Place; floating?: boolean; onOpenPlace?: (place: Place) => void; onNavigate?: (destination: 'discover' | 'profile' | 'together' | 'map') => void };
const greeting = 'Hi, I’m Lunumi. We can chat, talk about food, or explore nearby places and menus. Menu tools work right away; normal conversation loads a private AI on your device the first time.';

export default function ChatAssistant({ places: providedPlaces, initialPlace, floating, onNavigate, onOpenPlace: openPlaceProp }: Props) {
  const appState = useContext(AssistantState), model = useContext(ModelAccess);
  const places = appState ? [...new Map([...(initialPlace ? [initialPlace] : []), ...appState.nearby].map(place => [place.id, place])).values()] : providedPlaces;
  const history = appState?.history || [], preferences = appState?.preferences || { likes: [], dislikes: [], learn: false };
  const discoverablePlaces = appState?.hideUnknownDietary ? [] : places;
  const noMatches = appState?.hideUnknownDietary ? 'Your Profile setting hides places with unknown dietary compatibility. Confirm details with the restaurant or change that filter in Profile.' : 'No matching nearby records. Set a location or widen the search radius in Discover.';
  const onOpenPlace = openPlaceProp || appState?.openPlace;
  const [open, setOpen] = useState(!floating), [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', text: initialPlace ? `Let’s explore ${initialPlace.name}. Ask me to show the menu, list items, or find explicitly marked vegan dishes.` : greeting }]);
  const [selected, setSelected] = useState(initialPlace), [busy, setBusy] = useState(false), [activity, setActivity] = useState('');
  const ai = useRef<LocalConversation | null>(null);
  const agentMemory = useRef<unknown[]>([]);
  const cache = useRef(new Map<string, Menu>()), request = useRef<AbortController | null>(null), end = useRef<HTMLDivElement>(null);
  useEffect(() => () => { request.current?.abort(); ai.current?.releaseIdle(); }, []);
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: 'nearest' }); }, [messages, busy, open]);
  const reply = (message: Omit<Message, 'role'>) => setMessages(old => [...old, { role: 'assistant' as const, ...message }].slice(-40));

  async function send(value: string, tool = false) {
    const text = value.trim().slice(0, 500);
    if (!text || request.current || (!tool && model && !model.ready)) return;
    setInput('');
    setMessages(old => [...old, { role: 'user' as const, text }].slice(-40));
    if (!tool) { await answerAI(text); return; }
    if (text === 'Recommend somewhere new') {
      const choices = recommendPlaces(discoverablePlaces, history, preferences);
      agentMemory.current = [...agentMemory.current, { tool: 'recommend_restaurants', result: choices.map(choice => ({ id: choice.place.id, name: choice.place.name, reason: choice.reason })) }].slice(-4);
      reply({ text: choices.length ? 'Places not marked visited, ranked using your preferences and history.' : noMatches, places: choices.map(choice => choice.place), reasons: Object.fromEntries(choices.map(choice => [choice.place.id, choice.reason])) }); return;
    }
    const named = places.filter(place => text.toLowerCase().includes(place.name.toLowerCase()));
    const routingText = named.length === 1 ? text.toLowerCase().replace(named[0].name.toLowerCase(), '') : text;
    const intent = understand(routingText);
    if (intent.kind === 'safety') { reply({ text: 'I can show explicit dietary labels and source allergen notes, but I cannot verify allergy safety, missing ingredients, or cross-contamination. Confirm directly with the restaurant.' }); return; }
    if (intent.kind === 'navigate') {
      if (intent.destination === 'together') { reply({ text: 'Together is not available in this version.' }); return; }
      if (onNavigate && intent.destination) { onNavigate(intent.destination); setOpen(false); reply({ text: `Opened ${intent.destination}.` }); }
      else reply({ text: 'Use the main navigation to open Profile, Together, Map, or Discover.' });
      return;
    }
    if (intent.kind === 'help') { reply({ text: greeting }); return; }
    // A named restaurant in a menu request overrides the previous selection.
    const target = named.length === 1 ? named[0] : selected && places.find(place => place.id === selected.id);
    if (intent.kind === 'places') {
      const matches = filterNearby(discoverablePlaces, intent.term).slice(0, 8);
      agentMemory.current = [...agentMemory.current, { tool: 'search_restaurants', result: matches.map(place => ({ id: place.id, name: place.name })) }].slice(-4);
      reply({ text: matches.length ? 'Here are matching places from your current nearby results. Choose one to explore its menu.' : places.length ? 'No restaurant matched that request. Try a restaurant name or cuisine, or ask “help” for supported tasks.' : 'Set a location in Discover and wait for nearby results, then ask me again.', places: matches });
      return;
    }
    if (!target) { reply({ text: 'Choose a restaurant first. These are from your current nearby results.', places: places.slice(0, 8) }); return; }
    setSelected(target);
    const controller = new AbortController(); request.current = controller; setBusy(true);
    setActivity('Reading restaurant sources…');
    const timeout = window.setTimeout(() => controller.abort('timeout'), 20_000);
    try {
      const menu = cache.current.get(target.id) || await readRestaurantMenu(target, controller.signal);
      controller.signal.throwIfAborted();
      cache.current.set(target.id, menu);
      const items = intent.kind === 'items' ? matchingItems(menu, intent.term) : menu.items;
      reply({ text: `${target.name}: ${items.length ? `${items.length} extracted entries${intent.term ? ` matching “${intent.term}”` : ''}.` : 'No extracted entries match that request.'} This may be incomplete or out of date; verify the source.${menu.notes.length ? ` Menu notes: ${menu.notes.join(' ')}` : ''}`, items, source: menu.source });
    } catch (error) {
      reply({ text: controller.signal.aborted ? controller.signal.reason === 'timeout' ? 'Menu search timed out. You can retry or open a source below.' : 'Menu search cancelled.' : error instanceof Error ? error.message : 'Could not read the menu.', links: menuSources(target) });
    } finally { window.clearTimeout(timeout); if (request.current === controller) { request.current = null; setBusy(false); } }
  }

  async function answerAI(text: string) {
    const controller = new AbortController(); request.current = controller; setBusy(true);
    setActivity('Preparing private AI on this device…');
    let partial = '', added = false;
    const display = (value: string) => {
      if (controller.signal.aborted) return;
      if (!added) { added = true; reply({ text: value, ai: true }); }
      else setMessages(old => [...old.slice(0, -1), { ...old[old.length - 1], text: value }]);
    };
    try {
      ai.current ||= browserConversation;
      const turns = [...messages, { role: 'user' as const, text }];
      // Rank the catalog for the planner without letting a generated URL become a fetch target.
      const names = places.filter(place => text.toLowerCase().includes(place.name.toLowerCase()));
      const catalog = [...new Map([...(selected ? [selected] : []), ...names, ...places].map(place => [place.id, place])).values()];
      const records = catalog.map(place => ({ id: place.id, name: place.name, cuisine: place.tags.cuisine, distanceMetres: Math.round(place.distance), visited: hasVisited(history, place.id), feedback: preferences.learn ? history.find(entry => entry.id === place.id)?.sentiment : undefined }));
      const toolResults = await runAgent({ turns, records, selectedId: selected?.id, previousResults: agentMemory.current, signal: controller.signal, compact: currentModelSize() === 'compact',
        plan: prompt => ai.current!.answer(prompt, controller.signal, event => { if (event.type === 'status') setActivity(event.text); }, 'plan'),
        execute: async action => {
          setActivity('Using ' + action.tool.replace(/_/g, ' ') + '…');
          if (action.tool === 'recommend_restaurants') {
            const requireNew = /\b(new|unvisited|not visited|haven.t visited|never been)\b/i.test(text);
            const choices = recommendPlaces(discoverablePlaces, history, preferences, constrainedRestaurantQuery(action.query, text, discoverablePlaces), action.unvisited || requireNew);
            reply({ text: choices.length ? 'Recommendations from current nearby results.' : noMatches, places: choices.map(choice => choice.place), reasons: Object.fromEntries(choices.map(choice => [choice.place.id, choice.reason])) });
            return choices.map(choice => ({ id: choice.place.id, name: choice.place.name, cuisine: choice.place.tags.cuisine, reason: choice.reason, markedVisited: hasVisited(history, choice.place.id), distanceMetres: Math.round(choice.place.distance) }));
          }
          if (action.tool === 'search_restaurants') {
            const terms = constrainedRestaurantQuery(action.query, text, discoverablePlaces).split(/\s+/).filter(Boolean);
            const matches = discoverablePlaces.filter(place => terms.every(term => filterNearby([place], term).length)).slice(0, 8);
            reply({ text: matches.length ? 'Matching nearby places. Select one for menu context, or open its restaurant card.' : noMatches, places: matches });
            return matches.map(place => ({ id: place.id, name: place.name, cuisine: place.tags.cuisine, distanceMetres: Math.round(place.distance) }));
          }
          const target = places.find(place => place.id === action.id);
          if (!target) throw new Error('This restaurant is no longer in nearby results. Search again.');
          setSelected(target);
          if (action.tool === 'get_directions') {
            const url = webDirectionsUrl(target); reply({ text: 'Directions to ' + target.name + '. Open the link to choose your route.', directions: { name: target.name, url } });
            return { restaurant: target.name, directionsLink: url };
          }
          if (action.tool === 'open_restaurant') {
            if (initialPlace?.id === target.id) { reply({ text: 'You are already viewing the restaurant card for ' + target.name + '.' }); return { restaurantCardAlreadyOpen: target.name }; }
            if (!onOpenPlace) throw new Error('You are already in the restaurant card.');
            reply({ text: 'Opened the restaurant card for ' + target.name + '.' });
            onOpenPlace(target); if (floating) setOpen(false);
            return { openedRestaurantCard: target.name, id: target.id };
          }
          let loaded = cache.current.get(target.id);
          if (!loaded) {
            const fetchController = new AbortController(), abort = () => fetchController.abort();
            controller.signal.addEventListener('abort', abort, { once: true });
            const timeout = window.setTimeout(abort, 20_000);
            try { loaded = await readRestaurantMenu(target, fetchController.signal); cache.current.set(target.id, loaded); }
            catch (error) { reply({ text: 'Menu source could not be read. Open a published source to check it.', links: menuSources(target) }); throw error; }
            finally { window.clearTimeout(timeout); controller.signal.removeEventListener('abort', abort); }
          }
          const items = action.tool === 'list_items' ? matchingItems(loaded, normalizeFoodQuery(action.query.toLowerCase().split(target.name.toLowerCase()).join(' '))) : loaded.items;
          const sections = [...new Set(items.map(item => item.section).filter(Boolean))].slice(0, 6);
          reply({ text: target.name + ': ' + items.length + ' extracted entries' + (sections.length ? ' across ' + sections.join(', ') : '') + '. Prices and details below come from the published source; check its dates and availability.', items, source: loaded.source });
          return { restaurant: target.name, source: loaded.source.url, notes: loaded.notes, entries: items.slice(0, 30).map(item => ({ name: item.name, section: item.section, price: item.price, description: item.description, dietaryClaims: item.diets, allergenNotes: item.allergenInfo })) };
        },
      });
      agentMemory.current = [...agentMemory.current, ...toolResults].slice(-4);
      const successful = toolResults.some(result => result && typeof result === 'object' && 'result' in result);
      if (toolResults.length && !successful) {
        const selection = toolResults.find(result => result && typeof result === 'object' && 'candidates' in result) as { error: string; candidates: string[] } | undefined;
        reply({ text: selection?.error || 'I could not verify the requested restaurant information. Use the source links or select a restaurant and retry.', places: selection ? places.filter(place => selection.candidates.includes(place.id)) : undefined }); return;
      }
      // Tool replies already render verified records and menu facts. Avoid re-inventing them in generated prose.
      if (successful) return;
      // Ordinary conversation gets a short prompt; restaurant facts enter through verified tool outputs.
      const answer = await ai.current.answer(buildConversation(turns, /\b(menu|dish|price|restaurant|meal)\b/i.test(text) ? JSON.stringify(agentMemory.current) : '[]'), controller.signal, event => {
        if (event.type === 'status') setActivity(event.text);
        if (event.type === 'token') { partial += event.text; display(partial); }
      });
      display(answer);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The private AI could not answer.';
      // Keep partial output visibly marked as incomplete, and leave the tool controls usable.
      const failed = partial ? partial + '\n\n[Reply interrupted] ' + detail : detail + ' Menu search and item lists are still available.';
      if (added) setMessages(old => [...old.slice(0, -1), { ...old[old.length - 1], text: failed }]);
      else reply({ text: failed });
    } finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }

  return <div className={floating ? 'chat-floating' : 'chat-inline'}>
    {floating && !open && <button className="button chat-launch" onClick={() => setOpen(true)} aria-label="Open Lunumi chat"><MessageCircle size={19}/>Ask Lunumi</button>}
    {open && <section className="chat-panel" aria-label="Lunumi chat assistant" onKeyDown={event => { if (event.key === 'Escape' && floating) setOpen(false); }}>
      <header className="chat-heading"><div><strong><MessageCircle size={17}/>Lunumi chat</strong><small>Private AI chat · menu tools</small></div>{floating && <button className="icon-button" aria-label="Close chat" onClick={() => setOpen(false)}><X size={18}/></button>}</header>
      {selected && <p className="chat-context">Menu context: {selected.name}{!initialPlace && <button className="text-button" disabled={busy} onClick={() => setSelected(undefined)}>Change restaurant</button>}</p>}
      <div className="chat-messages" role="log" aria-label="Conversation" aria-live="polite" aria-busy={busy}>
        {messages.map((message, index) => <article className={`chat-message chat-${message.role}`} key={index}><small>{message.role === 'user' ? 'You' : message.ai ? 'Lunumi · AI' : 'Lunumi'}</small><p>{message.text}</p>
          {message.places?.map((place, placeIndex) => <div className="chat-place-result" key={place.id}><button className="chat-place" disabled={busy} onClick={() => { setSelected(place); reply({ text: 'Selected ' + place.name + '. Ask about its lunch or menu, or use the menu buttons.' }); }}>{placeIndex + 1}. {place.name}<small>{place.tags.cuisine || 'Cuisine not listed'} · {Math.round(place.distance)} m</small>{message.reasons?.[place.id] && <small>{message.reasons[place.id]}</small>}</button>{onOpenPlace && <button className="text-button chat-open-card" disabled={busy} onClick={() => { setSelected(place); onOpenPlace(place); if (floating) setOpen(false); }}>Open restaurant card ↗</button>}</div>)}
          {!!message.items?.length && <ul className="chat-items">{message.items.map((item, itemIndex) => <li key={itemIndex}>{item.section && <small>{item.section}</small>}<strong>{item.name} {item.price}</strong>{item.description && <p>{item.description}</p>}<span>{item.diets.join(' · ') || 'Dietary details not stated'}</span>{item.allergenInfo.map((note, i) => <p key={i}>{note}</p>)}<details><summary>Source text</summary><p>{item.sourceText}</p></details></li>)}</ul>}
          {message.directions && <a href={message.directions.url} target="_blank" rel="noopener noreferrer">Directions to {message.directions.name} ↗</a>}
          {message.source && <a href={message.source.url} target="_blank" rel="noopener noreferrer">Verify menu source ↗</a>}
          {message.links?.map(link => <a className="chat-source" key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>)}
        </article>)}
        {busy && <p role="status">{activity} <button className="text-button" onClick={() => request.current?.abort()}>Cancel</button></p>}<div ref={end}/>
      </div>
      <div className="chat-suggestions">{(selected ? ['Show menu', 'List items', 'Find vegan items'] : ['Recommend somewhere new', 'List nearby restaurants', 'Help']).map(text => <button key={text} disabled={busy} onClick={() => void send(text, true)}>{text}</button>)}</div>
      {model && !model.ready && <p className="chat-context">Private AI is paused. Menu tools still work. <button className="button small" onClick={model.retry}>Enable private AI ({model.download})</button></p>}
      <form className="chat-composer" onSubmit={event => { event.preventDefault(); void send(input); }}><input aria-label="Message Lunumi" disabled={!!model && !model.ready} placeholder="Chat or ask about places and menus…" maxLength={500} value={input} onChange={event => setInput(event.target.value)}/><button className="button" type="submit" disabled={busy || !input.trim() || (!!model && !model.ready)} aria-label="Send message"><Send size={17}/></button></form>
      <footer className="chat-footer"><button className="text-button" disabled={busy} onClick={() => { cache.current.clear(); agentMemory.current = []; ai.current?.releaseIdle(); ai.current = null; setSelected(initialPlace); setMessages([{ role: 'assistant', text: greeting }]); }}>Clear chat</button><small>AI runs here · first use downloads ~{currentModelConfig().download}. Chat stays on this device.</small></footer>
    </section>}
  </div>;
}
