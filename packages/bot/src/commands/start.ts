// /start and /help command handler — returns static welcome message.

/**
 * Returns the static welcome/help text for /start and /help commands.
 * No API call. Pure function.
 */
export function handleStart(): string {
  return [
    '*Bienvenido a foodXPlorer Bot* 🍽',
    '',
    'Estos son los comandos disponibles:',
    '',
    '/buscar \\<plato\\> — Busca platos por nombre',
    '/estimar \\<plato\\> \\[en \\<cadena\\>\\] — Estima la informacion nutricional',
    '/receta \\<ingredientes\\> — Calcula la informacion nutricional de una receta',
    '/restaurantes \\[cadena\\] — Lista restaurantes \\(filtro opcional por cadena\\)',
    '/platos \\<restaurantId\\> — Lista los platos de un restaurante',
    '/cadenas — Muestra todas las cadenas activas',
    '/info — Informacion del bot y estado de la API',
    '/help — Muestra esta ayuda',
    '',
    '_Todos los datos son aproximados\\. Consulta siempre las fuentes oficiales\\._',
  ].join('\n');
}
