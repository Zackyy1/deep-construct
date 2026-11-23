# Playbook changes

Every playbook edit, newest last. The orchestrator writes these.

<!-- Format:
## 2026-11-23 · dc-implementer · added P-004
Cause: reports/archive/T-0009/review-r1.json (reviewer found unvalidated query params twice in a row)
Diff: + "Validate every query param with the route's zod schema before use."
-->

## 2026-11-23 · dc-code-reviewer · added P-001
Cause: my-test-app reports/archive/T-0002/review-r1.json (32 turns; started `vite preview` and wrote probe scripts in /tmp for a small change)
Diff: + "Review the diff against the ACs in Scope and run the project's own checks. Don't start dev servers, open a browser or write probe scripts: that is QA's job."
