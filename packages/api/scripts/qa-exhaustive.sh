#!/bin/bash
# =============================================================================
# qa-exhaustive.sh — NutriXplorer Conversation API QA Battery
# =============================================================================
#
# Purpose
#   Smoke-test the conversation pipeline (POST /conversation/message) against
#   a deployed API with a broad sample of Spanish queries covering portion
#   terms, plurals, diminutives, counts, drinks, menus, comparisons,
#   conversational wrappers, and edge cases.
#
# Source
#   Drafted 2026-04-21 during the QA Improvement Sprint
#   (docs/research/qa-improvement-sprint-report-2026-04-21.md). Current
#   baseline file /tmp/qa-post-sprint-results.txt reports 300/350 OK (85.7%)
#   after F-NLP + F-MORPH + F-COUNT + F-DRINK + F-DRINK-FU1 landed.
#
# Environment variables
#   API   Base URL of the deployed API.
#         Default: https://api-dev.nutrixplorer.com
#   KEY   x-api-key header value.
#         Default: fxp_admin_dev_testing_2026 (admin tier bypasses rate
#         limits per F-TIER). Override for prod runs.
#
# Dependencies
#   bash (>= 3.2), curl, python3 (stdlib only), jq (>= 1.5)
#
# Usage
#   # Against dev (defaults):
#   ./packages/api/scripts/qa-exhaustive.sh | tee qa-dev-$(date +%Y%m%d).txt
#
#   # Against prod:
#   API=https://api.nutrixplorer.com KEY=<prod-admin-key> \
#     ./packages/api/scripts/qa-exhaustive.sh | tee qa-prod-$(date +%Y%m%d).txt
#
# Output format
#   Each query emits one line. Result classifications:
#     OK <name> | <kcal>kcal | <g>g | m=<mult> | b=<basekcal> | <portion> | <source>
#     CMP <nameA>=<kcalA> vs <nameB>=<kcalB>
#     MENU [<item1>=<kcal1>|<item2>=<kcal2>|...]
#     NULL intent=<detected-intent>
#     ERR <code>: <message>
#   Final line prints totals: TOTAL | OK | NULL | FAIL
#
# Baseline snapshots (dev API)
#   2026-04-21 pre-sprint:  ~230/350 OK (~66%)   — baseline on original 350
#   2026-04-21 post-sprint: 300/350  OK (85.7%)  — target on original 350
#   (pending) 2026-04-22 expanded battery: 640 queries + 10 endpoint smokes
#
# Changelog
#   2026-04-21  Initial 350-query battery across 13 categories (QA Improvement Sprint).
#   2026-04-22  Versioned into packages/api/scripts/; header + README added;
#               API and KEY made overridable via env.
#   2026-04-22  Expanded to 640 queries + 10 endpoint smokes (650 total):
#               + cat 14       endpoint/envelope smoke (10 HTTP-status checks)
#               + cat 15-20    assistant (90 queries): NLP gaps, drink edges,
#                              plural disagreement, casing, user-perspective NL,
#                              nutrient-specific
#               + cat 21-24    Gemini (100 queries): regional cuisine,
#                              international-in-Spain, bar talk, diets / prep
#               + cat 25-29    Codex (100 queries): adversarial, voice-STT-like,
#                              compound structures, measurement edges, temporal
#
# Related
#   - docs/research/qa-2026-04-21-exhaustive-results.md
#   - docs/research/qa-improvement-sprint-report-2026-04-21.md
#   - packages/api/scripts/README.md
# =============================================================================

API="${API:-https://api-dev.nutrixplorer.com}"
KEY="${KEY:-fxp_admin_dev_testing_2026}"
COUNT=0
OK=0
FAIL=0
NULL=0

