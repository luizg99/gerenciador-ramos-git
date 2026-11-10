import { prLabel } from './reviewMessage';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export const isSafeLink = (value: string) => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } };
const anchor = (url: string, label: string) => isSafeLink(url) ? `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>` : escapeHtml(label);

// Texto simples (inclusive o formato `<link|texto>` do Google Chat e links soltos) vira HTML com links clicáveis.
export function textToHtml(text: string): string {
  const pattern = /<(https?:\/\/[^\s<>|]+)\|([^<>\n]*)>|(https?:\/\/[^\s<>|]+)/g;
  let html = '', last = 0;
  for (const match of text.matchAll(pattern)) {
    html += escapeHtml(text.slice(last, match.index));
    if (match[1]) html += anchor(match[1], match[2] || prLabel(match[1]));
    else { const url = match[3].replace(/[.,;]+$/, ''); html += anchor(url, prLabel(url)) + escapeHtml(match[3].slice(url.length)); }
    last = match.index + match[0].length;
  }
  return (html + escapeHtml(text.slice(last))).replace(/\r?\n/g, '<br>');
}

// Percorre o conteúdo editável e devolve o texto, trocando cada link por `<link|texto>` (o formato que o restante do app já entende).
export function serializeRichText(root: Node): string {
  let out = '';
  const newline = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  const walk = (node: Node) => {
    if (node.nodeType === 3) { out += node.nodeValue ?? ''; return; }
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    const tag = element.tagName;
    if (tag === 'BR') { out += '\n'; return; }
    const href = tag === 'A' ? element.getAttribute('href') : null;
    if (href && isSafeLink(href)) { out += `<${href}|${element.textContent ?? ''}>`; return; }
    const block = /^(DIV|P|LI|H[1-6])$/.test(tag);
    if (block) newline();
    element.childNodes.forEach(walk);
    if (block) newline();
  };
  root.childNodes.forEach(walk);
  return out.replace(/\n+$/, '');
}

// HTML copiado de outro lugar (o mesmo texto formatado do app, Google Chat, e-mail): só texto, quebras de linha e links seguros.
export function safeHtmlFrom(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === 3) { out += escapeHtml(node.nodeValue ?? ''); return; }
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    const tag = element.tagName;
    if (['SCRIPT', 'STYLE', 'HEAD', 'TEMPLATE'].includes(tag)) return;
    if (tag === 'BR') { out += '<br>'; return; }
    const href = tag === 'A' ? element.getAttribute('href') : null;
    if (href && isSafeLink(href)) { out += anchor(href, element.textContent ?? href); return; }
    const block = /^(DIV|P|LI|H[1-6]|TR)$/.test(tag);
    element.childNodes.forEach(walk);
    if (block && !out.endsWith('<br>')) out += '<br>';
  };
  doc.body.childNodes.forEach(walk);
  return out.replace(/(<br>){3,}/g, '<br><br>').replace(/(<br>)+$/, '');
}
