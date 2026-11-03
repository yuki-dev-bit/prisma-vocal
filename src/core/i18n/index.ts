/**
 * Internacionalização.
 *
 * Escopo atual: interface (chrome, botões, rótulos, estados) em pt-BR e en.
 * Conteúdo editorial longo (currículo, textos de feedback, protocolo de
 * avaliação) permanece em pt-BR nesta versão — está isolado nos módulos
 * `training/`, `feedback/` e `assessment/`, que podem receber tabelas por
 * idioma sem alterar a interface. Ver docs/LIMITATIONS.md.
 */
import { ptBR } from './pt-BR';
import { en } from './en';

export type Locale = 'pt-BR' | 'en';
export type TKey = keyof typeof ptBR;
/** Todas as traduções devem cobrir exatamente as chaves do pt-BR. */
export type Dict = Record<TKey, string>;

const DICTS: Record<Locale, Dict> = { 'pt-BR': ptBR, en };

export function translator(locale: Locale) {
  const dict = DICTS[locale] ?? DICTS['pt-BR'];
  return (key: TKey, vars?: Record<string, string | number>): string => {
    const raw = dict[key] ?? DICTS['pt-BR'][key] ?? String(key);
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
  };
}

export const AVAILABLE_LOCALES: { id: Locale; label: string }[] = [
  { id: 'pt-BR', label: 'Português (Brasil)' },
  { id: 'en', label: 'English (partial)' },
];
