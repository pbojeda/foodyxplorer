Genera un prompt de recuperacion de contexto completo y detallado para pegar despues de hacer /compact.

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

Para generar esto:
- Lee `docs/project_notes/product-tracker.md` (Active Session + Features tables + Completion Log)
- Lee `docs/project_notes/decisions.md` (ADRs recientes)
- Lee `docs/project_notes/key_facts.md` (stack, componentes)
- Ejecuta `git log --oneline -3` y `git status` para estado actual
- Revisa el ultimo ticket completado en `docs/tickets/` para referencia de patron

Formato: markdown estructurado con tablas, listo para pegar directamente como primer mensaje de una nueva sesion.

## Contexto del usuario                             
                                                      
  - Trabaja remotamente con sesiones largas —         
interrupciones por permisos son costosas              
  - Prefiere prompts detallados de continuación       
  - Principio guía: "Lo importante es hacerlo bien,   
que ya llevamos mucho trabajo hecho y no hay que      
estropear nada de lo anterior, solo                   
  mejorarlo"                                          
  - Idioma: español para comunicación, inglés para    
artefactos técnicos
