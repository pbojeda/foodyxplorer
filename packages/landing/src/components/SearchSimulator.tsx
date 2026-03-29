'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DISHES, getConfidenceBadgeClass, getLevelDisplay } from '@/lib/content';
import type { Dish } from '@/lib/content';

const LOADING_DURATION_MS = 850;

type SimulatorState = 'idle' | 'loading' | 'result';

/**
 * SearchSimulator — interactive demo with 10 pre-loaded dishes.
 *
 * Features:
 * - Autocomplete dropdown filters DISHES by query as user types
 * - Quick-select pills for each pre-loaded dish
 * - 850ms loading animation before showing result
 * - Result card: calories, macros grid (2x2), confidence badge, allergen guardrail
 * - Improved no-match UX: query-interpolated message + 4 suggestion pills
 * - ARIA combobox pattern: role, aria-expanded, aria-controls, aria-activedescendant
 * - Keyboard navigation: ArrowDown/Up/Enter/Escape/Home/End
 *
 * Prepared to be connected to real /estimate API in a future iteration.
 */
interface SearchSimulatorProps {
  /** Optional callback fired when user selects a dish or runs a search */
  onInteract?: () => void;
}

export function SearchSimulator({ onInteract }: SearchSimulatorProps = {}) {
  const [query, setQuery] = useState('pulpo a feira');
  const [state, setState] = useState<SimulatorState>('result');
  const [activeDish, setActiveDish] = useState<Dish>(DISHES[1]!); // pulpo a feira default
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  /** Filter dishes whose query includes the current input (case-insensitive) */
  const suggestions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return DISHES.filter((d) => d.query.includes(normalized));
  }, [query]);

  /** True if the current query matches at least one dish */
  const hasMatch = suggestions.length > 0;

  function selectDish(dish: Dish) {
    setQuery(dish.query);
    setShowDropdown(false);
    setActiveIndex(-1);
    setState('loading');
    onInteract?.();
    setTimeout(() => {
      setActiveDish(dish);
      setState('result');
    }, LOADING_DURATION_MS);
  }

  function handleRun() {
    if (!hasMatch) return;
    const match = suggestions[0];
    if (!match) return;
    selectDish(match);
  }

  function handleInputChange(value: string) {
    setQuery(value);
    setShowDropdown(true);
    setActiveIndex(-1);
    setState('idle');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const isOpen = showDropdown && suggestions.length > 0;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        if (!isOpen) {
          setShowDropdown(true);
          if (suggestions.length > 0) setActiveIndex(0);
        } else {
          setActiveIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : prev
          );
        }
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        if (isOpen) {
          setActiveIndex((prev) => (prev > 0 ? prev - 1 : -1));
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (isOpen && activeIndex >= 0) {
          const dish = suggestions[activeIndex];
          if (dish) selectDish(dish);
        } else {
          handleRun();
        }
        break;
      }
      case 'Escape': {
        e.preventDefault();
        setShowDropdown(false);
        setActiveIndex(-1);
        break;
      }
      case 'Home': {
        if (isOpen) {
          e.preventDefault();
          setActiveIndex(0);
        }
        break;
      }
      case 'End': {
        if (isOpen) {
          e.preventDefault();
          setActiveIndex(suggestions.length - 1);
        }
        break;
      }
    }
  }

  const noResult = query.trim().length > 0 && !hasMatch && state === 'idle';

  /** aria-expanded is true when dropdown is open OR when no-match UI is showing (and not dismissed) */
  const isExpanded = (showDropdown && suggestions.length > 0) || (noResult && showDropdown);

  return (
    <div className="card-surface overflow-hidden p-4 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
        {/* Left: input + controls */}
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-mist px-3 py-1 text-sm font-medium text-botanical">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Demo interactiva
          </div>
          <h3 className="text-2xl font-semibold tracking-tight text-slate-950">
            Haz una búsqueda y mira qué cambia
          </h3>
          <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
            Más que un número: una respuesta que te dice qué sabe, de dónde lo sabe y cuándo no
            debería presentarse como verificado.
          </p>

          {/* Search input */}
          <div className="relative mt-5">
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  role="combobox"
                  aria-expanded={isExpanded}
                  aria-controls={isExpanded ? 'search-suggestions-listbox' : undefined}
                  aria-activedescendant={
                    activeIndex >= 0 ? `search-option-${activeIndex}` : undefined
                  }
                  value={query}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ej. Pulpo a feira"
                  aria-label="Buscar plato"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-11 py-4 text-base outline-none transition focus:border-botanical focus:ring-4 focus:ring-green-100"
                />
              </label>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleRun}
                disabled={!hasMatch}
                className="rounded-2xl bg-botanical px-5 py-4 text-base font-semibold text-white shadow-lift disabled:opacity-40"
                aria-label="Ver resultado"
              >
                Ver resultado
              </motion.button>
            </div>

            {/* Autocomplete dropdown */}
            {showDropdown && suggestions.length > 0 && (
              <ul
                id="search-suggestions-listbox"
                role="listbox"
                aria-label="Sugerencias"
                className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft"
              >
                {suggestions.map((dish, index) => (
                  <li
                    key={dish.query}
                    id={`search-option-${index}`}
                    role="option"
                    aria-selected={activeDish?.query === dish.query}
                    onMouseDown={() => selectDish(dish)}
                    className={`w-full cursor-pointer px-4 py-3 text-left text-sm text-slate-700 hover:bg-mist ${
                      index === activeIndex ? 'bg-mist' : ''
                    }`}
                  >
                    <span className="font-medium">{dish.dish}</span>
                    <span className="ml-2 text-xs text-slate-400">{dish.level}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* No result — improved UX with query-interpolated message and suggestion pills */}
            {noResult && showDropdown && (
              <div className="animate-fade-in mt-2">
                <p className="text-sm text-slate-500">
                  No tenemos datos sobre &lsquo;{query.trim()}&rsquo; todavía. Prueba con uno de estos platos:
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-sm">
                  {DISHES.slice(0, 4).map((dish) => (
                    <button
                      key={dish.query}
                      onClick={() => selectDish(dish)}
                      aria-label={dish.dish}
                      className="rounded-full border px-3 py-1.5 transition border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    >
                      {dish.query}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Quick-select pills — hidden during no-match state to avoid duplicate pills */}
          {!noResult && (
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              {DISHES.map((dish) => (
                <button
                  key={dish.query}
                  onClick={() => selectDish(dish)}
                  aria-label={dish.dish}
                  className={`rounded-full border px-3 py-1.5 transition ${
                    activeDish?.query === dish.query && state === 'result'
                      ? 'border-botanical bg-mist text-botanical'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {dish.query}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: result card */}
        <AnimatePresence mode="wait">
          <motion.div
            key={state === 'loading' ? 'loading' : activeDish?.dish ?? 'empty'}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="rounded-[28px] border border-slate-200 bg-slate-950 p-5 text-white"
          >
            {state === 'loading' ? (
              <div className="space-y-4">
                <div className="text-sm text-white/70">
                  Preparando la mejor respuesta disponible…
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <motion.div
                    className="h-full rounded-full bg-energy"
                    initial={{ width: '0%' }}
                    animate={{ width: '84%' }}
                    transition={{ duration: 0.75 }}
                  />
                </div>
                <p className="text-sm text-white/70">
                  Buscando fuentes oficiales, ingredientes y platos comparables.
                </p>
              </div>
            ) : state === 'idle' ? (
              <div className="py-8 text-center text-sm text-white/50">
                Selecciona un plato para ver el resultado.
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <p className="text-sm text-white/55">Resultado</p>
                  <h4 className="mt-1 text-2xl font-semibold">{activeDish.dish}</h4>
                  <div className="mt-3 inline-flex rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-green-200">
                    {getLevelDisplay(activeDish.level, activeDish.confidence)}
                  </div>
                  <p className="mt-3 max-w-md text-sm leading-6 text-white/75">{activeDish.note}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['kcal', activeDish.kcal],
                    ['Proteína', `${activeDish.protein} g`],
                    ['Hidratos', `${activeDish.carbs} g`],
                    ['Grasa', `${activeDish.fat} g`],
                  ].map(([label, value]) => (
                    <div
                      key={String(label)}
                      className="rounded-2xl border border-white/10 bg-white/5 p-4"
                    >
                      <div className="text-xs uppercase tracking-[0.2em] text-white/45">
                        {label}
                      </div>
                      <div className="mt-2 text-xl font-semibold">{value}</div>
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-white/45">
                    Guardrail de seguridad
                  </div>
                  <div className="mt-2 flex items-start gap-2 text-sm text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {activeDish.allergen}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
