import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GEM_URL, documentationFields, documentationPrompt, type DocumentationDraft, type GeminiState } from '../models/gemini';

// Retain the draft across tab changes without persisting issue XML to disk.
let sessionDraft: DocumentationDraft = {};
const sections = [
  { title: 'Identificação', description: 'Rotinas e tarefa de referência.' },
  { title: 'Dados técnicos', description: 'Implementação, dependências e cenários para QA.' },
  { title: 'Visão de negócio', description: 'Melhorias e impactos para as Release Notes.' }
];
const sectionNames = [...new Set(documentationFields.map(field => field.section))];
export function Gemini() {
  const [draft, setDraft] = useState<DocumentationDraft>(() => sessionDraft);
  const [state, setState] = useState<GeminiState>({ phase: 'loading', message: 'Abrindo o Gem da equipe…' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [working, setWorking] = useState(false);
  const browser = useRef<HTMLDivElement>(null);
  const formScroll = useRef<HTMLDivElement>(null);
  const [sectionTarget, setSectionTarget] = useState<number | null>(null);
  const reposition = useRef<() => void>(() => {});
  const prompt = documentationPrompt(draft);
  const filled = documentationFields.filter(field => draft[field.key]?.trim()).length;
  useLayoutEffect(() => { reposition.current(); });
  useEffect(() => { sessionDraft = draft; }, [draft]);
  useEffect(() => {
    if (sectionTarget === null || preview) return;
    const container = formScroll.current;
    const section = container?.querySelector<HTMLElement>(`#gemini-section-${sectionTarget}`);
    if (container && section) container.scrollTop += section.getBoundingClientRect().top - container.getBoundingClientRect().top - 16;
    section?.querySelector('textarea')?.focus({ preventScroll: true });
    setSectionTarget(null);
  }, [sectionTarget, preview]);
  useEffect(() => {
    const unsubscribe = window.gitManager.onGeminiState(setState);
    void window.gitManager.geminiState().then(setState).catch(e => setError(e.message));
    return unsubscribe;
  }, []);
  useEffect(() => {
    let frame = 0;
    let last = '';
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = browser.current;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const bounds = rect.top < 0 || rect.bottom > window.innerHeight ? { x: rect.x, y: Math.max(0, rect.y), width: rect.width, height: Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(0, rect.top)) } : { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        const serialized = JSON.stringify(bounds);
        if (serialized !== last) {
          last = serialized;
          void window.gitManager.geminiView(bounds).catch(e => setError(e.message));
        }
      });
    };
    const observer = new ResizeObserver(resize);
    reposition.current = resize;
    if (browser.current) observer.observe(browser.current);
    observer.observe(document.body);
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', resize, true);
    resize();
    return () => {
      reposition.current = () => {};
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', resize, true);
      void window.gitManager.geminiView(null).catch(() => {});
    };
  }, []);
  const action = async (work: () => Promise<void>) => {
    setWorking(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError((e as Error).message); }
    finally { setWorking(false); }
  };
  const generating = working || state.phase === 'filling';
  const clearDraft = () => {
    if (!filled || !window.confirm('Limpar todos os campos da documentação?')) return;
    setDraft({}); setPreview(false); setError(''); setNotice('Campos limpos.');
  };
  return <section className="gemini-workspace">
    <div className="gemini-toolbar">
      <button className="primary" aria-busy={generating} disabled={generating || filled === 0 || prompt.length > 200000} onClick={() => action(() => window.gitManager.geminiGenerate(prompt))}>{generating && <span className="spinner" aria-hidden="true"/>}Gerar Gem</button>
      <button disabled={working} onClick={() => action(async () => { await window.gitManager.geminiCopy(prompt, false); setNotice('Texto copiado.'); })}>Copiar texto</button>
      <button disabled={working} onClick={() => action(async () => { await window.gitManager.geminiCopy(prompt, true); setNotice('Texto copiado. No navegador, cole na nova conversa do Gem e envie.'); })}>Abrir no navegador e copiar texto</button>
      <div className="gemini-progress"><span>{filled} de {documentationFields.length} campos preenchidos</span><progress aria-label="Campos preenchidos" max={documentationFields.length} value={filled}/></div>
    </div>
    <p className="gemini-help">Preencha os campos destacados. Gerar Gem abre uma nova conversa e envia o questionário. Se o login da empresa bloquear o acesso integrado, use o navegador externo.</p>
    {prompt.length > 200000 && <p className="alert error" role="alert">O texto ultrapassa o limite de 200.000 caracteres. Reduza o conteúdo antes de gerar.</p>}
    {(error || notice) && <p className={`alert ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{error || notice}</p>}
    <div className={`gemini-layout ${expanded ? 'expanded' : ''}`}>
      {!expanded && <section className="card gemini-document">
        <div className="card-heading"><div><span className="step-label">PREPARAR · REVISAR · GERAR</span><h2>Documentação da entrega</h2></div><div className="gemini-heading-actions"><button className="quiet gemini-clear" title="Limpar campos" aria-label="Limpar todos os campos" disabled={!filled || generating} onClick={clearDraft}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-.9 14H5L4 6m5 4v6m6-6v6"/></svg></button><button className="quiet" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? 'Editar campos' : 'Ver texto completo'}</button></div></div>
        <div className="gemini-section-nav" role="group" aria-label="Seções da documentação">{sections.map((section, index) => <button key={section.title} onClick={() => { setPreview(false); setSectionTarget(index); }}><span>{index + 1}</span>{section.title}</button>)}</div>
        <div className="gemini-form-scroll" ref={formScroll}>
          <p className="hint gemini-draft-hint">O rascunho é mantido durante esta sessão. Os exemplos são orientações; campos vazios serão enviados como “Não informado”.</p>
          {preview ? <><h3 className="gemini-preview-title">Texto que será enviado ao Gem Dev</h3><pre className="gemini-preview">{prompt}</pre></> : sectionNames.map((name, index) => <section className="gemini-field-section" id={`gemini-section-${index}`} aria-labelledby={`gemini-section-title-${index}`} key={name}>
            <h3 id={`gemini-section-title-${index}`} className="gemini-section"><span>{index + 1}</span>{sections[index].title}</h3>
            <p className="hint">{sections[index].description}</p>
            {documentationFields.filter(field => field.section === name).map(field =>
            <label key={field.key} className={`gemini-field ${draft[field.key]?.trim() ? 'filled' : ''}`}>
              <span>{field.label} <small>{draft[field.key]?.trim() ? 'Preenchido' : 'Preencher'}</small></span>
              <textarea rows={'large' in field ? 5 : 2} maxLength={field.key === 'issue' ? 120000 : 6000} placeholder={field.example} value={draft[field.key] ?? ''} onChange={e => setDraft(current => ({ ...current, [field.key]: e.target.value }))}/>
            </label>
            )}
          </section>)}
        </div>
      </section>}
      <section className="card gemini-browser">
        <div className="card-heading"><h2>Gem Dev</h2><div><button className="quiet" disabled={working} onClick={() => action(() => window.gitManager.geminiReopen())}>Reabrir Gem</button><button className="quiet" onClick={() => setExpanded(!expanded)}>{expanded ? 'Mostrar formulário' : 'Ampliar navegador'}</button></div></div>
        <p className="gemini-browser-address" title={state.url ?? GEM_URL}>{state.url ?? GEM_URL}</p>
        <p className={`gemini-browser-status ${state.phase === 'error' ? 'gemini-error' : ''}`} role="status">{state.message}</p>
        <div ref={browser} className="gemini-browser-surface" aria-label="Navegador integrado do Gemini"/>
      </section>
    </div>
  </section>;
}
