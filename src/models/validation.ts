import { z } from 'zod';
export const text = z.string().min(1).max(4096).refine(v => !v.includes('\0'), 'Texto inválido');
export const ref = text.refine(v => !v.startsWith('-') && !/[\s~^:?*\[\\]/.test(v) && !v.includes('..') && !v.includes('@{'), 'Ramo inválido');
export const hash = z.string().regex(/^[a-f0-9]{40,64}$/i);
export const planSchema = z.object({ source: ref, commits: z.array(hash).min(1).max(200), targets: z.array(ref).min(1).max(3) }).superRefine((p, ctx) => {
  if (new Set(p.targets).size !== p.targets.length || p.targets.includes(p.source)) ctx.addIssue({ code: 'custom', message: 'Origem e destinos devem ser diferentes, sem repetições.' });
  if (new Set(p.commits).size !== p.commits.length) ctx.addIssue({ code: 'custom', message: 'Há commits repetidos.' });
});
export function targetsFromFields(fields: string[]): string[] {
  const firstEmpty = fields.findIndex(v => !v.trim());
  if (firstEmpty >= 0 && fields.slice(firstEmpty).some(v => v.trim())) throw new Error('Preencha os destinos em sequência, sem pular campos.');
  return fields.map(v => v.trim()).filter(Boolean);
}
