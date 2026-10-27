import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import { filterNearby, type Place } from './core';
import { matchingItems, menuSources, readRestaurantMenu, understand } from './chat-tools';
import type { MenuItem, MenuSource } from './menu-data';
import './chat-assistant.css';

type Message = { role: 'user' | 'assistant'; text: string; places?: Place[]; items?: MenuItem[]; source?: MenuSource; links?: MenuSource[] };
type Menu = Awaited<ReturnType<typeof readRestaurantMenu>>;
type Props = { places: Place[]; initialPlace?: Place; floating?: boolean; onNavigate?: (destination: 'discover' | 'profile' | 'together' | 'map') => void };
const greeting = 'I can find nearby restaurants, help you read their menus, and list matching menu items. Try “Find Italian restaurants” or choose a restaurant and ask “Show menu”.';

export default function ChatAssistant({ places, initialPlace, floating, onNavigate }: Props) {
  const [open, setOpen] = useState(!floating), [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', text: initialPlace ? `Let’s explore ${initialPlace.name}. Ask me to show the menu, list items, or find explicitly marked vegan dishes.` : greeting }]);
  const [selected, setSelected] = useState(initialPlace), [busy, setBusy] = useState(false);
  const cache = useRef(new Map<string, Menu>()), request = useRef<AbortController | null>(null), end = useRef<HTMLDivElement>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: 'nearest' }); }, [messages, busy, open]);
  const reply = (message: Omit<Message, 'role'>) => setMessages(old => [...old, { role: 'assistant' as const, ...message }].slice(-40));

  async function send(value: string) {
    const text = value.trim().slice(0, 500);
    if (!text || request.current) return;
    setInput('');
    setMessages(old => [...old, { role: 'user' as const, text }].slice(-40));
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
      const matches = filterNearby(places, intent.term).slice(0, 8);
      reply({ text: matches.length ? 'Here are matching places from your current nearby results. Choose one to explore its menu.' : places.length ? 'No restaurant matched that request. Try a restaurant name or cuisine, or ask “help” for supported tasks.' : 'Set a location in Discover and wait for nearby results, then ask me again.', places: matches });
      return;
    }
    if (!target) { reply({ text: 'Choose a restaurant first. These are from your current nearby results.', places: places.slice(0, 8) }); return; }
    setSelected(target);
    const controller = new AbortController(); request.current = controller; setBusy(true);
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

  return <div className={floating ? 'chat-floating' : 'chat-inline'}>
    {floating && !open && <button className="button chat-launch" onClick={() => setOpen(true)} aria-label="Open Lunumi chat"><MessageCircle size={19}/>Ask Lunumi</button>}
    {open && <section className="chat-panel" aria-label="Lunumi chat assistant" onKeyDown={event => { if (event.key === 'Escape' && floating) setOpen(false); }}>
      <header className="chat-heading"><div><strong><MessageCircle size={17}/>Lunumi chat</strong><small>Local task assistant · no AI model required</small></div>{floating && <button className="icon-button" aria-label="Close chat" onClick={() => setOpen(false)}><X size={18}/></button>}</header>
      {selected && <p className="chat-context">Menu context: {selected.name}{!initialPlace && <button className="text-button" disabled={busy} onClick={() => setSelected(undefined)}>Change restaurant</button>}</p>}
      <div className="chat-messages" role="log" aria-label="Conversation" aria-live="polite" aria-busy={busy}>
        {messages.map((message, index) => <article className={`chat-message chat-${message.role}`} key={index}><small>{message.role === 'user' ? 'You' : 'Lunumi'}</small><p>{message.text}</p>
          {message.places?.map(place => <button className="chat-place" key={place.id} disabled={busy} onClick={() => { setSelected(place); reply({ text: `Selected ${place.name}. Ask “Show menu”, “List items”, or “Find vegan items”.` }); }}>{place.name}<small>{place.tags.cuisine || 'Cuisine not listed'} · {Math.round(place.distance)} m</small></button>)}
          {!!message.items?.length && <ul className="chat-items">{message.items.map((item, itemIndex) => <li key={itemIndex}>{item.section && <small>{item.section}</small>}<strong>{item.name} {item.price}</strong>{item.description && <p>{item.description}</p>}<span>{item.diets.join(' · ') || 'Dietary details not stated'}</span>{item.allergenInfo.map((note, i) => <p key={i}>{note}</p>)}<details><summary>Source text</summary><p>{item.sourceText}</p></details></li>)}</ul>}
          {message.source && <a href={message.source.url} target="_blank" rel="noopener noreferrer">Verify menu source ↗</a>}
          {message.links?.map(link => <a className="chat-source" key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>)}
        </article>)}
        {busy && <p role="status">Reading restaurant sources… <button className="text-button" onClick={() => request.current?.abort()}>Cancel</button></p>}<div ref={end}/>
      </div>
      <div className="chat-suggestions">{(selected ? ['Show menu', 'List items', 'Find vegan items'] : ['List nearby restaurants', 'Help']).map(text => <button key={text} disabled={busy} onClick={() => void send(text)}>{text}</button>)}</div>
      <form className="chat-composer" onSubmit={event => { event.preventDefault(); void send(input); }}><input aria-label="Message Lunumi" placeholder="Ask about places or menus…" maxLength={500} value={input} onChange={event => setInput(event.target.value)}/><button className="button" type="submit" disabled={busy || !input.trim()} aria-label="Send message"><Send size={17}/></button></form>
      <footer className="chat-footer"><button className="text-button" disabled={busy} onClick={() => { cache.current.clear(); setSelected(initialPlace); setMessages([{ role: 'assistant', text: greeting }]); }}>Clear chat</button><small>Chat stays in memory. Restaurant sources receive normal page requests.</small></footer>
    </section>}
  </div>;
}
