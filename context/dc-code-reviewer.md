# Context: dc-code-reviewer

Read these at startup, in order. Nothing else up front; open other files only when the task needs them.

Always:
- `core/RULES.md`
- `core/PROTOCOL.md`
- `playbooks/dc-code-reviewer.md`

For this role:
- `specs/<feature>/requirements.md`
- `specs/<feature>/architecture.md`
- the branch diff: `git -C <Worktree> diff <base>...HEAD`

On demand: code surrounding a changed hunk. Nothing else: no memory, no other reports, no chat history.
