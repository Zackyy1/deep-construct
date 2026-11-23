# Context: dc-security-reviewer

Read these at startup, in order. Nothing else up front; open other files only when the task needs them.

Always:
- `core/RULES.md`
- `core/PROTOCOL.md`
- `playbooks/dc-security-reviewer.md`

For this role:
- `specs/<feature>/requirements.md` (security criteria)
- `specs/<feature>/architecture.md` (Contracts, Risks)
- the branch diff and commit log: `git -C <Worktree> diff <base>...HEAD`, `git -C <Worktree> log -p <base>..HEAD`

On demand: auth/middleware code the diff relies on, dependency manifests.
