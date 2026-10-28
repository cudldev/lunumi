import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Search, Utensils, X } from 'lucide-react';
import type { Place } from './core';
import { matchingItems, menuSources, readRestaurantMenu } from './chat-tools';
import './restaurant-menu.css';

type Menu = Awaited<ReturnType<typeof readRestaurantMenu>>;
const filters = ['', 'vegan', 'vegetarian', 'gluten-free', 'dairy-free'] as const;

export default function MenuAssistant({ place }: { place: Place }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [diet, setDiet] = useState(''), [category, setCategory] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setMenu(null); setError(''); setQuery(''); setDiet(''); setCategory(''); setBusy(false);
    return () => { request.current?.abort(); request.current = null; };
  }, [place.id]);

  async function load() {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    const timer = window.setTimeout(() => controller.abort('timeout'), 20_000);
    try {
      const result = await readRestaurantMenu(place, controller.signal);
      controller.signal.throwIfAborted();
      if (request.current === controller) { setMenu(result); setCategory(''); }
    } catch (reason) {
      if (request.current === controller) setError(controller.signal.aborted ? controller.signal.reason === 'timeout' ? 'The menu took too long to load. Try again or open the restaurant source.' : 'Menu loading cancelled.' : reason instanceof Error ? reason.message : 'Could not read this menu.');
    } finally {
      window.clearTimeout(timer);
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }
  const categories = menu ? [...new Set(menu.items.map(item => item.section || 'Dishes'))] : [];
  const items = menu ? matchingItems(menu, diet).filter(item => (!category || (item.section || 'Dishes') === category) && `${item.name} ${item.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [];
  const groups = categories.map(name => ({ name, items: items.filter(item => (item.section || 'Dishes') === name) })).filter(group => group.items.length);
  const sources = menuSources(place);

  return <section className="restaurant-menu" aria-label={`${place.name} menu`}>
    <div className="restaurant-menu-heading"><div><span className="eyebrow">AT THE TABLE</span><h3><Utensils size={20}/>Explore the menu</h3></div>{menu && <button className="text-button" onClick={() => void load()} disabled={busy}>Refresh</button>}</div>
    {!menu && !busy && <div className="menu-intro"><p>Find your next dish. Browse the restaurant’s published menu by category, or look for something you love.</p><button className="button primary" disabled={!sources.length} onClick={() => void load()}>Browse menu</button>{!sources.length && <p>No restaurant menu source is listed yet.</p>}</div>}
    {busy && <div className="menu-loading" role="status"><span className="menu-loading-dot"/>Reading the restaurant’s menu…<button className="text-button" onClick={() => request.current?.abort()}><X size={14}/>Cancel</button></div>}
    {error && <p className="menu-error" role="alert">{error}</p>}
    {menu && <>
      <div className="menu-source-line"><span>{menu.items.length} items from the restaurant source</span><a href={menu.source.url} target="_blank" rel="noopener noreferrer">Original menu <ExternalLink size={12}/></a></div>
      <label className="menu-search"><Search size={17}/><input type="search" aria-label="Search dishes" placeholder="Search dishes or ingredients listed…" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <div className="menu-filter-row" role="group" aria-label="Dietary labels">{filters.map(value => <button key={value} className={diet === value ? 'active' : ''} aria-pressed={diet === value} onClick={() => setDiet(value)}>{value ? `Marked ${value}` : 'All dishes'}</button>)}</div>
      {categories.length > 1 && <div className="menu-filter-row menu-categories" role="group" aria-label="Menu categories"><button className={!category ? 'active' : ''} aria-pressed={!category} onClick={() => setCategory('')}>All categories</button>{categories.map(name => <button key={name} className={category === name ? 'active' : ''} aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>)}</div>}
      <p className="menu-result-count" role="status">{items.length} {items.length === 1 ? 'dish' : 'dishes'}{diet || query || category ? ' matching your filters' : ''}</p>
      {!items.length && <div className="menu-empty"><strong>No dishes match these filters.</strong><p>Try another search or check the original menu. Missing dietary labels mean unknown.</p><button className="text-button" onClick={() => { setQuery(''); setDiet(''); setCategory(''); }}>Clear filters</button></div>}
      {groups.map(group => <section className="menu-category" key={group.name} aria-label={group.name}><h4>{group.name}<span>{group.items.length}</span></h4><ul className="dish-grid">{group.items.map((item, index) => <li className="dish-card" key={`${item.name}-${index}`}><div className="dish-title"><h5>{item.name}</h5>{item.price && <span className="dish-price">{item.price}</span>}</div>{item.description && <p className="dish-description">{item.description}</p>}<div className="dish-labels">{item.diets.length ? item.diets.map(label => <span key={label}>{label}</span>) : <small>Dietary details not stated</small>}</div>{item.allergenInfo.map((note, i) => <p className="dish-allergen" key={i}>{note}</p>)}<details className="dish-evidence"><summary>Source excerpt</summary><p>{item.sourceText}</p></details></li>)}</ul></section>)}
      {!!menu.notes.length && <details className="menu-source-notes"><summary>Restaurant menu notes</summary>{menu.notes.map((note, index) => <p key={index}>{note}</p>)}</details>}
      <p className="menu-disclaimer">Extracted from the linked source; items and prices may have changed. Confirm dietary needs and allergies with the restaurant.</p>
    </>}
    {!menu && <div className="menu-source-links">{sources.map(source => <a href={source.url} key={source.url} target="_blank" rel="noopener noreferrer">{source.label}<ExternalLink size={12}/></a>)}</div>}
  </section>;
}
