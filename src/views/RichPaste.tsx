import { useLayoutEffect, useRef } from 'react';
import { safeHtmlFrom, serializeRichText, textToHtml } from '../models/richText';

// Campo de colagem que mantém a formatação (links clicáveis) da mensagem copiada no app, mas guarda só texto para o restante da tela.
export function RichPaste({ value, onChange, label, placeholder }: { value: string; onChange: (value: string) => void; label: string; placeholder: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && value !== last.current) { element.innerHTML = textToHtml(value); last.current = value; }
  }, [value]);
  const emit = () => { const text = serializeRichText(ref.current!); last.current = text; onChange(text); };
  return <div ref={ref} className="rich-paste" role="textbox" aria-multiline="true" aria-label={label} data-placeholder={placeholder} contentEditable suppressContentEditableWarning spellCheck={false}
    onInput={emit}
    onPaste={event => {
      event.preventDefault();
      const html = event.clipboardData.getData('text/html');
      document.execCommand('insertHTML', false, html ? safeHtmlFrom(html) : textToHtml(event.clipboardData.getData('text/plain')));
    }}
    onClick={event => {
      const link = (event.target as HTMLElement).closest('a');
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute('href');
      if (href) void window.gitManager.openReviewLink(href).catch(() => {});
    }}/>;
}
