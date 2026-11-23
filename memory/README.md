# Shared memory

How agents share knowledge when they aren't talking to each other. Every agent may add to these files.

| File | What goes in it |
|---|---|
| `important.md` | Things every agent must know before working: constraints, user preferences, rule proposals |
| `caveats.md` | Traps and surprises: flaky tools, odd library behaviour, things that failed and why |
| `general.md` | Useful context that doesn't fit elsewhere: where things live, conventions found |
| `brand.md` | Brand, colours, typography and tone. Owned by the UX/UI lead |

Decisions do **not** go here. They go in `specs/<feature>/decisions.md`.

## Entry format

Add new entries at the end of a file. Never edit or delete another agent's entry.

```
## 2026-11-23 · implementer · T-0004
Prisma's `createMany` does not return created rows on SQLite. Use a loop with `create`.
Source: reports/archive/T-0004/implementation-r2.json
```

- One fact per entry, short enough to read in five seconds.
- Always cite a source (report, file, commit, or "user said").
- No secrets, tokens, passwords or personal data.

Only the orchestrator merges duplicates, removes outdated entries, or moves entries between files.
