# Context: dc-qa-tester

Read these at startup, in order. Nothing else up front; open other files only when the task needs them.

Always:
- `core/RULES.md`
- `core/PROTOCOL.md`
- `playbooks/dc-qa-tester.md`

For this role:
- `specs/<feature>/requirements.md`
- `specs/<feature>/ux.md`
- `specs/<feature>/architecture.md` if present (Test seams), otherwise the README: how to start the app
- the earlier QA report named in your prompt, on a re-check round
- `memory/caveats.md`

Not for you: implementation source. Judge the app by what a user sees.
