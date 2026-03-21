Genera un prompt de recuperacion de contexto completo y detallado para pegar despues de hacer /compact o de un /clear.

El prompt debe incluir TODO lo necesario para que una nueva sesion (o post-compact) pueda continuar el trabajo sin perdida de informacion:

1. **Estado del proyecto**: rama actual, ultimo commit, estado del working tree
2. **Workflow**: SDD development workflow, autonomy level, branching strategy, idioma
3. **Epics y progreso**: tabla con estado de cada epic (E001-E004)
4. **Hallazgos estrategicos**: ADRs relevantes que afectan el backlog (ej: ADR-005, ADR-006 pivot PDF-first)
5. **Backlog actual de E002**: tabla completa con todos los features (F007-F019), estado, y notas
6. **Infraestructura existente**: endpoints de ingestion, shared utilities, scraper pattern, con paths exactos
7. **Tests**: conteo total (API + scraper), archivos, estado de lint/build/tsc
8. **Archivos clave a leer**: lista de los archivos que la nueva sesion debe leer primero
9. **Que hacer**: siguiente tarea (next task), contexto de lo que implica, notas del usuario relevantes
10. **Notas importantes**: cualquier decision o restriccion que el usuario haya comunicado (ej: "Domino's es JPEG no PDF", "maxima reutilizacion")

### Workflow Recovery (CRITICO)

Esta seccion evita que el agente pierda la nocion del proceso de desarrollo despues de /compact:

11. **Step actual del workflow**: En cual de los 6 steps (Spec, Setup, Plan, Implement, Finalize, Review) esta la feature activa
12. **Checkpoints pendientes**: Que aprobaciones faltan (Spec, Ticket, Plan, Commit, Merge)
13. **Recordatorio de merge checklist**: Si esta en Step 5 o posterior, incluir explicitamente: "Antes de pedir merge approval, DEBES leer `references/merge-checklist.md` y ejecutar TODAS las acciones (0-8). Rellena la tabla `## Merge Checklist Evidence` del ticket con evidencia real para cada accion."
14. **Recordatorio de orden**: "Despues de commit+PR, ejecuta code-review-specialist y qa-engineer (Step 5), luego ejecuta las acciones del merge-checklist. NO pidas merge approval sin completar el checklist."

Para generar esto:
- Lee `docs/project_notes/product-tracker.md` (Active Session + Features tables + Completion Log)
- Lee `docs/project_notes/decisions.md` (ADRs recientes)
- Lee `docs/project_notes/key_facts.md` (stack, componentes)
- Ejecuta `git log --oneline -3` y `git status` para estado actual
- Revisa el ultimo ticket completado en `docs/tickets/` para referencia de patron

Formato: markdown estructurado con tablas, listo para pegar directamente como primer mensaje de una nueva sesion.

## Contexto del usuario                             
                                                      
  - Trabaja remotamente con sesiones largas 
  — interrupciones por permisos son costosas              
  - Prefiere prompts detallados de continuación       
  - Principio guía: "Lo importante es hacerlo bien, que ya llevamos mucho trabajo hecho y no hay que estropear nada de lo anterior, solo mejorarlo"                                          
  - Idioma: español para comunicación, inglés para artefactos técnicos