q() {
  local query="$1"
  # BUG-QA-SCRIPT-001 (H2): queries may contain characters that need JSON escaping
  # (", \, newlines, tabs, control chars, Unicode). Delegating to jq handles every
  # corner correctly — the previous bash-only `${query//\"/\\\"}` only covered ".
  local body
  body=$(jq -cn --arg t "$query" '{text:$t}')
  COUNT=$((COUNT + 1))
  local resp=$(curl -s --max-time 10 -X POST "$API/conversation/message" \
    -H "x-api-key: $KEY" \
    -H "Content-Type: application/json" \
    -d "$body")
  local line=$(echo "$resp" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  if not d.get('success'):
    print(f'ERR {d.get(\"error\",{}).get(\"code\",\"?\")}: {d.get(\"error\",{}).get(\"message\",\"\")[:60]}')
    sys.exit()
  intent=d.get('data',{}).get('intent','?')
  est=d.get('data',{}).get('estimation')
  ests=d.get('data',{}).get('estimations',[])
  comp=d.get('data',{}).get('comparison')
  # Handle comparison
  if comp:
    a=comp.get('dishA',{}).get('estimation',{}).get('result')
    b=comp.get('dishB',{}).get('estimation',{}).get('result')
    na=(a.get('nameEs','?') if a else '?')[:15]
    nb=(b.get('nameEs','?') if b else '?')[:15]
    ca=round(a['nutrients']['calories']) if a else '?'
    cb=round(b['nutrients']['calories']) if b else '?'
    print(f'CMP {na}={ca}kcal vs {nb}={cb}kcal')
    sys.exit()
  # Handle menu
  if ests:
    parts=[]
    for e in ests:
      r=e.get('result')
      if r:
        parts.append(f'{(r.get(\"nameEs\") or \"?\")[:12]}={round(r[\"nutrients\"][\"calories\"])}')
      else:
        parts.append('null')
    print(f'MENU [{\"|\".join(parts)}]')
    sys.exit()
  items=[est] if est else []
  if not items:
    print(f'NULL intent={intent}')
    sys.exit()
  for e in items:
    r=e.get('result')
    pa=e.get('portionAssumption')
    bn=e.get('baseNutrients')
    mult=e.get('portionMultiplier',1.0)
    if r:
      name=(r.get('nameEs') or r.get('name','?'))[:25]
      kcal=round(r['nutrients']['calories'])
      pg=r.get('portionGrams')
      src=(r.get('source',{}).get('name','?'))[:20]
      base_str=f'b={round(bn[\"calories\"])}' if bn else '-'
      pa_str=f'{pa[\"term\"]}/{pa[\"grams\"]}g/{pa[\"source\"][:3]}' if pa else '-'
      print(f'OK {name} | {kcal}kcal | {pg}g | m={mult} | {base_str} | {pa_str} | {src}')
    else:
      print(f'NULL result')
except Exception as ex:
  print(f'ERR parse: {ex}')
" 2>/dev/null)
  # Count results
  if echo "$line" | grep -q "^OK\|^CMP\|^MENU"; then
    OK=$((OK + 1))
  elif echo "$line" | grep -q "^NULL"; then
    NULL=$((NULL + 1))
  else
    FAIL=$((FAIL + 1))
  fi
  printf "%-4s %-50s %s\n" "$COUNT." "$query" "$line"
}

# smoke — endpoint/envelope smoke helper (HTTP status assertion only).
# Usage: smoke "<label>" "<expected-status-regex>" <curl-args...>
# Examples:
#   smoke "GET /health"            "200"      "$API/health" -H "x-api-key: $KEY"
#   smoke "POST /conv/msg bad JSON" "400|415" -X POST "$API/conversation/message" \
#     -H "x-api-key: $KEY" -H "Content-Type: application/json" -d "not-json"
smoke() {
  local label="$1"
  local expected="$2"
  shift 2
  COUNT=$((COUNT + 1))
  local status
  status=$(curl -s --max-time 10 -o /dev/null -w "%{http_code}" "$@" 2>/dev/null)
  local line
  if [[ "$status" =~ ^(${expected})$ ]]; then
    line="OK_SMOKE http=$status"
    OK=$((OK + 1))
  else
    line="FAIL_SMOKE http=$status expected=$expected"
    FAIL=$((FAIL + 1))
  fi
  printf "%-4s %-50s %s\n" "$COUNT." "$label" "$line"
}

echo "=========================================="
echo " Exhaustive QA — $(date '+%Y-%m-%d %H:%M')"
echo "=========================================="

echo ""
echo "=== 1. ALL 30 PRIORITY DISHES × 4 TERMS (120 queries) ==="
for dish in "croquetas" "patatas bravas" "gambas al ajillo" "aceitunas" "jamón ibérico" "queso manchego" "boquerones" "calamares" "chopitos" "ensaladilla rusa" "tortilla de patatas" "pan con tomate" "chorizo" "morcilla" "pulpo a la gallega" "gazpacho" "salmorejo" "albóndigas" "alitas de pollo" "empanadillas" "mejillones" "navajas" "champiñones al ajillo" "pimientos de padrón" "churros" "lentejas" "fabada" "cocido madrileño" "paella" "arroz negro"; do
  q "una tapa de $dish"
  q "un pintxo de $dish"
  q "una ración de $dish"
  q "media ración de $dish"
done

echo ""
echo "=== 2. BARE DISH NAMES — NO PORTION TERM (30 queries) ==="
for dish in "croquetas de jamón" "tortilla de patatas" "paella valenciana" "gazpacho" "fabada asturiana" "cocido madrileño" "pulpo a la gallega" "calamares a la romana" "patatas bravas" "gambas al ajillo" "ensaladilla rusa" "boquerones en vinagre" "pimientos de padrón" "salmorejo" "lentejas estofadas" "albóndigas en salsa" "churros con chocolate" "flan casero" "natillas" "tarta de queso" "merluza a la plancha" "filete de pollo" "entrecot de ternera" "bacalao al pil-pil" "arroz con leche" "sopa de ajo" "crema de calabacín" "ensalada mixta" "huevos rotos con jamón" "bocadillo de calamares"; do
  q "$dish"
done

echo ""
echo "=== 3. DRINKS — ALL VARIATIONS (30 queries) ==="
q "una caña de cerveza"
q "un tercio de cerveza"
q "una cerveza"
q "un doble de cerveza"
q "cerveza sin alcohol"
q "una clara"
q "una copa de vino tinto"
q "una copa de vino blanco"
q "un vaso de vino tinto"
q "una botella de vino tinto"
q "un tinto de verano"
q "una sangría"
q "un vermut"
q "una copa de fino"
q "una copa de cava"
q "un gin tonic"
q "un rebujito"
q "una sidra"
q "un licor de hierbas"
q "una manzanilla"
q "una horchata"
q "un granizado de limón"
q "un café solo"
q "un café con leche"
q "un cortado"
q "un cola cao"
q "un zumo de naranja"
q "una coca cola"
q "un aquarius"
q "un batido de chocolate"

echo ""
echo "=== 4. DIMINUTIVES + COLLOQUIAL (20 queries) ==="
q "una tapita de aceitunas"
q "un platito de patatas bravas"
q "una racioncita de gambas"
q "un pintxito de tortilla"
q "una cañita de cerveza"
q "una copita de vino"
q "unas croquetitas"
q "un poquito de paella"
q "unas gambitas al ajillo"
q "unos boqueronitos"
q "un trocito de tortilla"
q "un poco de gazpacho"
q "un plato de lentejas"
q "un cuenco de fabada"
q "un bol de gazpacho"
q "un vasito de horchata"
q "una jarrita de sangría"
q "un par de croquetas"
q "un pellizco de jamón"
q "medio bocadillo de calamares"

echo ""
echo "=== 5. EXPLICIT COUNTS (20 queries) ==="
q "2 croquetas"
q "6 croquetas de jamón"
q "3 pinchos de tortilla"
q "4 empanadillas"
q "12 gambas al ajillo"
q "8 aceitunas"
q "5 churros"
q "2 huevos fritos"
q "1 flan"
q "3 torrijas"
q "10 mejillones"
q "2 cañas de cerveza"
q "3 copas de vino"
q "4 albóndigas"
q "6 pimientos de padrón"
q "2 raciones de patatas bravas"
q "media docena de croquetas"
q "un par de tapas de jamón"
q "tres tapas: croquetas, bravas y boquerones"
q "he comido 2 bocadillos de jamón"

echo ""
echo "=== 6. SIZE MODIFIERS (20 queries) ==="
q "ración grande de paella"
q "ración pequeña de croquetas"
q "media ración grande de calamares"
q "media ración pequeña de gambas"
q "ración normal de tortilla"
q "tapa grande de jamón"
q "pintxo grande de tortilla"
q "una ración doble de patatas bravas"
q "una ración extra de croquetas"
q "ración enorme de cocido"
q "una buena ración de fabada"
q "una ración generosa de lentejas"
q "tapa pequeña de queso"
q "un buen plato de paella"
q "una ración para compartir de croquetas"
q "media ración de croquetas"
q "cuarto de ración de jamón"
q "ración y media de gambas"
q "dos raciones de patatas bravas"
q "triple de croquetas"

echo ""
echo "=== 7. ACCENT AND SPELLING VARIATIONS (20 queries) ==="
q "racion de paella"
q "media racion de calamares"
q "pincho de tortilla"
q "pinchos de croquetas"
q "tapas de jamon"
q "racion de jamon iberico"
q "media racion de gambas"
q "pintxo de pulpo"
q "racion de chuleton"
q "chuleton de buey"
q "crema de calabazin"
q "albondigas en salsa"
q "bacalao al pilpil"
q "espaguetis boloñesa"
q "espaguettis carbonara"
q "macarrrones con tomate"
q "tarta de quesso"
q "flam casero"
q "natilla"
q "tortiya de patatas"

echo ""
echo "=== 8. PLURAL FORMS (15 queries) ==="
q "unas tapas de croquetas"
q "unos pinchos de tortilla"
q "unas raciones de gambas"
q "unos boquerones en vinagre"
q "unas patatas bravas"
q "unos calamares a la romana"
q "unas aceitunas"
q "unos churros"
q "unas gambas al ajillo"
q "unas cañas"
q "unas copas de vino"
q "unas tapas variadas"
q "unos pimientos de padrón"
q "unas alitas de pollo"
q "unos mejillones"

echo ""
echo "=== 9. COMPARISON QUERIES (15 queries) ==="
q "compara tapa de croquetas y tapa de patatas bravas"
q "compara ración de paella y ración de arroz negro"
q "compara pintxo de tortilla y pintxo de jamón"
q "qué tiene más calorías, croquetas o patatas bravas"
q "qué engorda más, una ración de paella o una de fabada"
q "compara gambas al ajillo y calamares"
q "croquetas vs patatas bravas"
q "compara cerveza y vino tinto"
q "compara una tapa de queso manchego y una tapa de jamón"
q "qué es mejor, una ensalada mixta o unas lentejas"
q "compara un bocadillo de calamares y un bocadillo de jamón"
q "compara media ración de croquetas y media ración de gambas"
q "más sano croquetas o boquerones"
q "compara flan y natillas"
q "compara tarta de queso y arroz con leche"

echo ""
echo "=== 10. MENU QUERIES (10 queries) ==="
q "menú del día: ensalada mixta, merluza a la plancha, flan casero"
q "menú: gazpacho, pollo al ajillo, arroz con leche"
q "he comido: tapa de croquetas, ración de gambas, copa de vino"
q "menú del día: lentejas, filete de pollo, fruta"
q "para comer: ensalada, paella, tarta de queso"
q "menú: sopa de ajo, entrecot con patatas, natillas"
q "hoy he almorzado gazpacho y una ración de croquetas"
q "cena: tortilla de patatas y ensalada"
q "desayuno: café con leche, tostada con tomate, zumo de naranja"
q "merienda: café con leche y tarta de manzana"

echo ""
echo "=== 11. CHAIN RESTAURANT ITEMS (15 queries) ==="
q "big mac"
q "whopper"
q "mcnuggets"
q "pizza margarita"
q "kebab"
q "sushi"
q "hamburguesa"
q "hot dog"
q "wrap de pollo"
q "nuggets de pollo"
q "patatas fritas mcdonalds"
q "coca cola grande"
q "ensalada mcdonalds"
q "bocadillo de subway"
q "burrito"

echo ""
echo "=== 12. NATURAL LANGUAGE / CONVERSATIONAL (20 queries) ==="
q "me he tomado una ración de croquetas"
q "acabo de comer paella"
q "he desayunado café con leche y tostada"
q "para cenar tuve ensalada mixta"
q "quiero saber las calorías de un bocadillo de jamón"
q "cuántas calorías tiene una ración de patatas bravas"
q "información nutricional de la fabada"
q "necesito saber los nutrientes del gazpacho"
q "hoy he comido lentejas y de postre flan"
q "cuánto engorda una ración de croquetas"
q "es sano comer pulpo a la gallega"
q "me voy a pedir una tapa de queso manchego"
q "anoche cené tortilla de patatas con ensalada"
q "me he bebido dos cañas de cerveza"
q "he merendado churros con chocolate"
q "cuánta proteína tiene el pollo a la plancha"
q "una ración de gambas al ajillo para compartir"
q "me pido unas bravas y unos boquerones"
q "quiero comer algo ligero"
q "recomiéndame algo con pocas calorías"

echo ""
echo "=== 13. EDGE CASES (15 queries) ==="
q "una ración de croquetas de jamón ibérico"
q "ración de algo"
q "tapa"
q ""
q "asdfghjkl"
q "🍕🍔🌮"
q "ración de ración"
q "una ración muy grande de patatas bravas"
q "ración de croquetas con ensalada"
q "un poco de todo"
q "el menú del restaurante"
q "qué me recomiendas"
q "agua"
q "pan"
q "sal"

echo ""
echo "=== 14. ENDPOINT / ENVELOPE SMOKE (10 checks) ==="
smoke "GET /health"                                "200"      "$API/health" -H "x-api-key: $KEY"
smoke "GET /health/voice-budget (F091 flat env)"   "200"      "$API/health/voice-budget" -H "x-api-key: $KEY"
smoke "GET /health/nonexistent"                    "404"      "$API/health/nonexistent" -H "x-api-key: $KEY"
smoke "POST /conv/msg empty body"                  "400|422"  -X POST "$API/conversation/message" -H "x-api-key: $KEY" -H "Content-Type: application/json" -d "{}"
smoke "POST /conv/msg invalid JSON"                "400"      -X POST "$API/conversation/message" -H "x-api-key: $KEY" -H "Content-Type: application/json" --data-binary "not-json"
# BUG-QA-SCRIPT-001 (H3): /conversation/message is anonymous-OK per ADR-001 (EAA voice
# accessibility). Server correctly returns 200 for unauthenticated callers. Accepting 200|401
# keeps the smoke useful if policy ever flips to required-auth.
smoke "POST /conv/msg missing api key"             "200|401"  -X POST "$API/conversation/message" -H "Content-Type: application/json" -d '{"text":"croquetas"}'
smoke "POST /conv/audio no body"                   "400|415"  -X POST "$API/conversation/audio" -H "x-api-key: $KEY"
smoke "POST /conv/audio wrong content-type"        "400|415"  -X POST "$API/conversation/audio" -H "x-api-key: $KEY" -H "Content-Type: text/plain" -d "hello"
# BUG-API-AUDIO-4XX-001: /conversation/audio allows anonymous callers per F091 EAA design
# (same reasoning as ADR-001 for /conversation/message; see PR #195 H3 fix).
# This smoke sends Content-Type: multipart/form-data without a boundary → 400 VALIDATION_ERROR.
# Accepting 400|415 because the exact code depends on which guard fires first.
smoke "POST /conv/audio missing api key"           "400|415"  -X POST "$API/conversation/audio" -H "Content-Type: multipart/form-data"
smoke "GET /conv/message (wrong method)"           "404|405"  "$API/conversation/message" -H "x-api-key: $KEY"

echo ""
echo "=== 15. NLP AMBIGUOUS GAPS — wrappers + counts + menus (15 queries) ==="
q "me he tomado dos raciones de croquetas"
q "acabo de beberme dos cañas"
q "he cenado una ración de paella y una copa de vino"
q "anoche cené tortilla con ensalada y un vaso de vino"
q "esta mañana he tomado café con leche y tostada"
q "para comer he pedido paella, calamares y agua"
q "estoy comiendo una ración de lentejas con chorizo"
q "voy a pedirme una tapa de patatas bravas"
q "pienso pedir una ración de croquetas"
q "dime cuánto engorda media ración de fabada"
q "he ido al bar y me he tomado tres cañas"
q "creo que voy a cenar una pizza margarita"
q "me apetece un bocata de calamares"
q "cuando salí anoche me bebí dos cervezas"
q "tenía tanta hambre que me he comido tres bocadillos"

echo ""
echo "=== 16. DRINK VOLUME EDGES (15 queries) ==="
q "un doble de cerveza"
q "una copa de vino dulce"
q "una copa de oporto"
q "una copa de jerez"
q "un chato de vino"
q "una jarra de cerveza"
q "una pinta de cerveza"
q "una jarra de sangría"
q "un botellín de cerveza"
q "una caña pequeña"
q "una caña grande"
q "un tercio sin alcohol"
q "un agua con gas"
q "una horchata grande"
q "un zumo de naranja recién exprimido"

echo ""
echo "=== 17. PLURAL / SINGULAR DISAGREEMENT (15 queries) ==="
q "las paellas"
q "un paellas"
q "dos cafes"
q "tres tortillas"
q "las croquetas de jamón"
q "el patatas bravas"
q "una gambas"
q "unos paella"
q "muchas croquetas"
q "pocas aceitunas"
q "varios pinchos"
q "algunos boquerones"
q "todas las albóndigas"
q "ambas paellas"
q "ninguna croqueta"

echo ""
echo "=== 18. DISCOVERED EDGES — casing, spacing, punctuation (15 queries) ==="
q "CROQUETAS DE JAMON"
q "CrOqUeTaS"
q "croqueta de jamon ibérica"
q "media-ración de croquetas"
q "ración  de  croquetas"
q "croquetas sin gluten"
q "croquetas caseras"
q "croquetas de la abuela"
q "calamares a la plancha con limón"
q "bocadillo-de-calamares"
q "una ración de croquetas!"
q "¿una ración de croquetas?"
q "croquetas... de jamón"
q "croquetas, jamón y queso"
q "ración de croquetas (de jamón)"

echo ""
echo "=== 19. USER-PERSPECTIVE NATURAL LANGUAGE (20 queries) ==="
q "oye, ¿cuántas calorías tiene un cafecito?"
q "me quiero pedir un bocata de calamares"
q "estaba pensando en una pizza margarita"
q "ayer cené un chuletón de buey con patatas"
q "¿qué engorda más paella o arroz con pollo?"
q "¿es muy grasa la fabada?"
q "si me como un paquete entero de patatas fritas, ¿cuántas calorías?"
q "me he metido entre pecho y espalda una ración de croquetas"
q "he entrado en un bar y me he pedido una caña y unas bravas"
q "hoy me he portado mal y he comido pizza"
q "cena ligera: ensalada y fruta"
q "calorías de un menú del día"
q "tengo hambre, ¿qué me pido?"
q "voy al restaurante, ¿qué pido si estoy a dieta?"
q "me da pereza cocinar, me pido unas alitas"
q "estoy comiendo por estrés, una tableta entera de chocolate"
q "salí a correr y después me merecí unas croquetas"
q "ayer fui a un asador y pedí chuletón con patatas"
q "desayuné tarde y me tomé dos tostadas con aguacate"
q "he pedido comida a domicilio: pizza y ensalada"

echo ""
echo "=== 20. NUTRIENT-SPECIFIC QUERIES (10 queries) ==="
q "cuántas proteínas tiene la pechuga de pollo"
q "cuántas grasas tiene el aguacate"
q "cuántos hidratos tiene la pasta"
q "cuánta fibra tiene la ensalada"
q "cuántos azúcares tiene la tarta de queso"
q "qué vitaminas tiene el brócoli"
q "proteínas en 100g de atún"
q "grasas en un huevo frito"
q "cuánto sodio tiene el jamón serrano"
q "nutrientes de un plátano"

echo ""
echo "=== 21. COCINA REGIONAL ESPAÑOLA (30 queries) ==="
q "una ración de papas arrugadas con mojo picón"
q "un cachopo para compartir"
q "quería probar el ternasco de aragón"
q "media de pescaíto frito"
q "un plato de migas extremeñas"
q "qué tal está el bacalao al pil-pil"
q "ponme una tapa de zarangollo murciano"
q "ración de txangurro a la donostiarra"
q "un trozo de empanada gallega de zamburiñas"
q "para mí, fabes con almejas"
q "un tumbet mallorquín"
q "tráeme una de escalivada con anchoas"
q "quiero probar la ropa vieja canaria"
q "un plato de marmitako de bonito"
q "media ración de esqueixada de bacallà"
q "un arroz a banda para dos"
q "qué es el gofio escaldado"
q "una de botifarra amb mongetes"
q "un trozo de ensaimada de crema"
q "me pones una sidra natural y un platito de chorizo a la sidra"
q "el lacón con grelos es de temporada?"
q "una de michirones para picar"
q "ración de conejo en salmorejo"
q "cuánto cuesta la sobrassada con miel"
q "un esgarraet valenciano"
q "un gazpachuelo malagueño bien caliente"
q "qué lleva la berza jerezana"
q "un talo con chistorra, por favor"
q "y de postre, unas casadielles"
q "una horchata con fartons para merendar"
echo ""
echo "=== 22. INTERNACIONAL EN ESPAÑA (25 queries) ==="
q "un poke bowl de salmón y aguacate"
q "un burrito de cochinita pibil con extra de picante"
q "tenéis ramen de miso?"
q "una de pad thai de langostinos"
q "un shawarma de pollo solo carne"
q "una ración de falafel con salsa de yogur"
q "quiero un pastel de nata"
q "un tiramisú casero de postre"
q "spaghetti carbonara pero la receta original, sin nata"
q "un risotto de setas y trufa"
q "una hamburguesa gourmet con queso de cabra y cebolla caramelizada"
q "qué incluye el brunch del domingo?"
q "un menú de 12 piezas de sushi variado"
q "dos nigiris de pez mantequilla con trufa"
q "un uramaki roll de atún picante"
q "tacos al pastor con cilantro y piña"
q "bao de panceta a baja temperatura"
q "una arepa de reina pepiada"
q "tenéis gyozas a la plancha?"
q "un ceviche de corvina clásico"
q "musaka griega"
q "el hummus con pan de pita es casero?"
q "un tataki de atún con sésamo"
q "quiero probar el steak tartar"
q "un carpaccio de buey con parmesano"
echo ""
echo "=== 23. CHARLA DE BAR Y RESTAURANTE (25 queries) ==="
q "me bajo a tomar un vermut con una tapa de gildas"
q "hoy vamos de tapeo, sorpréndenos"
q "¿qué tenéis en el menú del día de primero?"
q "para la mesa, una de chopitos y una de bravas"
q "ponme una clara con limón bien fría"
q "me pones un doble de cerveza y unas aceitunas"
q "tráeme la carta de vinos, por favor"
q "para empezar, compartimos la parrillada de verduras"
q "de segundo, el solomillo al punto, por favor"
q "marchando un montadito de pringá"
q "cóbrame un mosto y el pincho de tortilla"
q "la cuenta, cuando puedas"
q "un tercio de Estrella Galicia y un bocata de lomo con queso"
q "vamos a picotear algo, ¿qué nos recomiendas?"
q "una ración de calamares a la andaluza para el centro"
q "un quinto y una marinera"
q "quiero algo ligero, ¿qué ensaladas tenéis?"
q "ponme lo que sea, que vengo con un hambre que no veas"
q "un café solo y un chupito de orujo de hierbas"
q "¿el menú infantil qué lleva?"
q "para beber, una botella de agua grande con gas"
q "un bocadillo de \"blanco y negro\" con habas"
q "un completo, con su \"gasto\" y todo"
q "me pones un café del tiempo"
q "un asiático, por favor"
echo ""
echo "=== 24. DIETAS Y PREPARACIONES (20 queries) ==="
q "el menú del día tiene opciones vegetarianas?"
q "qué platos tenéis sin gluten?"
q "busco algo vegano que no sea solo ensalada"
q "la salsa de los chipirones lleva lactosa?"
q "opciones keto para cenar?"
q "tenéis algún postre paleo?"
q "un plato de pollo a la plancha con verduras al vapor"
q "el pescado es a la brasa o frito?"
q "la lasaña de verduras es apta para ovolactovegetarianos?"
q "quiero algo alto en proteína y bajo en carbohidratos"
q "el tartar de atún es crudo, verdad?"
q "qué aceite usáis para freír las patatas?"
q "me gustaría el entrecot poco hecho, casi crudo"
q "el salmón marinado lo hacéis vosotros?"
q "el bonito en escabeche es de lata o casero?"
q "el pulpo es a la brasa?"
q "el pollo al ajillo está muy guisado?"
q "qué tipo de pan sin gluten ofrecéis?"
q "el gazpacho es ecológico?"
q "tenéis leche de avena para el café?"
echo ""
echo "=== 25. ADVERSARIAL Y AMBIGUOS (20 queries) ==="
q "no quiero saber si esto engorda ni una charla larga, solo calcula las calorías aproximadas de un plato de arroz negro con alioli"
q "ayer iba a pedir una hamburguesa de ternera completa, pero al final fue medio plato de pasta carbonara y unas aceitunas"
q "me pedí un wrap with chicken, extra cheese y salsa ranch, pero era tamaño pequeño tirando a grande"
q "quiero comparar un poke bowl de salmón con arroz frente a un sandwich mixto, aunque igual el sandwich era parte del menú"
q "media ración grande de risotto de setas, o quizá una ración pequeña abundante, ¿qué estimas?"
q "tres cuartos de media ración de lasaña boloñesa con bechamel, sin contar el pan que venía al lado"
q "quería un bocadillo de lomo, bueno mejor pon una ensalada césar con pollo crujiente"
q "me tomé una sopa ramen with pork belly and egg, no sé si contarlo como sopa o como plato principal"
q "no fue cena completa, solo un plato hondo de crema de calabaza y después una tostada de aguacate"
q "calcula mi lunch: bowl vegano con quinoa, tofu, edamame y salsa de cacahuete"
q "una ración mínima pero bastante llena de nachos con guacamole, queso fundido y chili"
q "si digo pollo teriyaki con arroz y ensalada, ¿me lo partes por componentes o como plato único?"
q "no necesito consejos, solo estimación de un plato de gnocchi con pesto y parmesano"
q "pedí fish and chips en un bar español, porción mediana con patatas y salsa tártara"
q "me comí medio menú de pasta al pesto y filete empanado, pero el filete era de otro plato"
q "un cuarto de ración doble de costillas barbacoa, sé que suena raro pero fue lo que sobró"
q "en realidad no era una pizza, era una focaccia con burrata, mortadela y pistacho, tamaño individual"
q "quiero saber proteínas de una ensalada de garbanzos con atún y huevo, no las calorías totales"
q "me pedí una smash burger con bacon, fries aparte, y luego compartí la mitad de las fries"
q "un plato combinado de pechuga empanada, arroz blanco y ensalada, pero sin saber cantidades exactas"
echo ""
echo "=== 26. VOZ TRANSCRITA Y ERRORES STT (20 queries) ==="
q "ayer por la noche cene arroz con pollo y una sopa de verduras"
q "cuantas calorias tiene comerlasaña con queso por encima"
q "me comi una tortiya francesa de dos huevos con pan"
q "calcula un plato de macarrones con tomate y chorizo porfa"
q "hoy desayune tosta de aceite y tomate no se cuanto era"
q "un bol de cereales con le che entera"
q "quiero saber de una empanada de atun grande"
q "me tome un batido de proteina con platano despues del gym"
q "cuanto seria una racon de arroz tres delicias"
q "ayer comi pollo al curri con arro blanco"
q "un sandwich de pavo y queso sin puntuacion gracias"
q "me puedes mirar calorias de una ensalada cesar con poyo"
q "si me como dos revanadas de pan con mantequilla"
q "calcula fideos chinos con verduras y gambitas"
q "una arepa con carne mechada y queso pero dicho rapido"
q "hoy solo tome cafe solo y una barrita de seriales"
q "me comi un plato de lenteja estofadas con verduras"
q "cuanto tiene un yogur griego con miel y nueces"
q "silencio no comida creo que igual dije sopa de miso"
q "para cenar fue salmon ala plancha con pure de patata"
echo ""
echo "=== 27. ESTRUCTURAS COMPUESTAS (20 queries) ==="
q "solomillo al whisky con patatas paja"
q "arroz a la cubana con huevo frito, tomate y plátano"
q "bacalao a la vizcaína con pimientos del piquillo"
q "berenjena rellena de carne picada y gratinada con queso"
q "pechuga de pollo rellena de jamón cocido y queso con salsa de champiñones"
q "calabacín relleno de verduras, arroz y mozzarella"
q "taco de cochinita pibil con cebolla encurtida y salsa verde"
q "lubina al horno con cama de patata y cebolla"
q "secreto ibérico con puré de boniato y salsa de mostaza"
q "raviolis rellenos de ricotta y espinacas con salsa de nueces"
q "canelones de carne con bechamel y queso gratinado"
q "huevos rotos con setas, foie y patata panadera"
q "bao de panceta con pepino encurtido y mayonesa picante"
q "ensalada templada de queso de cabra, nueces y vinagreta de miel"
q "pollo tikka masala con arroz basmati y pan naan"
q "tartar de salmón con aguacate, mango y chips de yuca"
q "tosta de sardina ahumada con escalivada y aceituna negra"
q "crepe salado relleno de espinacas, champiñones y queso azul"
q "costillas glaseadas con miel y soja acompañadas de coleslaw"
q "sepia a la plancha con ajo, perejil y ensalada verde"
echo ""
echo "=== 28. CANTIDADES Y MEDIDAS RARAS (20 queries) ==="
q "200 gramos de pasta cocida con salsa de tomate"
q "150 gramos de arroz integral con verduras salteadas"
q "un cuarto de pollo asado con piel"
q "medio kilo de mejillones al vapor"
q "una cucharada sopera de aceite de oliva"
q "dos rebanadas de pan de molde con crema de cacahuete"
q "un puñado grande de almendras tostadas"
q "un bote pequeño de aceitunas verdes rellenas"
q "una lata de atún en aceite escurrida"
q "un vaso de yogur natural azucarado"
q "tres cuartos de pizza cuatro quesos"
q "un tercio de tarta de manzana"
q "medio paquete de galletas digestive"
q "dos cucharaditas de azúcar en un té"
q "un bol pequeño de hummus con zanahoria"
q "una bandeja individual de sushi variado"
q "un sobre de sopa instantánea de pollo"
q "250 mililitros de salmorejo en vaso"
q "una loncha gruesa de mortadela"
q "cinco cucharadas de arroz blanco"
echo ""
echo "=== 29. FECHA HORA Y CONTEXTO (20 queries) ==="
q "ayer por la noche cené salmón con verduras al horno"
q "el domingo me comí un plato de migas con huevo"
q "después del gimnasio me tomé un batido de chocolate con avena"
q "antes de dormir cené una crema de puerros con picatostes"
q "en el desayuno de hoy comí tostadas con aguacate y huevo"
q "esta mañana antes de trabajar tomé un croissant de mantequilla"
q "anoche después del cine compartí nachos con queso"
q "el viernes en la oficina pedí noodles con pollo y verduras"
q "para merendar ayer tomé un yogur con granola"
q "después de correr me comí una barrita energética de frutos secos"
q "en la cena familiar del sábado probé cochinillo asado con ensalada"
q "hoy al mediodía comí garbanzos con espinacas"
q "durante el viaje me tomé un bocata de pavo con queso"
q "esta tarde en la cafetería pedí una porción de brownie"
q "antes del partido cené arroz con atún y maíz"
q "el lunes después de clase comí una empanadilla de carne"
q "ayer tarde me bebí un smoothie de mango con yogur"
q "en la comida de empresa tomé ternera guisada con patatas"
q "después de la siesta piqué queso fresco con membrillo"
q "a medianoche me hice una tortilla francesa con champiñones"
echo ""
echo "=========================================="
printf "TOTAL: %d queries | OK: %d | NULL: %d | FAIL: %d\n" "$COUNT" "$OK" "$NULL" "$FAIL"
echo "=========================================="
