import { useEffect, useRef } from 'react';
import type { ModelReadiness } from './use-model-readiness';
import './model-setup.css';

export function ModelSetupStatus({ model }: { model: ModelReadiness }) {
  if (!model.active) return <p className="model-setup-info">Private AI needs about <strong>{model.download}</strong> on first use. {model.manual ? 'On this device, loading starts only when you choose Enable private AI. You can use menus and discovery without it.' : 'It prepares while you finish setup. You can continue without AI if needed.'}</p>;
  return <div className={'model-setup-status model-phase-' + model.phase}>
    <p role={model.phase === 'error' ? 'alert' : 'status'} aria-live="polite">{model.ready ? 'Private AI is ready ✓' : model.phase === 'idle' && model.manual ? 'Private AI is paused. Loading starts only when you choose.' : model.status}</p>
    {model.interrupted && !model.ready && <p>The previous AI session was interrupted. Automatic loading is paused to avoid a possible crash loop.</p>}
    {model.phase === 'loading' && model.stage === 'download' && typeof model.progress === 'number' && <div className="model-download-progress"><progress max={100} value={model.progress} aria-label="AI model download"/><strong>{Math.round(model.progress)}%</strong></div>}
    {model.phase === 'loading' && model.stage !== 'download' && <span className="model-setup-spinner" aria-label="Checking model readiness"/>}
    {model.phase === 'error' && <><p>AI could not start on this device. You can keep using discovery and menu tools without it.</p><details><summary>Technical details</summary><p>{model.error}</p></details></>}
    {(model.phase === 'error' || model.phase === 'idle') && <button className="button" onClick={model.retry}>{model.phase === 'idle' && model.manual ? `Enable private AI (${model.download})` : model.phase === 'idle' ? 'Resume preparation' : 'Retry AI setup'}</button>}
    {model.phase === 'error' && <button className="text-button" onClick={model.retryCPU}>Try CPU (slower)</button>}
    {model.phase === 'loading' && <button className="text-button" onClick={model.pause}>Pause preparation</button>}
  </div>;
}

export default function ModelSetupScreen({ model, overlay = false }: { model: ModelReadiness; overlay?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    if (!overlay) return;
    const changed = [...document.body.children].filter(node => !node.contains(heading.current) && !node.hasAttribute('inert'));
    changed.forEach(node => node.setAttribute('inert', ''));
    return () => changed.forEach(node => node.removeAttribute('inert'));
  }, [overlay]);
  return <main className={'model-setup-screen' + (overlay ? ' model-setup-overlay' : '')} aria-busy={model.phase === 'loading'} onKeyDown={event => { if (overlay && event.key === 'Escape') event.stopPropagation(); }}>
    <section aria-labelledby="model-setup-title">
      <img className="model-setup-icon" src={import.meta.env.BASE_URL + 'lunumi-app-icon.png'} alt=""/>
      <span className="eyebrow">YOUR PRIVATE AI</span>
      <h1 id="model-setup-title" ref={heading} tabIndex={-1}>{model.phase === 'error' ? 'Let’s get AI ready.' : model.phase === 'idle' && model.manual ? 'Choose how to start.' : 'Preparing Lunumi…'}</h1>
      <p>Your setup is saved. Enable private AI after it passes a real inference check, or continue with discovery and menu tools.</p>
      <ModelSetupStatus model={model}/>
      <button className="button outline full" onClick={model.skip}>Continue without AI</button>
      <p className="model-setup-note">First use downloads about {model.download}. Later visits use cached files when available. Conversations stay on your device. Mobile uses a smaller model with more limited answers; some phones may still lack enough memory.</p>
    </section>
  </main>;
}
