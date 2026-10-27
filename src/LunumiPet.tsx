import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Send, X } from 'lucide-react';
import type { Place } from './core';
import { chatWithLocalAssistant, prepareLocalMenuModel, type MenuAssistantTurn, type MenuModelPreferences, type MenuModelProgress } from './menu-llm';
import { isLunumiRequest, lunumiScopeReply } from './assistant-scope';
import { sourcesForAnswer } from './assistant-sources';

type Props = { places: Place[]; preferences: MenuModelPreferences };
type ChatMessage = MenuAssistantTurn & { id: number; sources?: Array<{ name: string; url: string }> };
type LocalMenuCache = { sourceUrl: string; resolvedSourceUrl?: string; cachedAt: string; items: Array<{ name: string; section?: string; sourceText?: string }> };

function httpsUrl(value?: string): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}

function placeSource(place: Place): string {
  const official = httpsUrl(place.tags['data:source-url']);
  if (official) return official;
  const match = place.id.match(/^(?:osm:)?(node|way|relation)\/(\d+)$/);
  return match ? `https://www.openstreetmap.org/${match[1]}/${match[2]}` : `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}`;
}

function chatContext(places: Place[]): { text: string; sources: Array<{ name: string; url: string }> } {
  const recentPlaces = places.slice(0, 25);
  const sources: Array<{ name: string; url: string }> = [];
  const menuBySource = new Map<string, { text: string; url: string }>();
  const addSource = (name: string, value?: string | null) => {
    const url = httpsUrl(value || undefined);
    if (url && !sources.some(source => source.url === url)) sources.push({ name, url });
  };
  for (const place of recentPlaces) {
    addSource(`${place.name} · directory`, placeSource(place));
    addSource(`${place.name} · menu`, place.tags.menu || place.tags['menu:url']);
    addSource(`${place.name} · website`, place.tags.website || place.tags['contact:website']);
  }
  const listings = recentPlaces.map(place => {
    const cuisine = place.tags.cuisine ? `; cuisine: ${place.tags.cuisine}` : '';
    const address = [place.tags['addr:street'], place.tags['addr:housenumber'], place.tags['addr:city']].filter(Boolean).join(' ');
    const menu = httpsUrl(place.tags.menu) || httpsUrl(place.tags['menu:url']);
    const website = httpsUrl(place.tags.website) || httpsUrl(place.tags['contact:website']);
    return `Restaurant: ${place.name}${cuisine}${address ? `; address: ${address}` : ''}; listing source: ${placeSource(place)}${menu ? `; menu link: ${menu}` : ''}${website ? `; website: ${website}` : ''}`;
  });
  try {
    const stored: unknown = JSON.parse(localStorage.getItem('lunumi:menu-cache:v34') || '[]');
    if (Array.isArray(stored)) {
      for (const candidate of stored as LocalMenuCache[]) {
        if (!candidate || typeof candidate.sourceUrl !== 'string' || !Array.isArray(candidate.items)) continue;
        const age = Date.now() - Date.parse(candidate.cachedAt);
        if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) continue;
        const lines = candidate.items.slice(0, 40).map(item => `  ${item.section ? `${item.section}: ` : ''}${item.name}${item.sourceText ? ` — source excerpt: ${item.sourceText}` : ''}`).join('\n');
        menuBySource.set(candidate.sourceUrl, { text: `Cached menu source: ${candidate.resolvedSourceUrl || candidate.sourceUrl}\n${lines}`, url: candidate.resolvedSourceUrl || candidate.sourceUrl });
      }
      for (const place of recentPlaces) {
        const sourceUrl = httpsUrl(place.tags.menu) || httpsUrl(place.tags['menu:url']) || httpsUrl(place.tags.website) || httpsUrl(place.tags['contact:website']);
        if (sourceUrl) {
          const cached = menuBySource.get(sourceUrl);
          if (cached) {
            listings.push(`Loaded menu data for ${place.name}:\n${cached.text}`);
            addSource(`${place.name} · read menu`, cached.url);
          }
        }
      }
    }
  } catch { /* Local conversation can continue with restaurant listings alone. */ }
  return { text: listings.join('\n\n').slice(0, 14000) || 'No nearby restaurant records or locally cached menus are loaded yet.', sources };
}

