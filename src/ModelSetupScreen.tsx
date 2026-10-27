import { useEffect, useRef } from 'react';
import type { ModelReadiness } from './use-model-readiness';
import './model-setup.css';

export function ModelSetupStatus({ model }: { model: ModelReadiness }) {
  if (!model.active) return <p className="model-setup-info">Private AI needs about <strong>1.4 GB</strong> on first use. It prepares while you finish setup; the app opens only after its readiness check passes.</p>;
  return <div className={'model-setup-status model-phase-' + model.phase}>
    <p role={model.phase === 'error' ? 'alert' : 'status'} aria-live="polite">{model.ready ? 'Private AI is ready ✓' : model.status}</p>
    {model.phase === 'loading' && model.stage === 'download' && typeof model.progress === 'number' && <div className="model-download-progress"><progress max={100} value={model.progress} aria-label="AI model download"/><strong>{Math.round(model.progress)}%</strong></div>}
    {model.phase === 'loading' && model.stage !== 'download' && <span className="model-setup-spinner" aria-label="Checking model readiness"/>}
    {model.phase === 'error' && <><p>The app stays locked until the AI starts successfully. Retry or try a supported desktop browser.</p><details><summary>Technical details</summary><p>{model.error}</p></details></>}
    {(model.phase === 'error' || model.phase === 'idle') && <button className="button" onClick={model.retry}>{model.phase === 'idle' ? 'Resume preparation' : 'Retry AI setup'}</button>}
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
      <h1 id="model-setup-title" ref={heading} tabIndex={-1}>{model.phase === 'error' ? 'Let’s get AI ready.' : 'Preparing Lunumi…'}</h1>
      <p>Your setup is saved. The app opens automatically after the model loads and passes a real inference check.</p>
      <ModelSetupStatus model={model}/>
      <p className="model-setup-note">First use downloads about 1.4 GB. Later visits check cached files. Conversations stay on your device; CPU preparation may take longer.</p>
    </section>
  </main>;
}
