# Specs

One folder per feature: `specs/<feature>/`.

| File | Written by | Contents |
|---|---|---|
| `requirements.md` | Requirements analyst | User stories, acceptance criteria, edge cases, out of scope |
| `ux.md` | UX/UI lead | Screens, states, interactions, copy, visual rules |
| `architecture.md` | Architect | Data model, API contracts, file structure, task breakdown |
| `decisions.md` | Anyone, as ADRs | The single home for decisions |

## Acceptance criteria

Every criterion gets an ID `AC-<n>` that is never reused. The gates find criteria by this ID:
tests must cover every `AC-n`, and QA must mark every `AC-n` as passing.

```
- AC-1: Given a signed-out user, when they submit valid credentials, they land on /dashboard.
```

## Decision entries

```
## ADR-003 · 2026-11-23 · architect · T-0002
Decision: Session cookies instead of JWT in localStorage.
Why: XSS-safe by default; app is single-domain.
Alternatives: JWT (rejected: token theft via XSS).
```
