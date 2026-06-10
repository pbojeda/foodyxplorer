# Manual de Usuario — nutriXplorer Web (/hablar)

> Guía completa del asistente nutricional web de nutriXplorer.
> Última actualización: 2026-06-10 — incluye inicio de sesión, historial de consultas, búsqueda por voz y planes de uso.

---

## Tabla de Contenidos

1. [Qué es /hablar](#1-qué-es-hablar)
2. [Primeros pasos](#2-primeros-pasos)
3. [Cuenta e inicio de sesión](#3-cuenta-e-inicio-de-sesión)
4. [Pantalla principal](#4-pantalla-principal)
5. [Consultar calorías por texto](#5-consultar-calorías-por-texto)
6. [Tipos de respuesta](#6-tipos-de-respuesta)
7. [Analizar una foto](#7-analizar-una-foto)
8. [Buscar por voz](#8-buscar-por-voz)
9. [Contexto de restaurante](#9-contexto-de-restaurante)
10. [Búsqueda inversa](#10-búsqueda-inversa)
11. [Comparar platos](#11-comparar-platos)
12. [Menú del día](#12-menú-del-día)
13. [Historial de consultas](#13-historial-de-consultas)
14. [Límites de uso](#14-límites-de-uso)
15. [Privacidad y datos](#15-privacidad-y-datos)
16. [Mensajes de error](#16-mensajes-de-error)
17. [Comportamiento en móvil](#17-comportamiento-en-móvil)
18. [Accesibilidad](#18-accesibilidad)
19. [Configuración técnica (administradores)](#19-configuración-técnica-administradores)
20. [Preguntas frecuentes](#20-preguntas-frecuentes)
21. [Referencia rápida](#21-referencia-rápida)
22. [Información de porción estimada](#22-información-de-porción-estimada)

---

## 1. Qué es /hablar

`/hablar` es el asistente nutricional web de nutriXplorer. Escribes, hablas o envías una foto, y el asistente responde con tarjetas nutricionales. Las consultas se muestran en un **hilo que se va acumulando**: cada nueva consulta se añade debajo de las anteriores, como en una conversación, para que puedas repasar lo que ya has preguntado sin perderlo.

Con `/hablar` puedes:

- **Preguntar por calorías y macros** de cualquier plato, receta o producto
- **Comparar dos platos** para decidir cuál te conviene más
- **Analizar una foto** de un plato o de una carta/menú y obtener los nutrientes
- **Buscar por voz** y escuchar la respuesta en voz alta
- **Establecer contexto** de un restaurante para que las respuestas se ajusten a su carta
- **Buscar platos** por características nutricionales (ej. "platos con más de 30g de proteína")
- **Guardar tu historial** entre dispositivos si inicias sesión (opcional)

No necesitas instalar nada — funciona en cualquier navegador moderno. Tampoco necesitas cuenta para empezar: el uso sin sesión es anónimo. Iniciar sesión es opcional y desbloquea ventajas (ver [Sección 3](#3-cuenta-e-inicio-de-sesión)).

**Principio fundamental:** El asistente identifica y descompone lo que describes, pero los cálculos nutricionales los realiza un motor de estimación determinístico y auditable. La IA nunca inventa cifras de nutrientes.

---

## 2. Primeros pasos

### Acceder

Abre tu navegador y ve a la URL de la aplicación (ej. `https://app.nutrixplorer.com`). Serás redirigido automáticamente a `/hablar`.

### Requisitos

- Navegador moderno: Chrome, Firefox, Safari, Edge (escritorio o móvil)
- Conexión a internet
- No necesitas cuenta ni registro para empezar — el uso es anónimo

### Primer uso

Al entrar verás la pantalla del asistente con el mensaje "¿Qué quieres saber?" y un campo de texto en la parte inferior. Escribe tu consulta y pulsa Enter.

No hay comandos especiales que aprender. Escribe como hablas:

```
cuántas calorías tiene una tortilla de patatas
```

---

## 3. Cuenta e inicio de sesión

Puedes usar `/hablar` **sin cuenta**. Iniciar sesión es **opcional** y te da dos ventajas:

- **Tu historial se guarda en tu cuenta** y lo ves desde cualquier dispositivo (ver [Sección 13](#13-historial-de-consultas)).
- **Más consultas al día**: 100 en lugar de 50 (ver [Sección 14](#14-límites-de-uso)).

### Cómo iniciar sesión

1. Pulsa **"Iniciar sesión"** en la cabecera.
2. Escribe tu email y pulsa **"Entrar con email"**.
3. Verás el mensaje *"Revisa tu correo — te hemos enviado un enlace de acceso. Puede tardar unos segundos en llegar."*
4. Abre el correo y pulsa el enlace. Volverás a `/hablar` ya con la sesión iniciada.

No hay contraseñas: cada acceso usa un **enlace mágico** de un solo uso enviado a tu email.

### Cerrar sesión

Pulsa tu avatar en la cabecera y elige **"Cerrar sesión"**. Verás tu email en ese mismo menú.

### Si el enlace no llega o caduca

- El enlace puede tardar unos segundos. Revisa también la carpeta de spam.
- Si el enlace ya caducó o se usó, verás *"El enlace de acceso ha expirado o ha sido cancelado. Solicita uno nuevo."* — simplemente vuelve a pedir el acceso desde la pantalla de inicio de sesión.

> **Nota:** Las consultas que hagas **sin haber iniciado sesión no se guardan en tu cuenta**. Al iniciar sesión verás tu historial guardado, pero lo que probaste antes en modo anónimo permanece solo en esa sesión del navegador.

---

## 4. Pantalla principal

La interfaz tiene tres zonas:

### Cabecera

Barra superior fija con el nombre "nutriXplorer". A la derecha encontrarás, según tu estado:

- **"Iniciar sesión"** (si no has entrado) — ver [Sección 3](#3-cuenta-e-inicio-de-sesión)
- **Medidor de uso** — cuánto te queda del cupo diario (ver [Sección 14](#14-límites-de-uso))
- **Tu avatar** (si has iniciado sesión) — abre el menú con tu email y "Cerrar sesión"

### Área de resultados (el hilo)

Zona central desplazable donde aparecen las respuestas, **acumuladas de arriba abajo**. Cada consulta queda registrada como una entrada con tu pregunta y la respuesta. Puede mostrar:

- **Estado vacío:** mensaje de bienvenida con instrucciones
- **Cargando:** tarjetas con animación de carga
- **Resultados:** tarjetas nutricionales con los datos del plato
- **Error:** mensaje con botón "Intentar de nuevo"

Las tarjetas se distribuyen en una columna en móvil y, dentro de cada entrada, en dos columnas en pantallas medianas y grandes (por ejemplo en comparaciones).

### Barra de entrada

Barra fija en la parte inferior con:

| Elemento | Descripción |
|----------|-------------|
| Campo de texto | Área de escritura. Crece hasta 3 líneas. Placeholder: "¿Qué quieres saber?" |
| Selector de tipo de foto | "Solo este plato" / "Menú/carta" — elige cómo analizar la imagen (ver [Sección 7](#7-analizar-una-foto)) |
| Botón cámara | Abre el selector de fotos para analizar un plato o una carta |
| Botón micrófono | Buscar por voz (ver [Sección 8](#8-buscar-por-voz)) |
| Botón enviar (naranja) | Aparece cuando hay texto escrito. Envía la consulta |

Puedes lanzar una consulta de tres formas: escribiendo y pulsando enviar (o Enter), hablando con el micrófono, o enviando una foto. No hace falta texto para las consultas por voz o foto.

**Atajos de teclado:**
- `Enter` — Envía la consulta
- `Shift + Enter` — Salto de línea (no envía)

---

## 5. Consultar calorías por texto

### Cómo funciona

1. Escribe el nombre de un plato o una pregunta en lenguaje natural
2. Pulsa Enter o el botón naranja de enviar
3. El asistente procesa tu consulta y muestra una tarjeta nutricional

### Ejemplos de consultas

| Consulta | Qué obtienes |
|----------|--------------|
| `big mac` | Estimación nutricional del Big Mac |
| `cuántas calorías tiene una paella` | Calorías y macros de una paella |
| `ensalada cesar en mcdonalds` | Estimación ajustada a la carta de McDonald's (no necesitas activar contexto antes) |
| `tortilla de patatas doble` | Porción doble (x2.0) de tortilla de patatas |
| `pollo a la plancha 200g` | Estimación para 200g de pollo a la plancha |
| `qué tiene más proteína, pollo o ternera` | Comparación entre ambos |
| `platos con más de 30g de proteína` | Búsqueda inversa por macros |
| `menú del día: sopa, filete con patatas, flan` | Estimación de cada plato del menú |

### La tarjeta nutricional

Cada resultado se muestra como una tarjeta con:

```
[Nombre del plato]                    [Verificado]

        563
        KCAL

  Proteínas      Carbohidratos      Grasas
    26.5 g          45 g           30 g

  ⚠ Gluten  ⚠ Lactosa

  Fuente: mcdonalds-es
```

**Elementos de la tarjeta:**

| Elemento | Descripción |
|----------|-------------|
| Nombre del plato | Título principal de la tarjeta |
| Badge de confianza | Verde "Verificado" (dato exacto de cadena), amarillo "Estimado" (cálculo del motor), rosa "Aproximado" (baja confianza) |
| Kilocalorías | Número grande en naranja |
| Macronutrientes | Proteínas (verde), carbohidratos (dorado), grasas (gris) |
| Alérgenos | Chips rojos con icono de advertencia (solo si hay alérgenos conocidos) |
| Fuente | De dónde proviene el dato (nombre de cadena o base de datos) |

### Sin resultados

Si el plato no se encuentra:

```
No encontré información nutricional para 'tarta de unicornio'.
Prueba con otro nombre.
```

---

## 6. Tipos de respuesta

El asistente interpreta tu consulta y puede devolver diferentes tipos de resultado:

### Estimación simple

Una consulta sobre un plato concreto. Devuelve una tarjeta.

```
Ejemplo: paella valenciana
```

### Comparación

Dos platos comparados lado a lado en dos tarjetas.

```
Ejemplo: qué engorda más, pizza o hamburguesa
```

### Menú

Varios platos estimados a la vez, cada uno en su propia tarjeta. Si alguno de los platos no se reconoce, su tarjeta puede aparecer sin datos nutricionales.

```
Ejemplo: he comido lentejas, filete con ensalada y un yogur
```

### Contexto de restaurante

Si mencionas un restaurante, el asistente activa contexto para que las siguientes consultas se ajusten a su carta. Muestra una confirmación verde. Más detalles en la [Sección 9](#9-contexto-de-restaurante).

```
Ejemplo: estoy en mcdonalds
```

### Búsqueda inversa

Busca platos por criterios nutricionales. Muestra múltiples tarjetas. Funciona mejor si especificas un restaurante o cadena. Más detalles en la [Sección 10](#10-búsqueda-inversa).

```
Ejemplo: platos con menos de 300 calorías y más de 20g de proteína
```

### Preguntas de seguimiento (memoria de 30 minutos)

El asistente recuerda el **último plato que estimaste** durante 30 minutos. Mientras el plato esté "vivo" en memoria, puedes hacer dos tipos de pregunta sin repetir el nombre:

**1. Preguntar por un nutriente concreto** (no recalcula nada — respuesta instantánea):

```
Tú: paella valenciana
Sistema: tarjeta nutricional completa (kcal, proteínas, carbs, fibra, sal, …)

Tú: y los carbs?
Sistema: banner ámbar con "Paella valenciana — Carbohidratos: 92 g"
         + la tarjeta completa para contexto
```

Funcionan ~50 frases distintas mapeadas a 15 nutrientes:
- `y los carbs?` / `y los hidratos?` / `cuántos hc tiene?` → carbohidratos
- `y la proteína?` / `cuánta prot?` → proteínas
- `y la fibra?` / `cuánta fibra tiene?` → fibra
- `y la sal?` → sal | `y el sodio?` → sodio (mg)
- `y las grasas?` / `y las grasas saturadas?` → grasas / grasas saturadas
- `y el colesterol?` → colesterol (mg)
- `cuántas calorías?` / `kcal?` / `energía?` → calorías
- `azúcar?` / `azúcares?` → azúcares

Puedes encadenar varias preguntas de nutriente sobre el mismo plato — la memoria no se sobrescribe hasta que pidas un plato nuevo o hagas una modificación.

**2. Modificar el plato anterior** (sí recalcula):

| Frase | Comportamiento |
|-------|----------------|
| `hazlo de pollo en vez de cerdo` | Si el plato anterior contenía "cerdo", lo sustituye por "pollo" y vuelve a estimar |
| `menos cantidad` / `más cantidad` | Recalcula el mismo plato con multiplicador 0.5× / 1.5× |
| `una ración pequeña` / `grande` / `enorme` | Multiplicadores 0.7× / 1.5× / 2.0× |
| `sin azúcar` / `sin sal` / `sin gluten` | Anexa la modificación a la consulta y vuelve a estimar |

```
Tú: lomo de cerdo
Sistema: tarjeta de lomo de cerdo (250 kcal/100g, 21g grasa)

Tú: hazlo de pollo en vez de cerdo
Sistema: label "Refinado: lomo de pollo" + tarjeta de lomo de pollo (165 kcal/100g, 4g grasa)
```

Tras una modificación, la memoria se actualiza al plato modificado — puedes seguir preguntando por nutrientes sobre él (`y los carbs?` resolverá ahora contra "lomo de pollo", no contra "lomo de cerdo").

**Limitaciones conocidas:**

- La memoria **expira a los 30 minutos** sin actividad. Si vuelves después, "y los carbs?" se interpreta como consulta nueva (probablemente no encuentre nada).
- La memoria es **por usuario** — tu sesión no se mezcla con la de otro.
- **Sólo se memoriza la estimación de plato único.** Comparaciones, menús (varios platos a la vez) y búsquedas inversas no entran en la memoria.
- **Negaciones** ("no, eso no") no se reconocen aún — caen a consulta estándar.
- **Combinaciones** ("y los carbs si lo hago de pollo?") prevalece la pregunta del nutriente; el cambio de ingrediente se ignora en este caso.
- Si el plato anterior dio resultado vacío, las preguntas de seguimiento caen también a consulta estándar.

---

## 7. Analizar una foto

### Elige primero el tipo de análisis

Bajo el campo de texto hay un selector con dos modos:

| Modo | Cuándo usarlo | Resultado |
|------|---------------|-----------|
| **Solo este plato** (por defecto) | Foto de **un plato** de comida | Una tarjeta nutricional del plato identificado |
| **Menú/carta** | Foto de una **carta o menú impreso** con varios platos | Lista de los platos detectados, cada uno con sus calorías |

### Cómo funciona

1. Elige el modo (Solo este plato / Menú/carta)
2. Pulsa el **botón de cámara** en la barra inferior
3. Se abre el selector de archivos de tu dispositivo
   - En móvil: el sistema te ofrece **hacer una foto** o **elegir de la galería**
   - En escritorio: abre el explorador de archivos
4. Selecciona una foto
5. El asistente analiza la imagen y muestra el resultado según el modo elegido

**En modo Menú/carta**, si se detectan varios platos verás un encabezado del tipo *"Se han encontrado N platos"* y una lista desplazable. Si el análisis se queda incompleto (cartas muy largas), aparece un aviso *"Lista incompleta"* — el resto se muestra con normalidad. Puedes pulsar un plato de la lista para pedir su detalle.

**Nota:** Si el asistente identifica un plato pero no encuentra sus datos nutricionales, aparecerá el mensaje "Sin datos nutricionales disponibles".

> ⚠️ **Las fotos no se guardan en tu historial.** A diferencia de las consultas de texto y voz, el análisis de fotos **no** se conserva en el historial de tu cuenta — vive solo en la sesión actual. Si quieres conservar un resultado de foto, anótalo antes de cerrar.

### Formatos aceptados

| Formato | Aceptado |
|---------|----------|
| JPEG (.jpg, .jpeg) | Sí |
| PNG (.png) | Sí |
| WebP (.webp) | Sí |
| GIF, BMP, TIFF | No |
| PDF | No |

### Modificadores de tamaño en tu consulta

Si además de la foto (o en una consulta de texto) escribes "ración grande de paella", "paella pequeña", "croquetas doble", etc., la tarjeta mostrará una etiqueta amarilla (`PORCIÓN GRANDE`, `PORCIÓN MEDIA`, `×2.5`, …) debajo del nombre y un subtítulo `base: N kcal` bajo las calorías principales para que veas de un vistazo cuánto se ha escalado respecto a la ración normal. Los modificadores reconocidos incluyen: `media`, `pequeña`, `mini`, `grande`, `xl`, `doble`, `triple`, `ración doble`, `media ración`, `extra grande`.

### Límite de tamaño

**Máximo 10 MB por foto.** Si la foto es más grande, verás un error: "La foto es demasiado grande. Máximo 10 MB."

**Optimización automática antes de subir:** las fotos de más de 1,5 MB se reescalan en el navegador antes de enviarlas (lado más largo ≤ 1600 px, JPEG calidad ~82). Así, fotos de móviles modernos (que pueden rondar los 4–8 MB) se quedan holgadamente por debajo del límite. Las fotos pequeñas se envían sin modificar.

### Tiempo de procesamiento

El análisis de fotos tarda más que una consulta de texto porque interviene un modelo de visión artificial. Normalmente tarda entre 5 y 15 segundos. El límite máximo de espera es de **65 segundos**.

### Consejos para mejores resultados

- Haz la foto con buena iluminación
- Centra el plato o menú en la imagen
- Evita fotos muy oscuras o borrosas — si la imagen no es clara, puede que no se identifique el plato
- Si la carta es grande, haz fotos de secciones individuales

---

## 8. Buscar por voz

La búsqueda por voz está **disponible**: puedes hablar en lugar de escribir y, si quieres, escuchar la respuesta en voz alta.

### Cómo usarla

- **Toca** el botón de micrófono → se abre una pantalla de voz a pantalla completa.
- **Mantén pulsado** el botón → graba mientras lo mantienes y suelta para enviar. (Durante la grabación mantenida, desliza hacia la izquierda para **cancelar**.)
- Di tu consulta igual que la escribirías: *"cuántas calorías tiene una paella"*, *"dos pinchos de tortilla"*, *"menú: ensalada y un filete"*.

La primera vez te pediremos permiso para usar el micrófono con una breve explicación: tu audio se envía a OpenAI Whisper para convertirlo en texto, se procesa y **no se almacena**. Pulsa **"Permitir micrófono"** para continuar.

### Estados durante la búsqueda por voz

| Estado | Significado |
|--------|-------------|
| "Toca para hablar" | Listo para empezar |
| "Habla ahora" | Está grabando |
| "Procesando…" | Transcribiendo tu audio |
| "Respondiendo…" | Leyendo la respuesta en voz alta |

La grabación se detiene sola tras unos segundos de silencio, y tiene un máximo de **2 minutos** por mensaje.

### Respuesta hablada (lectura en voz alta)

El asistente puede **leer la respuesta en voz alta** usando la síntesis de voz de tu navegador. Está activada por defecto. Desde la pantalla de voz puedes:

- **Elegir la voz** (se muestran las voces en español disponibles en tu dispositivo).
- Activar o desactivar **"Respuesta hablada"** (útil si ya usas un lector de pantalla).

> Las voces disponibles dependen de tu dispositivo y navegador.

### Si la voz no está disponible o falla

- **Permiso denegado:** "Micrófono bloqueado. Comprueba los permisos del navegador." Revisa los permisos del sitio.
- **No se detecta voz:** "No detectamos ninguna voz. Habla más fuerte o prueba de nuevo."
- **Límite alcanzado:** "Límite de búsquedas por voz alcanzado. Inténtalo mañana." (ver [Sección 14](#14-límites-de-uso)).
- **Temporalmente desactivada:** ocasionalmente la búsqueda por voz puede quedar desactivada de forma temporal (verás una marca ámbar en el micrófono). No depende de ti; mientras tanto puedes seguir usando texto y fotos.
- **Navegador sin soporte o sin conexión:** si tu navegador no permite grabar o pierdes la conexión durante el proceso, usa el texto como alternativa.

---

## 9. Contexto de restaurante

### Activar contexto

Menciona un restaurante y el asistente activará el contexto para que tus siguientes consultas se ajusten a su carta.

```
estoy en mcdonalds
```

Respuesta:

```
Contexto activo: McDonald's
```

A partir de aquí, si escribes "big mac", el resultado será específico de McDonald's España (datos verificados).

**No es obligatorio activar contexto.** Si escribes "big mac en mcdonalds" directamente, el asistente busca en esa cadena sin necesidad de establecer contexto antes.

### Restaurantes soportados

El sistema cubre **14 cadenas de restauración españolas** con datos verificados. Para el resto de restaurantes, usa estimación genérica.

### Si el restaurante no se reconoce

Si el nombre no se reconoce o hay ambigüedad:

```
No encontré ese restaurante. Prueba con el nombre exacto.
```

### Cambiar de restaurante

Para cambiar de contexto, simplemente menciona otro restaurante:

```
estoy en burger king
```

---

## 10. Búsqueda inversa

Busca platos que cumplan ciertos criterios nutricionales.

**Nota:** La búsqueda inversa funciona mejor cuando especificas una cadena o restaurante. Sin contexto, busca en la base de datos genérica y los resultados pueden ser limitados.

### Ejemplos

| Consulta | Qué busca |
|----------|-----------|
| `platos con más de 30g de proteína en mcdonalds` | Platos altos en proteína en McDonald's |
| `platos con menos de 300 calorías` | Platos bajos en calorías (base genérica) |
| `platos bajos en grasa en burger king` | Opciones bajas en grasa en Burger King |

### Resultado

Muestra varias tarjetas con los platos encontrados, ordenados por relevancia. Si no encuentra resultados:

```
No encontré platos con esas características.
```

---

## 11. Comparar platos

Escribe dos platos para compararlos. El asistente muestra las tarjetas lado a lado.

### Ejemplos

| Consulta | Qué compara |
|----------|-------------|
| `qué engorda más pizza o hamburguesa` | Pizza vs hamburguesa |
| `compara pollo a la plancha con salmón` | Pollo a la plancha vs salmón |
| `big mac en mcdonalds o whopper en burger king` | Big Mac (McDonald's) vs Whopper (Burger King) |

### Resultado

Dos tarjetas nutricionales en paralelo (en escritorio, una al lado de la otra; en móvil, una debajo de otra).

---

## 12. Menú del día

Describe lo que has comido y el asistente estima cada plato por separado.

### Ejemplos

```
he comido lentejas con chorizo, filete con patatas fritas y un flan
```

```
menú del día: gazpacho, merluza a la romana, arroz con leche
```

Si añades "para N personas", el asistente también reparte el total por persona:

```
menú: bravas, croquetas, ensaladilla para 3 personas
```

### Resultado

Una tarjeta por plato y los totales agregados. Si añadiste "para N personas", verás además el desglose por persona. Si algún plato no se reconoce, su tarjeta puede aparecer sin datos nutricionales — el resto se muestra con normalidad.

---

## 13. Historial de consultas

Tus consultas se acumulan en el hilo a medida que las haces. Cómo se conservan depende de si has iniciado sesión:

| | Sin sesión (anónimo) | Con sesión iniciada |
|--|----------------------|---------------------|
| ¿Se acumulan en el hilo? | Sí, durante la sesión | Sí |
| ¿Se guardan al cerrar/recargar? | No — solo viven en esta sesión del navegador | Sí — se guardan en tu cuenta |
| ¿Las veo en otro dispositivo? | No | Sí, al iniciar sesión |

Se guardan tus consultas de **texto** y de **voz** (una consulta por voz sin transcripción aparece como "Consulta por voz"). **El análisis de fotos no se guarda** en el historial (ver aviso en la [Sección 7](#7-analizar-una-foto)).

### Estado vacío

Si has iniciado sesión y aún no tienes nada guardado, verás: *"Aún no tienes historial. Tus consultas de texto y voz se guardarán aquí automáticamente."*

### Borrar una entrada

Cada entrada guardada muestra una papelera y una etiqueta **"Guardado"**. Al pulsar la papelera aparece una confirmación en línea **"¿Eliminar?"** con **[Cancelar] / [Eliminar]** (se cancela sola si no respondes en unos segundos).

### Borrar todo el historial

Pulsa **"Borrar todo el historial"** (arriba en el hilo, visible cuando tienes al menos una entrada guardada). Se abre una confirmación: *"Vas a eliminar todo tu historial de búsqueda. Esta acción no se puede deshacer."* con **[Cancelar] / [Borrar todo]**. **Borrar todo afecta a toda tu cuenta**, no solo a este dispositivo.

### Guardar tu historial (usuarios anónimos)

Si usas la app sin cuenta y haces varias consultas, verás una sugerencia: *"Guarda tu historial entre sesiones. Regístrate para no perder tus consultas."* con un botón **"Crear cuenta gratis"**. Recuerda: lo consultado en modo anónimo **no** se traslada a la cuenta al registrarte.

### Conservación

Tu historial guardado se mantiene en tu cuenta. Para proteger tu privacidad, los historiales muy largos o antiguos pueden recortarse con el tiempo.

---

## 14. Límites de uso

Para mantener el servicio gratuito y disponible para todos, hay un cupo diario. Cada tipo de acción tiene su **propio contador independiente** (consultas de texto, fotos y voz no se restan entre sí):

| Acción | Sin cuenta (anónimo) | Con cuenta (gratuito) |
|--------|:--------------------:|:---------------------:|
| Consultas de texto | 50 / día | 100 / día |
| Análisis de fotos | 10 / día | 20 / día |
| Búsquedas por voz | 30 / día | 30 / día |

Los contadores se **reinician cada día**. Iniciar sesión **duplica tus consultas de texto** (de 50 a 100) y desbloquea el historial guardado.

> En el futuro podríamos ofrecer planes con cupos mayores. Hoy, los disponibles son el uso anónimo y la cuenta gratuita.

### Medidor de uso

Si has iniciado sesión, la cabecera muestra un **medidor de uso** con lo que llevas y lo que te queda:

- En escritorio: contadores compactos (consultas / fotos / voz).
- En móvil: un icono que abre un detalle con "Usadas hoy: X de Y", "Te quedan: Z" y "Se reinicia: mañana".

El medidor pasa a ámbar cuando te queda poco y a rojo cuando estás a punto de agotar un cupo. Si por algún motivo el medidor no puede cargarse, no se muestra, pero la app sigue funcionando con normalidad.

### Qué pasa al alcanzar un límite

Cuando agotas el cupo diario de un tipo de acción, esa acción se bloquea hasta el día siguiente:

```
Has alcanzado el límite diario. Vuelve mañana.
```

Los otros contadores siguen disponibles (por ejemplo, agotar las fotos no afecta a las consultas de texto). Si usas la app **sin cuenta** y llegas al tope de consultas, verás una sugerencia: *"Regístrate gratis y obtén el doble de consultas diarias (100 en lugar de 50)."* con un botón **"Crear cuenta gratis"**.

### Identificación de usuario

Sin sesión, el sistema genera un identificador anónimo que se almacena en tu navegador para controlar el cupo. Con sesión, el cupo va asociado a tu cuenta.

---

## 15. Privacidad y datos

### Qué datos se envían

| Dato | Destino | Retención |
|------|---------|-----------|
| Texto de la consulta | Servidor nutriXplorer | Se guarda en tu historial solo si has iniciado sesión |
| Audio de voz | Servidor nutriXplorer → OpenAI Whisper (para transcribir) | El audio se procesa y no se almacena. Se guarda en tu historial el texto transcrito (solo con sesión iniciada) |
| Foto del plato | Servidor nutriXplorer → proveedor de IA (para análisis visual) | La foto no se retiene tras el análisis. Consulta la [política de privacidad de OpenAI](https://openai.com/policies/api-data-usage) |
| Email (solo si inicias sesión) | Proveedor de identidad (Supabase Auth) | Para autenticar tu cuenta |
| Identificador anónimo | Servidor nutriXplorer | Para control de cupo, sin datos personales |

### Qué datos NO se envían

- Nombre o datos personales más allá del email (y solo si inicias sesión)
- Ubicación geográfica
- Datos del dispositivo

### Datos en tu navegador

| Dato | Almacén | Propósito |
|------|---------|-----------|
| Identificador anónimo | localStorage | Control de cupo (modo anónimo) |
| Sesión de cuenta | Almacenamiento del navegador | Mantener tu sesión iniciada |
| Preferencias de voz | localStorage | Recordar tu voz elegida y si la respuesta hablada está activada |
| Métricas de sesión | localStorage | Contadores agregados (número de consultas, tiempos de respuesta) |

Puedes borrar estos datos limpiando los datos del sitio en tu navegador. Tu **historial guardado** (con sesión) se gestiona desde la [Sección 13](#13-historial-de-consultas).

### Analíticas

Si el administrador ha configurado Google Analytics (GA4), se registran la vista de página (con parámetros UTM si vienes de un enlace) y el evento de envío de consulta. **No se registra el texto de las consultas ni las respuestas** en las analíticas.

---

## 16. Mensajes de error

### Errores de red

| Error | Mensaje | Qué hacer |
|-------|---------|-----------|
| Sin conexión | "Sin conexión. Comprueba tu red." | Verifica tu conexión a internet. Sin conexión no puedes hacer consultas nuevas |
| Timeout (texto) | "La consulta ha tardado demasiado. Inténtalo de nuevo." | Pulsa "Intentar de nuevo" |
| Timeout (foto) | "El análisis ha tardado demasiado. Inténtalo de nuevo." | Puede indicar sobrecarga del servidor |
| Servidor no disponible | "Algo salió mal. Inténtalo de nuevo." | El servidor puede estar reiniciándose |

### Errores de foto

| Error | Mensaje | Qué hacer |
|-------|---------|-----------|
| Formato inválido | "Formato no soportado. Usa JPEG, PNG o WebP." | Convierte la imagen a un formato aceptado |
| Foto demasiado grande | "La foto es demasiado grande. Máximo 10 MB." | Reduce el tamaño o la resolución |
| No se identifica el plato | "No he podido identificar el plato. Intenta con otra foto." | Usa una foto más clara o con mejor iluminación |
| Carta sin platos detectables | "No encontré platos en la imagen." | Acerca la cámara a la sección de la carta |

### Errores de voz

Ver [Sección 8](#8-buscar-por-voz): permiso denegado, no se detecta voz, límite alcanzado o voz temporalmente desactivada.

### Errores de contenido

| Error | Mensaje | Qué hacer |
|-------|---------|-----------|
| Texto demasiado largo | "Demasiado largo. Máx. 500 caracteres." | Acorta tu consulta |
| Límite alcanzado | "Has alcanzado el límite diario. Vuelve mañana." | Espera al día siguiente (ver [Sección 14](#14-límites-de-uso)) |

### Reintentar

Los errores de pantalla completa muestran un botón **"Intentar de nuevo"** que reenvía la última consulta. Los errores menores (texto largo, formato de foto) se muestran junto al campo de texto y se limpian al escribir una nueva consulta.

---

## 17. Comportamiento en móvil

La aplicación está diseñada mobile-first.

### Distribución de tarjetas

| Pantalla | Distribución |
|----------|--------------|
| Móvil (< 768px) | 1 columna, ancho completo |
| Tablet/escritorio (≥ 768px) | Hasta 2 columnas por entrada (ej. comparaciones) |
| Escritorio grande (≥ 1024px) | Contenido centrado con ancho máximo cómodo de lectura |

### Barra de entrada

- Se adapta a los bordes de pantallas con notch o barra de navegación por gestos
- El campo de texto crece hasta 3 líneas como máximo
- Los botones tienen tamaño táctil cómodo

### Cámara en móvil

Al pulsar el botón de cámara, el sistema ofrece **hacer una foto** o **elegir de la galería** (depende del sistema operativo). No se abre la cámara directamente para que también puedas elegir imágenes ya guardadas.

### Rendimiento

- No se descargan modelos de IA en tu dispositivo — todo se procesa en el servidor
- La aplicación carga rápido
- Las animaciones se desactivan automáticamente si tienes activado el ajuste de "reducir movimiento" en tu dispositivo

---

## 18. Accesibilidad

### Lectores de pantalla

- Los botones tienen etiquetas descriptivas (campo de texto, cámara, micrófono, enviar)
- Las tarjetas nutricionales anuncian: "{nombre del plato}: {X} calorías"
- El estado de carga anuncia: "Buscando información nutricional..."
- Los errores se anuncian automáticamente
- Los diálogos (como "Borrar todo el historial") se pueden manejar por completo con el teclado y devuelven el foco al cerrarse

### Voz y lectura en voz alta

- La búsqueda por voz es una alternativa a escribir
- La respuesta hablada se puede **desactivar** desde la pantalla de voz si usas un lector de pantalla, para evitar que se solapen

### Teclado

- `Tab` navega entre los elementos interactivos
- `Enter` envía la consulta desde el campo de texto
- `Shift + Enter` permite saltos de línea
- Los botones y diálogos son operables con `Enter`, `Espacio` y `Escape`

### Movimiento reducido y contraste

Si tienes activado "Reducir movimiento", las animaciones de aparición de tarjetas se desactivan. Los colores de texto cumplen las ratios de contraste WCAG; los badges de confianza usan fondos suaves con texto oscuro.

---

## 19. Configuración técnica (administradores)

> Esta sección es para administradores que despliegan la aplicación. Si eres usuario final, puedes ignorarla.

### Variables de entorno

| Variable | Obligatoria | Descripción |
|----------|:-----------:|-------------|
| `NEXT_PUBLIC_API_URL` | Sí | URL base de la API (ej. `https://api.nutrixplorer.com`) |
| `API_KEY` | Sí* | Clave de servicio para el proxy de análisis de fotos (`fxp_...`). *Solo necesaria si se usa la función de fotos. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | No | ID de Google Analytics 4 (ej. `G-XXXXXXXXXX`). Si no se configura, GA4 no se inyecta. |
| `NEXT_PUBLIC_METRICS_ENDPOINT` | No | URL del endpoint de métricas. Si no se configura, las métricas no se envían. |
| `NEXT_PUBLIC_SITE_URL` | No | URL del sitio para metadatos. Default: `https://nutrixplorer.com` |

> El inicio de sesión (opcional) usa Supabase Auth, configurado mediante sus propias variables de entorno. Consulta el runbook de despliegue del proyecto para los detalles de autenticación.

### Arquitectura

```
Navegador                    Vercel (Next.js)              API (Fastify)
   |                              |                             |
   |-- texto/consulta ----------->|-- POST /conversation/msg -->|
   |<---- respuesta JSON ---------|<---- respuesta JSON --------|
   |                              |                             |
   |-- foto (multipart) -------->|-- + API_KEY header -------->|
   |                         /api/analyze           POST /analyze/menu
   |<---- respuesta JSON ---------|<---- respuesta JSON --------|
```

- Las consultas de texto y voz van del navegador a la API
- Las fotos pasan por un proxy server-side en Vercel que inyecta la `API_KEY` (nunca expuesta al navegador)
- El motor de estimación es determinístico — la IA solo interpreta la consulta

### Despliegue en Vercel

1. Conectar el repositorio GitHub al proyecto Vercel
2. Root Directory: `packages/web`
3. Install Command: `cd ../.. && npm ci`
4. Build Command: `cd ../.. && npm run build -w @foodxplorer/shared && cd packages/web && next build`
5. Configurar las variables de entorno en el dashboard de Vercel
6. Branch de producción: `main`

### Cabeceras de seguridad

La aplicación configura automáticamente: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`, `Permissions-Policy` y una `Content-Security-Policy` restrictiva.

---

## 20. Preguntas frecuentes

### ¿Necesito cuenta para usar el asistente?

No es obligatorio: puedes usarlo de forma anónima. Iniciar sesión es opcional y recomendable si quieres **guardar tu historial** entre dispositivos y tener **más consultas al día** (100 en lugar de 50).

### ¿Cómo inicio sesión? ¿Hay contraseña?

No hay contraseña. Escribes tu email, te enviamos un **enlace de acceso** y al pulsarlo entras. Ver [Sección 3](#3-cuenta-e-inicio-de-sesión).

### No me llega el enlace de acceso / me dice que ha caducado

Puede tardar unos segundos; revisa también el spam. Si el enlace caducó o ya se usó, verás "El enlace de acceso ha expirado o ha sido cancelado. Solicita uno nuevo." — pídelo otra vez desde la pantalla de inicio de sesión.

### ¿Se guardan mis consultas?

Tus consultas de texto y voz se guardan **solo si has iniciado sesión**, y las ves desde cualquier dispositivo. Sin sesión, solo permanecen durante la sesión actual del navegador. **Las fotos no se guardan** en el historial.

### Usé la app sin cuenta y luego inicié sesión, ¿se guarda lo de antes?

No. Lo que consultaste en modo anónimo no se traslada a tu cuenta. A partir de iniciar sesión, las nuevas consultas sí se guardan.

### ¿Cuántas consultas puedo hacer al día?

Sin cuenta: 50 de texto, 10 fotos y 30 por voz al día. Con cuenta gratuita: 100 de texto, 20 fotos y 30 por voz. Cada tipo tiene su propio contador y se reinician cada día. Ver [Sección 14](#14-límites-de-uso).

### ¿El micrófono funciona? Antes estaba deshabilitado

Sí, la búsqueda por voz ya está disponible. Toca el micrófono para hablar y, si quieres, escucha la respuesta en voz alta. Ver [Sección 8](#8-buscar-por-voz).

### ¿Por qué a veces no puedo usar la voz?

Puede que falte el permiso de micrófono, que tu navegador no lo soporte, que hayas alcanzado el límite diario o que la voz esté temporalmente desactivada por mantenimiento. Mientras tanto, usa texto y fotos.

### ¿Los datos nutricionales son exactos?

- **Verificado** (verde): dato oficial de la cadena. Alta precisión.
- **Estimado** (amarillo): calculado por el motor a partir de ingredientes y bases de datos. Buena aproximación.
- **Aproximado** (rosa): estimación con baja confianza. Usar como referencia general.

### ¿Puedo usar la aplicación sin conexión?

No. Todas las consultas requieren conexión — el procesamiento se realiza en el servidor.

### ¿Qué pasa si la foto identifica el plato pero no hay datos nutricionales?

La tarjeta aparecerá con "Sin datos nutricionales disponibles". Puede ocurrir con platos muy específicos o regionales que aún no están en la base de datos.

---

## 21. Referencia rápida

### Tipos de consulta

| Tipo | Ejemplo | Resultado |
|------|---------|-----------|
| Estimación simple | `tortilla de patatas` | 1 tarjeta |
| Con restaurante | `big mac en mcdonalds` | 1 tarjeta (datos verificados) |
| Con porción | `pollo a la plancha 200g` | 1 tarjeta (ajustada) |
| Comparación | `pollo o salmón` | 2 tarjetas |
| Menú | `lentejas, filete, flan` | 3 tarjetas + totales |
| Contexto restaurante | `estoy en burger king` | Confirmación verde |
| Búsqueda inversa | `platos con más de 30g proteína en mcdonalds` | Múltiples tarjetas |
| Foto de un plato | (cámara, modo "Solo este plato") | 1 tarjeta |
| Foto de carta/menú | (cámara, modo "Menú/carta") | Lista de platos |
| Voz | (micrófono) | Igual que texto, con lectura opcional |

### Límites diarios

| Acción | Anónimo | Con cuenta gratuita |
|--------|:-------:|:-------------------:|
| Consultas de texto | 50 | 100 |
| Análisis de fotos | 10 | 20 |
| Búsquedas por voz | 30 | 30 |

### Otros límites

| Recurso | Valor |
|---------|-------|
| Caracteres por consulta | 500 |
| Tamaño máximo de foto | 10 MB |
| Formatos de foto | JPEG, PNG, WebP |
| Duración máxima de voz | 2 minutos |
| Timeout consulta texto | 15 segundos |
| Timeout análisis foto | 65 segundos |

### Atajos de teclado

| Atajo | Acción |
|-------|--------|
| `Enter` | Enviar consulta |
| `Shift + Enter` | Nueva línea |

---

## 22. Información de porción estimada

Cuando tu consulta incluye un término de ración español ("tapa", "ración", "media ración", "pintxo"), la tarjeta de nutrición muestra una línea de estimación de porción.

### Formatos de la línea de porción

| Formato | Ejemplo | Significado |
|---------|---------|-------------|
| `~N unidad (≈ G g)` | `~2 croquetas (≈ 50 g)` | Dato específico del plato: N unidades contables y G gramos estimados |
| `≈ G g` | `≈ 125 g` | Dato específico del plato sin conteo de unidades (p.ej. gazpacho, líquidos) |
| `Tapa estándar: 50–80 g (estimado genérico)` | — | Sin dato específico: se usa el rango genérico del término |

### Qué significa cada símbolo

- **`~`** (tilde): "aproximadamente N unidades". Indica un conteo de piezas estimado para ese plato concreto.
- **`≈`** (aproximadamente igual): "aproximadamente G gramos". El peso es una estimación basada en datos reales de porciones típicas de ese plato.
- **`estimado genérico`**: No hay datos específicos para ese plato. La estimación usa el rango estándar del término de ración (igual para todos los platos).

### Cobertura de datos específicos

En la versión actual, los datos específicos por plato cubren los **30 platos de tapas más populares** de España (croquetas, patatas bravas, gambas al ajillo, tortilla, etc.). Para el resto de platos, la aplicación usa el rango genérico correspondiente al término detectado.

### Interacción con modificadores de porción

Si tu consulta incluye tanto un término de ración como un modificador de tamaño ("grande", "doble", etc.), la tarjeta puede mostrar ambas líneas:
- La píldora de modificador (ej. `PORCIÓN GRANDE`) indica el factor de escala aplicado a los nutrientes.
- La línea de porción estimada muestra las unidades y gramos ajustados al modificador.

Ejemplo: "ración grande de croquetas" → `PORCIÓN GRANDE ×1.5` + `~12 croquetas (≈ 300 g)`

---

*Manual orientado al usuario final de la versión web (/hablar). Para reportar errores o sugerencias: github.com/pbojeda/foodyxplorer*
