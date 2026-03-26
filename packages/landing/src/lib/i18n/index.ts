import { es } from './locales/es';
import { en } from './locales/en';

export type { Dictionary } from './locales/es';

export type Locale = 'es' | 'en';

type LocaleDictionary = typeof es;

const dictionaries: Record<Locale, LocaleDictionary> = {
  es,
  en,
};

export function getDictionary(locale: Locale = 'es'): LocaleDictionary {
  return dictionaries[locale];
}
