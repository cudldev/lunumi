import { useEffect, useRef, useState } from 'react';
import { buildConversation, type ConversationTurn } from './ai-context';
import { LocalConversation } from './local-conversation';
import './chat-test.css';

type Turn = ConversationTurn & { error?: boolean };
export default function ChatTest() {
  const [turns, setTurns] = useState<Turn[]>([]), [input, setInput] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const client = useRef<LocalConversation | null>(null), pending = useRef<AbortController | null>(null), end = useRef<HTMLDivElement>(null);
  useEffect(() => () => { pending.current?.abort(); client.current?.stop(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [turns, status]);

  async function send() {
    const text = input.trim().slice(0, 700);
    if (!text || pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setInput(''); setBusy(true); setStatus('Preparing private AI…');
    const history = [...turns.filter(turn => !turn.error), { role: 'user' as const, text }].slice(-20);
    setTurns(history);
    let partial = '', added = false;
    const display = (value: string, error = false) => {
      if (!added) { added = true; setTurns(old => [...old, { role: 'assistant', text: value, error }]); }
      else setTurns(old => [...old.slice(0, -1), { role: 'assistant', text: value, error }]);
    };
    try {
      client.current ||= new LocalConversation();
      const reply = await client.current.answer(buildConversation(history, '[]'), controller.signal, event => {
        if (controller.signal.aborted) return;
        if (event.type === 'status') setStatus(event.text);
        if (event.type === 'token') { partial += event.text; display(partial); }
      });
      display(reply);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The model could not answer. Please retry.';
      display(partial ? partial + '\n\n[Reply interrupted] ' + message : message, true);
    } finally { if (pending.current === controller) { pending.current = null; setBusy(false); setStatus(''); } }
  }

  return <main className="chat-test">
    <header><a href={import.meta.env.BASE_URL}>← Back to Lunumi</a><span className="test-badge">FIRST VERSION TEST</span><h1>Chat with Lunumi</h1><p>Normal conversation, running privately in your browser.</p></header>
    <aside className="test-info">First use downloads about <strong>1.4 GB</strong>. A desktop browser works best; CPU fallback can be slow. Chat stays on this device. This test has no restaurant tools.</aside>
    <section className="test-conversation" role="log" aria-label="Conversation" aria-live="polite" aria-busy={busy}>
      {!turns.length && <div className="test-empty"><strong>Say hello.</strong><p>Try “My name is Alex”, then “What’s my name?” — or ask about food, ideas, or your day.</p></div>}
      {turns.map((turn, index) => <article className={'test-turn test-' + turn.role + (turn.error ? ' test-error' : '')} key={index}><small>{turn.role === 'user' ? 'You' : 'Lunumi · AI'}</small><p>{turn.text}</p></article>)}
      {busy && <p className="test-status" role="status">{status || 'Thinking…'}</p>}<div ref={end}/>
    </section>
    <form onSubmit={event => { event.preventDefault(); void send(); }}><label htmlFor="test-message">Message Lunumi</label><div className="test-composer"><textarea id="test-message" rows={2} value={input} maxLength={700} placeholder="Say hello or ask a question…" onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}/><button type="submit" disabled={busy || !input.trim()}>Send</button></div></form>
    <footer><button type="button" disabled={!busy} onClick={() => pending.current?.abort()}>Stop reply</button><button type="button" disabled={busy} onClick={() => { client.current?.stop(); client.current = null; setTurns([]); }}>Clear chat</button><small>AI can make mistakes. Clearing chat removes the conversation; cached model files may remain.</small></footer>
  </main>;
}
