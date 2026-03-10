# UI Component Specification

Define component hierarchies, props, state, and interactions BEFORE implementing.

<!-- CONFIG: Adjust component library references to match your stack -->

## Format

For each component, specify:

```markdown
### ComponentName

**Type**: Page | Layout | Feature | Primitive
**Client**: Yes/No (needs 'use client')

**Props:**
| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| name | string | Yes | — | User display name |

**State:**
- `isLoading: boolean` — Loading state for async operations
- `error: string | null` — Error message

**Interactions:**
- Click submit → calls `onSubmit(formData)`
- Form validation → on blur + on submit

**Loading/Error/Empty States:**
- Loading: Skeleton placeholder
- Error: Alert with retry button
- Empty: Message with CTA
```

---

## Component Hierarchy

<!-- Add your component tree here as you design the UI -->

```
App
├── Layout
│   ├── Header
│   │   ├── Logo
│   │   └── Navigation
│   ├── Main (page content)
│   └── Footer
└── Pages
    └── [Define pages as you plan them]
```

---

## Shared UI Primitives

List the primitive components available in your project (e.g., from shadcn/ui):

- **Button** — Primary, secondary, outline, ghost variants
- **Input** — Text input with label and error state
- **Card** — Container with header, content, footer
- **Dialog** — Modal overlay
- **Table** — Data table with sorting and pagination
- **Select** — Dropdown selection
- **Badge** — Status indicators
- **Alert** — Feedback messages (success, error, warning, info)

---

## Pages

<!-- Define each page's component composition as you design them -->

---

*Update this file BEFORE implementing new components or pages.*
