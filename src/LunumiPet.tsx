import { useEffect, useRef, useState } from 'react';
import { CircleHelp, Heart, LoaderCircle, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import type { Place } from './core';
import { relevantPlaces } from './assistant-context';
import { chatWithLocalAssistant, prepareLocalMenuModel, subscribeLocalMenuModelProgress, type MenuAssistantTurn, type MenuModelPreferences, type MenuModelProgress } from './menu-llm';
import { isLunumiGreeting, isLunumiRequest, lunumiScopeReply } from './assistant-scope';
import { sourcesForAnswer } from './assistant-sources';

type Props = { places: Place[]; preferences: MenuModelPreferences };
type ChatMessage = MenuAssistantTurn & { id: number; sources?: Array<{ name: string; url: string }> };
type LocalMenuCache = { sourceUrl: string; resolvedSourceUrl?: string; cachedAt: string; items: Array<{ name: string; section?: string; sourceText?: string }> };
type PetMood = 'idle' | 'curious' | 'thinking' | 'happy' | 'thoughtful' | 'sorry';
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

function chatContext(places: Place[], query: string): { text: string; sources: Array<{ name: string; url: string }> } {
  const recentPlaces = relevantPlaces(places, query);
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
    const stored: unknown = JSON.parse(localStorage.getItem('lunumi:menu-cache:v35') || '[]');
    if (Array.isArray(stored)) {
      for (const candidate of stored as LocalMenuCache[]) {
        if (!candidate || typeof candidate.sourceUrl !== 'string' || !Array.isArray(candidate.items)) continue;
        const age = Date.now() - Date.parse(candidate.cachedAt);
        if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) continue;
        const lines = candidate.items.slice(0, 8).map(item => `  ${item.section ? `${item.section}: ` : ''}${item.name}${item.sourceText ? ` — source excerpt: ${item.sourceText.slice(0, 180)}` : ''}`).join('\n');
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
  return { text: `Nearby restaurant records relevant to the user's latest question. Use only the listed facts; a missing detail is unknown.\n\n${listings.join('\n\n')}`.slice(0, 8000) || 'No nearby restaurant records or locally cached menus are loaded yet.', sources };
}

export default function LunumiPet({ places, preferences }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [modelState, setModelState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [progress, setProgress] = useState<MenuModelProgress>({ status: 'Starting local AI' });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [speech, setSpeech] = useState<{ messageId: number; visibleCharacters: number } | null>(null);
  const [reaction, setReaction] = useState(0);
  const nextMessageId = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setModelState('loading');
    setError('');
    const updateProgress = (value: MenuModelProgress) => {
      if (!active) return;
      setProgress(value);
      setModelState(value.status.toLocaleLowerCase().includes('ready') ? 'ready' : 'loading');
    };
    const unsubscribeModelProgress = subscribeLocalMenuModelProgress(updateProgress);
    void prepareLocalMenuModel(value => updateProgress(value)).then(() => {
      if (active) setModelState('ready');
    }).catch(cause => {
      if (!active) return;
      setModelState('error');
      setError(cause instanceof Error ? cause.message : 'The local AI could not be started.');
    });
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => { active = false; unsubscribeModelProgress(); window.clearTimeout(focusTimer); };
  }, [open]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [messages, sending]);

  useEffect(() => {
    if (!sending) { setThinkingSeconds(0); return; }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setThinkingSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [sending]);

  useEffect(() => {
    if (!reaction) return;
    const timer = window.setTimeout(() => setReaction(0), 1100);
    return () => window.clearTimeout(timer);
  }, [reaction]);

  useEffect(() => {
    if (!speech) return;
    const message = messages.find(entry => entry.id === speech.messageId && entry.role === 'assistant');
    if (!message) { setSpeech(null); return; }
    if (speech.visibleCharacters >= message.content.length) { setSpeech(null); return; }
    const nextCharacter = message.content[speech.visibleCharacters];
    const delay = /[.!?,;:]/.test(nextCharacter) ? 150 : 26;
    const timer = window.setTimeout(() => setSpeech(current => current?.messageId === speech.messageId
      ? { ...current, visibleCharacters: current.visibleCharacters + 1 }
      : current), delay);
    return () => window.clearTimeout(timer);
  }, [speech, messages]);

  const latestReply = [...messages].reverse().find(message => message.role === 'assistant');
  const uncertainReply = Boolean(latestReply && /\b(unknown|not listed|not available|don't have|do not have|cannot verify|can't verify|not sure|unsure|no nearby|no menu|couldn't find|could not find|i don't see|isn't listed|is not listed)\b/i.test(latestReply.content));
  const mood: PetMood = modelState === 'error' || Boolean(error) ? 'sorry' : reaction ? 'happy' : sending ? 'thinking' : draft.trim() ? 'curious' : latestReply ? uncertainReply ? 'thoughtful' : 'happy' : 'idle';
  const moodLabel: Record<PetMood, string> = {
    idle: 'Ready to explore', curious: 'Listening to you', thinking: 'Thinking it through',
    happy: 'Glad to help', thoughtful: 'Checking what is known', sorry: 'A small hiccup',
  };
  const moodIcon = mood === 'thinking' ? <LoaderCircle size={13} className="menu-assistant-spinner"/>
    : mood === 'curious' ? <MessageCircle size={13}/>
      : mood === 'happy' ? <Sparkles size={13}/>
        : mood === 'thoughtful' || mood === 'sorry' ? <CircleHelp size={13}/>
          : <Heart size={13}/>;

  async function sendMessage() {
    const text = draft.trim();
    if (!text || sending || modelState !== 'ready') return;
    const userMessage: ChatMessage = { id: ++nextMessageId.current, role: 'user', content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft('');
    setError('');
    if (isLunumiGreeting(text)) {
      setReaction(value => value + 1);
      return;
    }
    const recentUserText = messages.filter(message => message.role === 'user').slice(-3).map(message => message.content).join(' ');
    if (!isLunumiRequest(text, places.map(place => place.name), recentUserText)) {
      setMessages([...nextMessages, { id: ++nextMessageId.current, role: 'assistant', content: lunumiScopeReply(text) }]);
      return;
    }
    setSending(true);
    setError('');
    const context = chatContext(places, `${recentUserText} ${text}`);
    try {
      const answer = await chatWithLocalAssistant({ turns: nextMessages, context: context.text, preferences });
      const answerSources = sourcesForAnswer(answer, context.sources);
      const reply: ChatMessage = { id: ++nextMessageId.current, role: 'assistant', content: answer.trim(), sources: answerSources };
      setMessages([...nextMessages, reply]);
      setSpeech(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? null : { messageId: reply.id, visibleCharacters: 0 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Lunumi could not answer right now.');
    } finally {
      setSending(false);
    }
  }

  return <>
    {open && <section className="lunumi-chat" role="dialog" aria-modal="false" aria-label="Chat with Lunumi">
      <header className={`lunumi-chat-header mood-${mood}`}><div className={`lunumi-chat-avatar mood-${mood}${reaction ? ' is-reacting' : ''}`}><img src={`${import.meta.env.BASE_URL}mascot/lunumi-lunch-pose.png`} alt=""/><i className={`lunumi-face-expression expression-${mood}`} aria-hidden="true"><b/><b/><em/></i><span aria-hidden="true">{moodIcon}</span></div><div><strong>Chat with Lunumi</strong><span>{reaction ? 'Happy to see you' : moodLabel[mood]}</span></div><button type="button" aria-label="Close chat" onClick={() => setOpen(false)}><X size={19}/></button></header>
      <div className="lunumi-chat-model" role="status" aria-live="polite">
        {modelState === 'loading' && <><LoaderCircle size={14} className="menu-assistant-spinner"/><span>{progress.status.toLocaleLowerCase().includes('progress') || progress.status.toLocaleLowerCase().includes('download') ? `Downloading ${progress.file || 'the AI model'}${typeof progress.progress === 'number' ? ` · ${Math.round(progress.progress)}%` : ''}` : progress.status}. {progress.device === 'wasm' ? 'The CPU fallback downloads about 920 MB on first use and runs more slowly; it is cached on this device.' : 'First use downloads about 570 MB; it is cached on this device.'}</span></>}
        {modelState === 'ready' && <span>{progress.device === 'wasm' ? 'Local AI is ready on the CPU fallback. It may respond more slowly; your data stays on this device.' : 'Local AI is ready. Nearby listings and saved menu excerpts are sent only to the model on this device.'}</span>}
        {modelState === 'error' && <span>{error}</span>}
      </div>
      <div className="lunumi-chat-messages" aria-live="polite">
        {messages.map(message => {
          const isSpeaking = speech?.messageId === message.id;
          const visibleText = isSpeaking ? message.content.slice(0, speech?.visibleCharacters ?? 0) : message.content;
          return <article className={`lunumi-chat-message is-${message.role}`} key={message.id}>
            {message.role === 'assistant' && <div className={`lunumi-chat-speaker${isSpeaking ? ' is-speaking' : ''}`} aria-hidden="true"><img src={`${import.meta.env.BASE_URL}mascot/lunumi-lunch-pose.png`} alt=""/><i className={`lunumi-face-expression expression-${isSpeaking ? 'speaking' : uncertainReply ? 'thoughtful' : 'happy'}`}><b/><b/><em/></i></div>}
            <div className={`lunumi-chat-bubble is-${message.role}`}><span aria-label={message.role === 'assistant' ? message.content : undefined}>{visibleText}</span>{!isSpeaking && message.sources?.length ? <div className="lunumi-chat-sources"><small>Sources</small>{message.sources.map(source => <a key={`${message.id}-${source.url}`} href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a>)}</div> : null}</div>
          </article>;
        })}
        {sending && <div className="lunumi-chat-working" role="status"><LoaderCircle size={15} className="menu-assistant-spinner"/>{thinkingSeconds < 12 ? 'Lunumi is thinking on this device…' : `Lunumi is still working locally · ${thinkingSeconds}s`}</div>}
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
