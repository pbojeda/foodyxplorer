# Manual de Usuario — nutriXplorer Web (/hablar)

> Guía completa del asistente nutricional web de nutriXplorer.
> Última actualización: 2026-04-11 (generado contra código fuente — incluye F090, F092, F093, F112, F113)

---

## Tabla de Contenidos

1. [Qué es /hablar](#1-qué-es-hablar)
2. [Primeros pasos](#2-primeros-pasos)
3. [Pantalla principal](#3-pantalla-principal)
4. [Consultar calorías por texto](#4-consultar-calorías-por-texto)
5. [Tipos de respuesta](#5-tipos-de-respuesta)
6. [Analizar una foto](#6-analizar-una-foto)
7. [Contexto de restaurante](#7-contexto-de-restaurante)
8. [Búsqueda inversa](#8-búsqueda-inversa)
9. [Comparar platos](#9-comparar-platos)
10. [Menú del día](#10-menú-del-día)
11. [Límites de uso](#11-límites-de-uso)
12. [Privacidad y datos](#12-privacidad-y-datos)
13. [Mensajes de error](#13-mensajes-de-error)
14. [Comportamiento en móvil](#14-comportamiento-en-móvil)
15. [Accesibilidad](#15-accesibilidad)
16. [Voz (próximamente)](#16-voz-próximamente)
17. [Configuración técnica (administradores)](#17-configuración-técnica-administradores)
18. [Preguntas frecuentes](#18-preguntas-frecuentes)
19. [Referencia rápida](#19-referencia-rápida)

---

## 1. Qué es /hablar

`/hablar` es el asistente nutricional web de nutriXplorer. Funciona como una consulta interactiva: escribes o envías una foto, y el asistente responde con tarjetas nutricionales. No es un chat con historial — cada consulta es independiente y los resultados se muestran en tarjetas, no en burbujas de conversación.

Con `/hablar` puedes:

- **Preguntar por calorías y macros** de cualquier plato, receta o producto
- **Comparar dos platos** para decidir cuál te conviene más
- **Analizar una foto** de un plato o menú y obtener los nutrientes
- **Establecer contexto** de un restaurante para que las respuestas se ajusten a su carta
- **Buscar platos** por características nutricionales (ej. "platos con más de 30g de proteína")

Es la versión web del bot de Telegram de foodXPlorer (ahora nutriXplorer), con la misma precisión en los cálculos nutricionales. No necesitas instalar nada — funciona en cualquier navegador moderno.

**Principio fundamental:** El asistente identifica y descompone lo que describes, pero los cálculos nutricionales los realiza un motor de estimación determinístico y auditable. La IA nunca inventa cifras de nutrientes.

---

## 2. Primeros pasos

### Acceder

Abre tu navegador y ve a la URL de la aplicación (ej. `https://app.nutrixplorer.com`). Serás redirigido automáticamente a `/hablar`.

### Requisitos

- Navegador moderno: Chrome, Firefox, Safari, Edge (escritorio o móvil)
- Conexión a internet
- No necesitas cuenta ni registro — el uso es anónimo

### Primer uso

Al entrar verás la pantalla del asistente con el mensaje "¿Qué quieres saber?" y un campo de texto en la parte inferior. Escribe tu consulta y pulsa Enter.

No hay comandos especiales que aprender. Escribe como hablas:

```
cuántas calorías tiene una tortilla de patatas
```

---

## 3. Pantalla principal

La interfaz tiene tres zonas:

### Cabecera

Barra superior fija con el nombre "nutriXplorer" en verde. Siempre visible.

### Área de resultados

Zona central desplazable donde aparecen las respuestas. Puede mostrar:

- **Estado vacío:** Mensaje "¿Qué quieres saber?" con instrucciones
- **Cargando:** Dos tarjetas con animación de carga
- **Resultados:** Tarjetas nutricionales con los datos del plato
- **Error:** Mensaje de error con botón "Intentar de nuevo"

Las tarjetas se distribuyen en una columna en móvil y en dos columnas en pantallas medianas y grandes. Cada nueva consulta reemplaza los resultados anteriores — no se acumulan.

### Barra de entrada

Barra fija en la parte inferior con:

| Elemento | Descripción |
|----------|-------------|
| Campo de texto | Área de escritura. Crece hasta 3 líneas. Placeholder: "¿Qué quieres saber?" |
| Botón cámara (verde) | Abre el selector de fotos para analizar un plato |
| Botón micrófono (gris) | Deshabilitado — función de voz en desarrollo |
| Botón enviar (naranja) | Aparece solo cuando hay texto escrito. Envía la consulta |

**Atajos de teclado:**
- `Enter` — Envía la consulta
- `Shift + Enter` — Salto de línea (no envía)

---

## 4. Consultar calorías por texto

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

## 5. Tipos de respuesta

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

Si mencionas un restaurante, el asistente activa contexto para que las siguientes consultas se ajusten a su carta. Muestra una confirmación verde. Más detalles en la [Sección 7](#7-contexto-de-restaurante).

```
Ejemplo: estoy en mcdonalds
```

### Búsqueda inversa

Busca platos por criterios nutricionales. Muestra múltiples tarjetas. Funciona mejor si especificas un restaurante o cadena. Más detalles en la [Sección 8](#8-búsqueda-inversa).

```
Ejemplo: platos con menos de 300 calorías y más de 20g de proteína
```

---

## 6. Analizar una foto

### Cómo funciona

1. Pulsa el **botón de cámara** (icono verde en la barra inferior)
2. Se abre el selector de archivos de tu dispositivo
   - En móvil: puedes elegir entre la cámara o la galería
   - En escritorio: abre el explorador de archivos
3. Selecciona una foto
4. El asistente analiza la imagen e identifica los platos visibles
5. Para cada plato identificado, se muestra una tarjeta nutricional

**Nota:** Si el asistente identifica un plato pero no encuentra sus datos nutricionales, la tarjeta aparecerá con el mensaje "Sin datos nutricionales disponibles".

### Formatos aceptados

| Formato | Aceptado |
|---------|----------|
| JPEG (.jpg, .jpeg) | Sí |
| PNG (.png) | Sí |
| WebP (.webp) | Sí |
| GIF, BMP, TIFF | No |
| PDF | No |

### Límite de tamaño

**Máximo 10 MB por foto.** Si la foto es más grande, verás un error: "La foto es demasiado grande. Máximo 10 MB."

**Optimización automática antes de subir:** desde 2026-04-12, las fotos de más de 1,5 MB se reescalan en el navegador antes de enviarlas (lado más largo ≤ 1600 px, JPEG calidad ~82). Esto asegura que fotos de móviles modernos (que pueden rondar los 4–8 MB) se queden holgadamente por debajo del límite de la infraestructura que hospeda la web. Las fotos pequeñas se envían sin modificar. Si tu navegador no soporta el reescalado, se envía el archivo original.

### Tiempo de procesamiento

El análisis de fotos tarda más que una consulta de texto porque interviene un modelo de visión artificial. Normalmente tarda entre 5 y 15 segundos. El límite máximo de espera es de **65 segundos**.

### Ejemplos de uso

| Foto de... | Resultado |
|------------|-----------|
| Un plato de comida | Identifica el plato y estima nutrientes |
| Un menú impreso | Identifica los platos listados y estima cada uno |
| Una foto borrosa | Puede fallar — "No he podido identificar el plato" |

### Consejos para mejores resultados

- Haz la foto con buena iluminación
- Centra el plato o menú en la imagen
- Evita fotos muy oscuras o borrosas
- Si el menú es grande, haz fotos de secciones individuales

---

## 7. Contexto de restaurante

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

## 8. Búsqueda inversa

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

## 9. Comparar platos

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

## 10. Menú del día

Describe lo que has comido y el asistente estima cada plato por separado.

### Ejemplos

```
he comido lentejas con chorizo, filete con patatas fritas y un flan
```

```
menú del día: gazpacho, merluza a la romana, arroz con leche
```

### Resultado

Una tarjeta por plato. Si algún plato no se reconoce, su tarjeta puede aparecer sin datos nutricionales — el resto se muestra con normalidad.

---

## 11. Límites de uso

| Recurso | Límite |
|---------|--------|
| Consultas (texto + fotos) | 50 por ventana de 24 horas, por usuario |

El límite es compartido entre consultas de texto y fotos.

### Qué pasa al llegar al límite

```
Has alcanzado el límite diario de 50 consultas. Vuelve mañana.
```

### Identificación de usuario

El sistema genera un identificador anónimo que se almacena en tu navegador para controlar el límite de uso. No se requiere registro.

---

## 12. Privacidad y datos

### Qué datos se envían

| Dato | Destino | Retención |
|------|---------|-----------|
| Texto de la consulta | Servidor nutriXplorer | No se almacena permanentemente |
| Foto del plato | Servidor nutriXplorer → proveedor de IA (para análisis visual) | La foto no se retiene tras el análisis. Consulta la [política de privacidad de OpenAI](https://openai.com/policies/api-data-usage) para más detalles. |
| Identificador anónimo | Servidor nutriXplorer | Para control de límite de uso, sin datos personales |

### Qué datos NO se envían

- Nombre, email o cualquier dato personal
- Historial de consultas previas (cada consulta es independiente)
- Ubicación geográfica
- Datos del dispositivo

### Datos en tu navegador

| Dato | Almacén | Propósito |
|------|---------|-----------|
| Identificador anónimo | localStorage | Control de límite de uso |
| Métricas de sesión | localStorage | Contadores agregados (número de consultas, tiempos de respuesta) |

Puedes borrar estos datos en cualquier momento limpiando los datos del sitio en tu navegador.

### Analíticas

Si el administrador ha configurado Google Analytics (GA4), se registran:
- Vista de página (con parámetros UTM si vienes de un enlace)
- Evento de envío de consulta (sin el contenido de la consulta)

No se registra el texto de las consultas ni las respuestas en las analíticas.

---

## 13. Mensajes de error

### Errores de red

| Error | Mensaje | Qué hacer |
|-------|---------|-----------|
| Sin conexión | "Sin conexión. Comprueba tu red." | Verifica tu conexión a internet |
| Timeout (texto) | "La consulta ha tardado demasiado. Inténtalo de nuevo." | Pulsa "Intentar de nuevo" |
| Timeout (foto) | "El análisis ha tardado demasiado. Inténtalo de nuevo." | Puede indicar sobrecarga del servidor |
| Servidor no disponible | "Algo salió mal. Inténtalo de nuevo." | El servidor puede estar reiniciándose |

### Errores de foto

| Error | Mensaje | Qué hacer |
|-------|---------|-----------|
| Formato inválido | "Formato no soportado. Usa JPEG, PNG o WebP." | Convierte la imagen a un formato aceptado |
| Foto demasiado grande | "La foto es demasiado grande. Máximo 10 MB." | Reduce el tamaño o la resolución |
| No se identifica el plato | "No he podido identificar el plato. Intenta con otra foto." | Usa una foto más clara o con mejor iluminación |

### Errores de contenido

| Error | Mensaje | Qué hacer |
|-------|---------|-----------|
| Texto demasiado largo | "Demasiado largo. Máx. 500 caracteres." | Acorta tu consulta |
| Límite alcanzado | "Has alcanzado el límite diario de 50 consultas. Vuelve mañana." | Espera 24 horas |

### Reintentar

Todos los errores de pantalla completa muestran un botón **"Intentar de nuevo"** que reenvía la última consulta. Los errores menores (texto largo, formato de foto) se muestran junto al campo de texto y se limpian automáticamente al escribir una nueva consulta.

---

## 14. Comportamiento en móvil

La aplicación está diseñada mobile-first.

### Distribución de tarjetas

| Pantalla | Tarjetas | Anchura |
|----------|----------|---------|
| Móvil (< 768px) | 1 columna | Ancho completo |
| Tablet/escritorio (≥ 768px) | 2 columnas | Grid con separación |
| Escritorio grande (≥ 1024px) | 2 columnas | Máximo 672px centrado |

### Barra de entrada

- Se adapta a los bordes de pantallas con notch o barra de navegación por gestos
- El campo de texto crece hasta 3 líneas como máximo
- Los botones tienen tamaño táctil cómodo (48x48 px)

### Cámara en móvil

Al pulsar el botón de cámara en móvil, el sistema ofrece:
- **Hacer foto** con la cámara trasera
- **Elegir de galería** (depende del sistema operativo)

### Rendimiento

- No se descargan modelos de IA en tu dispositivo — todo se procesa en el servidor
- La aplicación carga rápido (menos de 200 KB de código)
- Las animaciones se desactivan automáticamente si tienes activado el ajuste de "reducir movimiento" en tu dispositivo

---

## 15. Accesibilidad

### Lectores de pantalla

- Todos los botones tienen etiquetas descriptivas:
  - Campo de texto: "Escribe tu consulta"
  - Botón cámara: "Subir foto del plato"
  - Botón enviar: "Buscar"
  - Botón micrófono: "Micrófono (próximamente)"
- Las tarjetas nutricionales anuncian: "{nombre del plato}: {X} calorías"
- El estado de carga anuncia: "Buscando información nutricional..."
- Los errores se anuncian automáticamente a lectores de pantalla

### Teclado

- `Tab` navega entre los elementos interactivos
- `Enter` envía la consulta desde el campo de texto
- `Shift + Enter` permite saltos de línea
- Los botones son activables con `Enter` o `Espacio`

### Movimiento reducido

Si tienes activado "Reducir movimiento" en tu sistema operativo, las animaciones de aparición de tarjetas y los efectos de carga se desactivan automáticamente.

### Contraste

Los colores del texto cumplen las ratios de contraste WCAG. Los badges de confianza usan colores de fondo suaves con texto oscuro.

---

## 16. Voz (próximamente)

El botón de micrófono está visible pero deshabilitado. La funcionalidad de voz está en desarrollo y permitirá:

- Hablar en lugar de escribir
- El asistente responderá en voz alta usando síntesis de voz del navegador

---

## 17. Configuración técnica (administradores)

> Esta sección es para administradores que despliegan la aplicación. Si eres usuario final, puedes ignorarla.

### Variables de entorno

| Variable | Obligatoria | Descripción |
|----------|:-----------:|-------------|
| `NEXT_PUBLIC_API_URL` | Sí | URL base de la API (ej. `https://api.nutrixplorer.com`) |
| `API_KEY` | Sí* | Clave de servicio para el proxy de análisis de fotos (`fxp_...`). *Solo necesaria si se usa la función de fotos. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | No | ID de Google Analytics 4 (ej. `G-XXXXXXXXXX`). Si no se configura, GA4 no se inyecta. |
| `NEXT_PUBLIC_METRICS_ENDPOINT` | No | URL del endpoint de métricas (ej. `https://api.nutrixplorer.com/analytics/web-events`). Si no se configura, las métricas no se envían. |
| `NEXT_PUBLIC_SITE_URL` | No | URL del sitio para metadatos. Default: `https://nutrixplorer.com` |

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

- Las consultas de texto van directamente del navegador a la API
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

La aplicación configura automáticamente:

| Cabecera | Valor |
|----------|-------|
| X-Frame-Options | DENY |
| X-Content-Type-Options | nosniff |
| Referrer-Policy | strict-origin-when-cross-origin |
| Strict-Transport-Security | max-age=63072000 |
| Permissions-Policy | camera=(), microphone=(), geolocation=() |
| Content-Security-Policy | Restrictiva (report-only) |

---

## 18. Preguntas frecuentes

### ¿Necesito cuenta para usar el asistente?

No. El acceso es anónimo. Se genera un identificador temporal en tu navegador para controlar el límite de uso.

### ¿Cuántas consultas puedo hacer al día?

50 consultas por ventana de 24 horas (texto y fotos compartidos en el mismo límite).

### ¿Por qué me dice "Sin conexión" si tengo internet?

El servidor de la API puede estar temporalmente no disponible o reiniciándose. Espera unos segundos e intenta de nuevo.

### La foto no se analiza, ¿qué hago?

- Comprueba que es JPEG, PNG o WebP
- Comprueba que pesa menos de 10 MB
- Haz la foto con mejor iluminación
- Prueba con una foto diferente del mismo plato

### ¿Los datos nutricionales son exactos?

- **Verificado** (badge verde): Dato oficial de la cadena de restauración. Alta precisión.
- **Estimado** (badge amarillo): Calculado por el motor de estimación a partir de ingredientes y bases de datos nutricionales. Buena aproximación.
- **Aproximado** (badge rosa): Estimación con baja confianza. Usar como referencia general.

### ¿Puedo usar la aplicación sin conexión?

No. Todas las consultas requieren conexión a internet — el procesamiento se realiza en el servidor.

### ¿Mis consultas se guardan?

No. Cada consulta se procesa y se descarta. No hay historial de conversaciones.

### ¿Por qué el botón del micrófono está deshabilitado?

La funcionalidad de voz está en desarrollo. Estará disponible en una futura actualización.

### ¿Qué pasa si la foto identifica el plato pero no hay datos nutricionales?

La tarjeta del plato aparecerá con el mensaje "Sin datos nutricionales disponibles". Esto puede ocurrir con platos muy específicos o regionales que aún no están en la base de datos.

---

## 19. Referencia rápida

### Tipos de consulta

| Tipo | Ejemplo | Resultado |
|------|---------|-----------|
| Estimación simple | `tortilla de patatas` | 1 tarjeta |
| Con restaurante | `big mac en mcdonalds` | 1 tarjeta (datos verificados) |
| Con porción | `pollo a la plancha 200g` | 1 tarjeta (ajustada) |
| Comparación | `pollo o salmón` | 2 tarjetas |
| Comparación cross-chain | `big mac en mcdonalds o whopper en burger king` | 2 tarjetas |
| Menú | `lentejas, filete, flan` | 3 tarjetas |
| Contexto restaurante | `estoy en burger king` | Confirmación verde |
| Búsqueda inversa | `platos con más de 30g proteína en mcdonalds` | Múltiples tarjetas |
| Foto de plato | (botón cámara) | 1+ tarjetas |

### Límites

| Recurso | Valor |
|---------|-------|
| Consultas por ventana de 24h | 50 |
| Caracteres por consulta | 500 |
| Tamaño máximo de foto | 10 MB |
| Formatos de foto | JPEG, PNG, WebP |
| Timeout consulta texto | 15 segundos |
| Timeout análisis foto | 65 segundos |

### Atajos de teclado

| Atajo | Acción |
|-------|--------|
| `Enter` | Enviar consulta |
| `Shift + Enter` | Nueva línea |

---

*Manual generado contra el código fuente de packages/web. Para contribuir o reportar errores: github.com/pbojeda/foodyxplorer*
