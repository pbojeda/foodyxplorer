# Manual de Usuario — foodXPlorer Bot (Telegram)

> Guia completa de todas las funcionalidades del bot de Telegram de foodXPlorer.
> Ultima actualizacion: 2026-03-29 (incluye F050 — NL punctuation fix, F049 — Manual overhaul)

---

## Tabla de Contenidos

1. [Primeros pasos](#1-primeros-pasos)
2. [Estimar calorias de un plato](#2-estimar-calorias-de-un-plato)
3. [Buscar platos en la base de datos](#3-buscar-platos-en-la-base-de-datos)
4. [Comparar dos platos](#4-comparar-dos-platos)
5. [Calcular una receta](#5-calcular-una-receta)
6. [Lenguaje natural (sin comandos)](#6-lenguaje-natural-sin-comandos)
7. [Modificadores de porcion](#7-modificadores-de-porcion)
8. [Contexto conversacional](#8-contexto-conversacional)
9. [Restaurantes y cadenas](#9-restaurantes-y-cadenas)
10. [Analizar fotos de menus](#10-analizar-fotos-de-menus)
11. [Subir datos nutricionales (admin)](#11-subir-datos-nutricionales-admin)
12. [Informacion del bot](#12-informacion-del-bot)
13. [Limites de uso](#13-limites-de-uso)
14. [Mensajes de error](#14-mensajes-de-error)
15. [Referencia rapida de comandos](#15-referencia-rapida-de-comandos)

---

## 1. Primeros pasos

Envia `/start` o `/help` para ver la lista de comandos disponibles.

El bot acepta dos modos de interaccion:
- **Comandos** — empiezan con `/` (ej. `/estimar big mac`)
- **Lenguaje natural** — escribe en espanol sin `/` (ej. `cuantas calorias tiene un big mac`)

---

## 2. Estimar calorias de un plato

### Comando

```
/estimar <plato> [en <cadena>]
```

### Ejemplos

| Input | Que hace |
|-------|----------|
| `/estimar big mac` | Estima nutrientes del Big Mac (cualquier cadena) |
| `/estimar big mac en mcdonalds-es` | Estima nutrientes del Big Mac solo en McDonald's Espana |
| `/estimar pollo en salsa` | Busca "pollo en salsa" (no se confunde con una cadena) |
| `/estimar pollo en salsa en mcdonalds-es` | Busca "pollo en salsa" en McDonald's Espana |
| `/estimar big mac doble` | Estima con porcion doble (x2.0) |
| `/estimar whopper grande en burger-king-es` | Whopper grande (x1.5) en Burger King |

### Resultado

```
*Big Mac*

🔥 Calorias: 563 kcal
🥩 Proteinas: 26.5 g
🍞 Carbohidratos: 45 g
🧈 Grasas: 30 g

Porcion: 200 g
Cadena: mcdonalds-es

Confianza: alta
```

### Notas

- La cadena debe tener formato `slug` con al menos un guion (ej. `mcdonalds-es`, `burger-king-es`). Usa `/cadenas` para ver las disponibles.
- Si el plato contiene "en" de forma natural (como "pollo en salsa"), el bot lo detecta correctamente y no lo confunde con una cadena.
- Los nutrientes opcionales (fibra, grasas saturadas, sodio, sal) solo aparecen si su valor es mayor que cero.

---

## 3. Buscar platos en la base de datos

### Comando

```
/buscar <nombre del plato>
```

### Ejemplos

| Input | Que hace |
|-------|----------|
| `/buscar big mac` | Busca platos que contengan "big mac" |
| `/buscar pizza margarita` | Busca pizzas margarita |

### Resultado

Devuelve una lista de hasta 10 platos con nombre, ID, restaurante y cadena. Si hay mas resultados, muestra "Mostrando X de Y". Util para encontrar el nombre exacto antes de usar `/estimar`.

---

## 4. Comparar dos platos

### Comando

```
/comparar <plato_a> vs <plato_b>
```

### Separadores aceptados

Puedes usar cualquiera de estos para separar los dos platos:

| Separador | Ejemplo |
|-----------|---------|
| `vs` | `/comparar big mac vs whopper` |
| `versus` | `/comparar big mac versus whopper` |
| `contra` | `/comparar big mac contra whopper` |
| `o` | `/comparar big mac o whopper` |
| `y` | `/comparar big mac y whopper` |
| `con` | `/comparar big mac con whopper` |

> **Nota:** `vs`, `versus` y `contra` tienen prioridad. Si el nombre del plato contiene "con" (ej. "helado con chocolate"), el bot lo maneja correctamente.

### Ejemplos avanzados

| Input | Que hace |
|-------|----------|
| `/comparar big mac vs whopper` | Comparacion basica |
| `/comparar big mac en mcdonalds-es vs whopper en burger-king-es` | Cada plato en su cadena |
| `/comparar big mac grande vs whopper doble` | Con modificadores de porcion |
| `/comparar pizza vs hamburguesa` | Comparacion generica |

### Resultado

```
*Big Mac* vs *Whopper*

              Big Mac       Whopper
🔥 Calorias   563 kcal ✅    672 kcal
🥩 Proteinas  26.5 g ✅      25.0 g
🍞 Carbohidr  45.0 g         56.0 g
🧈 Grasas     30.0 g ✅      35.0 g
🌾 Fibra       3.0 g ✅       2.0 g
🫙 Grasas sat 10.0 g ✅      14.0 g
🧂 Sodio      940 mg         860 mg ✅

Confianza: alta / media
Cadena: mcdonalds-es / burger-king-es
```

### Indicadores de ganador

| Nutriente | Gana el... |
|-----------|-----------|
| Calorias, Grasas, Grasas saturadas, Sodio, Sal | Valor **mas bajo** ✅ |
| Proteinas, Fibra | Valor **mas alto** ✅ |
| Carbohidratos | Sin indicador (ambiguo nutricionalmente) |
| Empate en nutriente enfocado | Ambos con guion (`—`) |

### Foco nutricional

Cuando la consulta menciona un nutriente especifico (ej. `que tiene mas proteinas, big mac o whopper`), la fila de ese nutriente aparece **primera** en la tabla con la etiqueta `(foco)`.

### Casos especiales

- **Un plato no encontrado:** muestra la ficha del plato disponible + nota "No se encontraron datos para X".
- **Ambos platos no encontrados:** "No se encontraron datos nutricionales para ninguno de los platos."
- **Timeout en un plato:** "Tiempo de espera agotado para X."
- **Mismo resultado:** si ambos platos resuelven al mismo alimento, se muestra una nota indicandolo.

---

## 5. Calcular una receta

### Comando

```
/receta <lista de ingredientes>
```

### Ejemplos

| Input | Que hace |
|-------|----------|
| `/receta 200g pollo, 100g arroz, 50g aceite de oliva` | Calcula nutrientes totales |
| `/receta 2 huevos, 100g bacon, tostadas` | Cantidades y nombres libres |
| `/receta ensalada cesar con pollo a la plancha` | Texto libre (el LLM lo interpreta) |

### Resultado

El bot devuelve:

1. **Totales** — calorias, proteinas, carbohidratos, grasas (+ opcionales si > 0)
2. **Desglose por ingrediente** — cada ingrediente resuelto con sus calorias y proteinas
3. **Ingredientes no resueltos** — lista de ingredientes que no se pudieron identificar
4. **Nivel de confianza** — alta, media o baja segun la calidad de la resolucion

```
*Resultado de la receta*

🔥 Calorias: 845 kcal
🥩 Proteinas: 52.3 g
🍞 Carbohidratos: 78.0 g
🧈 Grasas: 28.5 g

*Ingredientes (3/3):*
• Pollo — 200g → 330 kcal, 62.0 g prot
• Arroz — 100g → 365 kcal, 7.1 g prot
• Aceite de oliva — 50g → 150 kcal, 0.0 g prot

Confianza: media
```

Si la receta tiene muchos ingredientes y el mensaje supera el limite de Telegram (4000 caracteres), el desglose se trunca automaticamente: `... y X ingredientes mas`.

### Notas

- Limite de **2000 caracteres** por receta.
- Limite de **5 recetas por hora** por usuario.
- El bot usa IA para interpretar ingredientes escritos de forma libre.
- Si no entiende la lista: "No entendi la lista de ingredientes. Intenta con el formato: 200g pollo, 100g arroz."
- Si no puede resolver ningun ingrediente: "No se pudo resolver ningun ingrediente de la receta."

---

## 6. Lenguaje natural (sin comandos)

Puedes escribir en espanol sin usar `/` y el bot intentara entender tu consulta.

### Consultas simples (un plato)

| Input | Que entiende |
|-------|-------------|
| `big mac` | Estima "big mac" |
| `cuantas calorias tiene un big mac` | Estima "big mac" |
| `que lleva un whopper` | Estima "whopper" |
| `calorias de una hamburguesa` | Estima "hamburguesa" |
| `informacion nutricional del pollo frito` | Estima "pollo frito" |
| `big mac en mcdonalds-es` | Estima "big mac" en McDonald's |
| `big mac grande` | Estima "big mac" con porcion grande (x1.5) |

### Comparaciones (dos platos)

| Input | Que entiende |
|-------|-------------|
| `que tiene mas calorias, un big mac o un whopper` | Compara con foco en calorias |
| `que tiene menos grasas, pizza o hamburguesa` | Compara con foco en grasas |
| `que engorda mas, una pizza o una hamburguesa` | Compara con foco en calorias |
| `que es mas sano, ensalada o bollo` | Compara sin foco especifico |
| `compara big mac con whopper` | Compara sin foco |
| `comparar arroz vs pasta` | Compara sin foco |

#### Nutrientes reconocidos en lenguaje natural

| Escribes | Nutriente enfocado |
|----------|-------------------|
| `calorias` | Calorias |
| `proteinas` | Proteinas |
| `grasas` | Grasas |
| `hidratos` o `carbohidratos` | Carbohidratos |
| `fibra` | Fibra |
| `sodio` | Sodio |
| `sal` | Sal |

### Notas

- El bot acepta acentos o no (`calorias` = `calorías`), mayusculas o minusculas.
- Signos `¿` y `?` se manejan correctamente: `¿que tiene mas calorias, big mac o whopper?` funciona.
- Limite de **500 caracteres** para mensajes de texto libre.
- Si el texto es muy largo: "Por favor, se mas especifico. Escribe el nombre del plato directamente."

---

## 7. Modificadores de porcion

Anade una palabra de tamano al nombre del plato para ajustar las cantidades. Funciona en `/estimar`, `/comparar` y en lenguaje natural.

| Palabra | Multiplicador | Ejemplo |
|---------|:------------:|---------|
| `media racion` / `medio` / `media` / `half` | x0.5 | `media pizza` |
| `pequeno` / `pequena` / `mini` / `peque` | x0.7 | `big mac pequeno` |
| `grande` / `xl` / `extra grande` | x1.5 | `whopper grande` |
| `doble` / `racion doble` | x2.0 | `doble whopper` |
| `triple` | x3.0 | `triple hamburguesa` |

> **Nota:** Tambien se aceptan plurales: `dobles`, `grandes`, `triples`, `minis`, `raciones dobles`, `medias raciones`.

### Ejemplos combinados

| Input | Plato | Multiplicador |
|-------|-------|:------------:|
| `/estimar big mac doble en mcdonalds-es` | big mac en mcdonalds-es | x2.0 |
| `/comparar pizza grande vs hamburguesa pequena` | pizza (x1.5) vs hamburguesa (x0.7) |
| `calorias de un big mac xl` | big mac | x1.5 |

---

## 8. Contexto conversacional

El bot recuerda tu cadena de restaurante durante la conversacion. Si estableces un contexto, todas tus consultas posteriores se buscaran automaticamente en esa cadena sin necesidad de repetir `en <cadena>` cada vez.

### Establecer contexto

Hay dos formas de establecer contexto:

**1. Con el comando `/contexto`:**

| Input | Que hace |
|-------|----------|
| `/contexto mcdonalds` | Busca la cadena por nombre y activa el contexto |
| `/contexto mcdonalds-es` | Activa contexto con slug directo |

**2. Con lenguaje natural** (patron exacto `estoy en [articulo] <cadena>`):

| Input | Que hace |
|-------|----------|
| `estoy en mcdonalds` | Activa contexto McDonald's |
| `estoy en el burger king` | Activa contexto Burger King (articulo opcional) |

> **Nota:** La deteccion por lenguaje natural solo reconoce el patron exacto `estoy en ...` — maximo 50 caracteres, sin comas, sin saltos de linea. Para otros casos, usa `/contexto <cadena>`.

Si el nombre coincide con varias cadenas, el bot pedira que uses el slug exacto:

```
Encontre varias cadenas con ese nombre. Por favor, usa el slug exacto (por ejemplo: mcdonalds-es). Usa /cadenas para ver los slugs.
```

### Usar el contexto

Una vez establecido, simplemente pregunta por platos sin especificar la cadena:

```
Usuario: estoy en mcdonalds
Bot:     ✅ Contexto: McDonald's Spain (mcdonalds-es)

Usuario: big mac
Bot:     *Big Mac*
         🔥 Calorias: 563 kcal
         ...
         Cadena: mcdonalds-es
         Contexto activo: McDonald's Spain
```

> **Importante:** el contexto filtra **dentro de la cadena activa**. Si buscas un plato que no existe en esa cadena (ej. `whopper` estando en McDonald's), el resultado sera "no se encontraron datos". Para buscar en otra cadena, especifica `en <cadena>` explicitamente o borra el contexto con `/contexto borrar`.

### Ver y borrar contexto

| Comando | Que hace |
|---------|----------|
| `/contexto` | Muestra el contexto activo (cadena y tiempo restante) |
| `/contexto borrar` | Borra el contexto manualmente |
| `/contexto <cadena>` | Establece el contexto directamente |

### Expiracion automatica

El contexto expira automaticamente tras **2 horas** desde el ultimo cambio de contexto (establecer o borrar). Las consultas normales (`/estimar`, lenguaje natural, etc.) **no reinician** el temporizador.

### Notas

- El contexto funciona con `/estimar`, `/comparar` y con lenguaje natural.
- `/receta` **no** utiliza el contexto (las recetas no se filtran por cadena).
- Si especificas `en <cadena>` explicitamente en un comando, esa cadena tiene prioridad sobre el contexto activo.
- El contexto se almacena por chat (si usas el bot en un grupo, el contexto es compartido por todo el grupo).
- `/comparar` aplica el contexto a ambos platos, a menos que cada uno tenga su propia cadena.

---

## 9. Restaurantes y cadenas

### Ver cadenas disponibles

```
/cadenas
```

Muestra todas las cadenas de restaurantes activas con nombre, slug, pais y numero de platos. Si hay muchas cadenas, la lista se trunca con un indicador "Mostrando X de Y".

### Listar restaurantes

```
/restaurantes [cadena]
```

| Input | Que hace |
|-------|----------|
| `/restaurantes` | Lista todos los restaurantes |
| `/restaurantes mcdonalds-es` | Solo restaurantes de McDonald's |

### Ver platos de un restaurante

```
/platos <restaurantId>
```

El ID es un UUID que obtienes de `/restaurantes`. Ejemplo:

```
/platos 123e4567-e89b-12d3-a456-426614174000
```

### Seleccionar restaurante (contexto)

```
/restaurante [nombre]
```

| Input | Que hace |
|-------|----------|
| `/restaurante` | Muestra el restaurante seleccionado actualmente |
| `/restaurante mcdonalds` | Busca restaurantes con ese nombre |

Cuando buscas, el bot muestra botones inline para seleccionar un restaurante. Si la busqueda no encuentra resultados, aparece un boton **"Crear restaurante"** que permite crearlo directamente desde el chat. El restaurante seleccionado se usa como contexto para subir fotos y documentos.

---

## 10. Analizar fotos de menus

Envia una **foto** al bot y aparecera un menu con tres opciones:

| Boton | Que hace |
|-------|----------|
| 📖 **Subir al catalogo** | Extrae datos nutricionales y los guarda en la base de datos |
| 🧮 **Analizar menu** | Identifica platos del menu y estima sus nutrientes (no guarda) |
| 🍽️ **Identificar plato** | Identifica un plato de la foto y muestra sus nutrientes |

### Requisitos

- Debes tener un **restaurante seleccionado** (usa `/restaurante <nombre>` primero).
- Tu chat debe estar en la lista de chats permitidos (`ALLOWED_CHAT_IDS`).
- Tamano maximo: **10 MB**.

> **Nota:** Si tu chat no esta autorizado, el bot **no responde** al envio de fotos ni documentos (silencio total, sin mensaje de error).

### Ejemplo de flujo

1. `/restaurante mcdonalds` → seleccionas "McDonald's Spain"
2. Envias una foto del menu
3. Pulsas "🧮 Analizar menu"
4. El bot responde con los platos encontrados y sus nutrientes estimados (4 nutrientes principales: calorias, proteinas, carbohidratos, grasas)

### Comportamiento especial

- **Resultados parciales:** si el analisis tarda demasiado, el bot devuelve los platos que haya podido analizar hasta ese momento junto con un aviso de timeout.
- **Platos sin datos:** dentro de la lista de resultados, los platos que no pudieron ser estimados aparecen marcados como "sin datos".
- **Identificacion fallida:** si "Identificar plato" no reconoce nada en la foto: "No se pudo identificar el plato."

### Limite

**5 analisis por hora** por usuario (compartido entre "Analizar menu" e "Identificar plato").

---

## 11. Subir datos nutricionales (admin)

Si tu chat esta autorizado, puedes enviar **documentos** directamente:

| Formato | Que hace |
|---------|----------|
| **PDF** | Extrae tabla nutricional del PDF y guarda los platos |
| **JPEG / PNG** | Extrae datos via OCR y guarda los platos |

### Requisitos

- Restaurante seleccionado (via `/restaurante`).
- Chat en lista de permitidos.
- Tamano maximo: 10 MB.

### Resultado

```
✅ Ingesta completada
Restaurante: McDonald's Spain
Platos encontrados: 42
Platos guardados: 38
Platos omitidos: 4
```

---

## 12. Informacion del bot

```
/info
```

Muestra la version del bot y el estado de la conexion con la API:

```
*foodXPlorer Bot* v0.1.0

API: conectada ✅
```

---

## 13. Limites de uso

| Funcionalidad | Limite | Periodo |
|---------------|:------:|---------|
| `/receta` | 5 | Por hora, por usuario |
| Analizar menu (foto) | 5 | Por hora, por usuario |
| Identificar plato (foto) | 5 | Por hora, por usuario (compartido con analizar menu) |
| Texto libre (NL) | 500 caracteres | Por mensaje |
| Texto de receta | 2000 caracteres | Por mensaje |
| Tamano de archivo | 10 MB | Por archivo |
| Contexto conversacional | 2 horas | Desde ultimo set/clear |

Nota: si Redis no esta disponible, los limites de tasa se desactivan (fail-open) y las peticiones se procesan igualmente.

---

## 14. Mensajes de error

### Errores generales

| Situacion | Mensaje |
|-----------|---------|
| Demasiadas peticiones | "Demasiadas consultas. Espera un momento." |
| Servidor no disponible | "El servicio no esta disponible." |
| Timeout | "La consulta tardo demasiado." |
| Sin conexion | "No se puede conectar con el servidor." |
| Error de configuracion | "Error de configuracion del bot." |
| Error generico | "Ha ocurrido un error inesperado." |
| Comando desconocido | "Comando no reconocido. Usa /help para ver los comandos disponibles." |

### Errores de /receta

| Situacion | Mensaje |
|-----------|---------|
| Sin argumentos | "Uso: /receta \<ingredientes\>" |
| Texto demasiado largo | "La receta es demasiado larga. El limite es de 2000 caracteres." |
| Limite por hora | "Has alcanzado el limite de recetas por hora. Intentalo mas tarde." |
| Ingredientes no resueltos | "No se pudo resolver ningun ingrediente de la receta." |
| LLM no entiende la lista | "No entendi la lista de ingredientes. Intenta con el formato: 200g pollo, 100g arroz." |

### Errores de fotos y analisis

| Situacion | Mensaje |
|-----------|---------|
| Sin restaurante seleccionado | "No hay restaurante seleccionado. Usa /restaurante \<nombre\> de nuevo." |
| Analisis de menu fallido | "No se pudieron identificar platos en el menu." |
| Imagen invalida | "Imagen no valida o no soportada." |
| OCR fallido | "No se pudo extraer texto de la imagen. Asegurate de que el texto del menu sea legible." |
| Identificacion fallida | "No se pudo identificar el plato." |
| Limite por hora | "Has alcanzado el limite de analisis por hora." |
| Foto expirada | "No se pudo descargar el archivo. Intentalo de nuevo." |

### Errores de contexto

| Situacion | Mensaje |
|-----------|---------|
| Cadena no encontrada | "No encontre ninguna cadena con ese nombre. Usa /cadenas para ver las cadenas disponibles." |
| Multiples coincidencias | "Encontre varias cadenas con ese nombre. Usa el slug exacto." |
| Error al guardar | "No pude guardar el contexto. Intentalo de nuevo." |
| API no disponible | "No pude comprobar las cadenas ahora mismo. Intentalo de nuevo." |

---

## 15. Referencia rapida de comandos

| Comando | Descripcion | Ejemplo |
|---------|-------------|---------|
| `/start` `/help` | Ayuda | `/help` |
| `/estimar` | Estima nutrientes de un plato | `/estimar big mac en mcdonalds-es` |
| `/comparar` | Compara dos platos | `/comparar big mac vs whopper` |
| `/receta` | Calcula nutrientes de una receta | `/receta 200g pollo, 100g arroz` |
| `/buscar` | Busca platos por nombre | `/buscar pizza` |
| `/cadenas` | Lista cadenas activas | `/cadenas` |
| `/restaurantes` | Lista restaurantes | `/restaurantes mcdonalds-es` |
| `/platos` | Platos de un restaurante | `/platos <uuid>` |
| `/restaurante` | Selecciona contexto de restaurante | `/restaurante mcdonalds` |
| `/contexto` | Ver, establecer o borrar contexto | `/contexto mcdonalds-es` |
| `/info` | Estado del bot y la API | `/info` |

---

*Todos los datos nutricionales son aproximados. Consulta siempre las fuentes oficiales.*
