import { expect, it } from 'vitest';
import { GEM_URL, chromeUserAgent, documentationFields, documentationPrompt, gemUrlForAccount, isGeminiHome, isGemStartUrl } from '../src/models/gemini';

it('preserva a conta ao reabrir o Gem e reconhece a página inicial após login', () => {
  expect(gemUrlForAccount('https://gemini.google.com/u/2/app')).toBe('https://gemini.google.com/u/2/gem/3bf604e9d2f3');
  expect(gemUrlForAccount('https://gemini.google.com/app?authuser=1')).toBe('https://gemini.google.com/u/1/gem/3bf604e9d2f3');
  expect(gemUrlForAccount('https://accounts.google.com/u/2/')).toBe(GEM_URL);
  expect(isGeminiHome('https://gemini.google.com/u/2/app')).toBe(true);
  expect(isGeminiHome('https://gemini.google.com/app')).toBe(true);
  expect(isGeminiHome('https://gemini.google.com/app/conversa')).toBe(false);
  expect(isGeminiHome(GEM_URL)).toBe(false);
});

it('monta o questionário completo sem transformar exemplos em dados da entrega', () => {
  const text = documentationPrompt({ routine: 'Rotina 123', issue: '<issue>&"texto"</issue>', permissions: 'N/A', changes: 'Linha 1\nLinha 2' });
  expect(text.startsWith('Gerar Encerramento de Desenvolvimento & Release notes.\nSempre dar espaçamento entre os tópicos do texto\n\n')).toBe(true);
  expect(text).toContain('<issue>&"texto"</issue>');
  expect(text).toContain('Linha 1\nLinha 2');
  expect(text).toContain('N/A');
  expect(text).toContain('[Não informado]');
  for (const field of documentationFields) {
    expect(text).toContain(field.label);
    expect(text).not.toContain(field.example);
  }
});

it('preenche somente o início do Gem correto, nunca login, outro Gem ou conversa existente', () => {
  expect(isGemStartUrl('https://gemini.google.com/gem/3bf604e9d2f3')).toBe(true);
  expect(isGemStartUrl('https://gemini.google.com/u/1/gem/3bf604e9d2f3?hl=pt-BR')).toBe(true);
  for (const value of [
    'https://gemini.google.com/gem/outro',
    'https://gemini.google.com/gem/3bf604e9d2f3/conversa',
    'https://gemini.google.com/app/123',
    'https://accounts.google.com/',
    'https://gemini.google.com.evil.test/gem/3bf604e9d2f3',
    'http://gemini.google.com/gem/3bf604e9d2f3',
    'javascript:alert(1)', 'invalid'
  ]) expect(isGemStartUrl(value)).toBe(false);
});

it('remove o token do app e do Electron do user agent, com qualquer nome de produto', () => {
  const base = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)';
  const expected = `${base} Chrome/146.0.0.0 Safari/537.36`;
  for (const app of ['gerenciador-de-ramos/0.1.29', 'GerenciadordeRamos/41.7.1']) expect(chromeUserAgent(`${base} ${app} Chrome/146.0.0.0 Electron/41.7.1 Safari/537.36`)).toBe(expected);
  expect(chromeUserAgent(expected)).toBe(expected);
});