export default function LunumiPet({ places, preferences }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [modelState, setModelState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [progress, setProgress] = useState<MenuModelProgress>({ status: 'Starting local AI' });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const nextMessageId = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setModelState('loading');
    setError('');
    void prepareLocalMenuModel(value => { if (active) setProgress(value); }).then(() => {
      if (active) setModelState('ready');
    }).catch(cause => {
      if (!active) return;
      setModelState('error');
      setError(cause instanceof Error ? cause.message : 'The local AI could not be started.');
    });
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => { active = false; window.clearTimeout(focusTimer); };
  }, [open]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [messages, sending]);

  async function sendMessage() {
    const text = draft.trim();
    if (!text || sending || modelState !== 'ready') return;
    const userMessage: ChatMessage = { id: ++nextMessageId.current, role: 'user', content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft('');
    const recentUserText = messages.filter(message => message.role === 'user').slice(-3).map(message => message.content).join(' ');
    if (!isLunumiRequest(text, places.map(place => place.name), recentUserText)) {
      setMessages([...nextMessages, { id: ++nextMessageId.current, role: 'assistant', content: lunumiScopeReply(text) }]);
      return;
    }
    setSending(true);
    setError('');
    const context = chatContext(places);
    try {
      const answer = await chatWithLocalAssistant({ turns: nextMessages, context: context.text, preferences });
      const answerSources = sourcesForAnswer(answer, context.sources);
      setMessages([...nextMessages, { id: ++nextMessageId.current, role: 'assistant', content: answer.trim(), sources: answerSources }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Lunumi could not answer right now.');
    } finally {
      setSending(false);
    }
  }

  return <>
    {open && <section className="lunumi-chat" role="dialog" aria-modal="false" aria-label="Chat with Lunumi">
      <header className="lunumi-chat-header"><img src={`${import.meta.env.BASE_URL}mascot/lunumi-lunch-pose.png`} alt=""/><div><strong>Chat with Lunumi</strong><span>Your local food companion</span></div><button type="button" aria-label="Close chat" onClick={() => setOpen(false)}><X size={19}/></button></header>
      <div className="lunumi-chat-model" role="status" aria-live="polite">
        {modelState === 'loading' && <><LoaderCircle size={14} className="menu-assistant-spinner"/><span>{progress.status.toLocaleLowerCase().includes('progress') || progress.status.toLocaleLowerCase().includes('download') ? `Downloading ${progress.file || 'the AI model'}${typeof progress.progress === 'number' ? ` · ${Math.round(progress.progress)}%` : ''}` : progress.status}. First use downloads about 570 MB; it is cached on this device.</span></>}
        {modelState === 'ready' && <span>Local AI is ready. Nearby listings and saved menu excerpts are sent only to the model on this device.</span>}
        {modelState === 'error' && <span>{error}</span>}
      </div>
      <div className="lunumi-chat-messages" aria-live="polite">
        {!messages.length && <div className="lunumi-chat-intro"><img src={`${import.meta.env.BASE_URL}mascot/lunumi-front.png`} alt=""/><p>Hi! I can help you explore nearby restaurants and menus Lunumi has loaded. Tap a source link to check where details came from.</p><small>I won’t make up menu or allergy information.</small></div>}
        {messages.map(message => <article className={`lunumi-chat-message is-${message.role}`} key={message.id}><span>{message.content}</span>{message.sources?.length ? <div className="lunumi-chat-sources"><small>Sources</small>{message.sources.map(source => <a key={`${message.id}-${source.url}`} href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a>)}</div> : null}</article>)}
        {sending && <div className="lunumi-chat-working" role="status"><LoaderCircle size={15} className="menu-assistant-spinner"/>Lunumi is thinking…</div>}
        <div ref={endRef}/>
      </div>
      {error && modelState !== 'error' && <p className="lunumi-chat-error" role="alert">{error}</p>}
      <form className="lunumi-chat-composer" onSubmit={event => { event.preventDefault(); void sendMessage(); }}>
        <textarea ref={inputRef} rows={2} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={modelState === 'ready' ? 'Ask Lunumi about nearby food…' : 'You can type while the model prepares…'} aria-label="Message Lunumi"/>
        <button type="submit" aria-label="Send message" disabled={!draft.trim() || sending || modelState !== 'ready'}><Send size={17}/></button>
      </form>
      <p className="lunumi-chat-privacy">Your messages and preferences stay on this device. Source pages are fetched separately by Lunumi.</p>
    </section>}
    <button type="button" className={`lunumi-pet-launcher${open ? ' is-open' : ''}`} aria-label={open ? 'Close Lunumi chat' : 'Chat with Lunumi'} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? <X size={21}/> : <img src={`${import.meta.env.BASE_URL}mascot/lunumi-lunch-pose.png`} alt=""/>}
      <span>{open ? 'Close' : 'Chat'}</span>
    </button>
  </>;
}
