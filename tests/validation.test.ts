import { describe, expect, it } from 'vitest';
import { planSchema, ref, targetsFromFields } from '../src/models/validation';
import { runGit, redact } from '../electron/services/processRunner';
describe('Validação na fronteira da operação', () => {
  it('campos dependentes não são silenciosamente normalizados', () => {
    expect(targetsFromFields(['main', 'dev', ''])).toEqual(['main', 'dev']);
    expect(() => targetsFromFields(['main', '', 'release'])).toThrow('sem pular');
    expect(() => targetsFromFields(['', 'dev', ''])).toThrow('sem pular');
  });
  it('exige commits completos, origem, até três destinos únicos', () => {
    const valid = { source: 'supp37', commits: ['a'.repeat(40)], targets: ['main', 'dev'] };
    expect(planSchema.safeParse(valid).success).toBe(true);
    for (const invalid of [{ ...valid, source: '' }, { ...valid, commits: [] }, { ...valid, commits: ['HEAD~2'] }, { ...valid, targets: ['main', 'main'] }, { ...valid, targets: ['supp37'] }, { ...valid, targets: ['a', 'b', 'c', 'd'] }]) expect(planSchema.safeParse(invalid).success).toBe(false);
  });
  it('impede opções e revision expressions fornecidas como ramos', () => {
    for (const value of ['--force', 'main~1', 'main..dev', 'x\0y', 'a b']) expect(ref.safeParse(value).success).toBe(false);
    expect(ref.safeParse('origin/DDVENDAS-63455-main').success).toBe(true);
    expect(() => runGit('.', ['reset', '--hard'])).toThrow('não permitido');
    expect(redact('https://user:password@example.com/repo')).toBe('https://***@example.com/repo');
  });
});
