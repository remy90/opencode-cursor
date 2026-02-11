# Tool Reliability Gap (2026-02-11)

## Current State
- Local `cursor-acp` tools (10): `bash`, `read`, `write`, `edit`, `grep`, `ls`, `glob`, `mkdir`, `rm`, `stat`.
- OpenCode runtime tool surface observed in production includes additional built-ins:
  - `task`, `webfetch`, `todowrite`, `skill`, `skill_mcp`, `interactive_bash`, `google_search`, `session_*`, `lsp_*`, `ast_grep_*`, `distill`, `prune`, `memory`, `background_*`, `look_at`, `slashcommand`.

## What Was Improved
- Added robust tool-name aliasing at the provider boundary for command and filesystem operations (`shell`, `executeCommand`, `createDirectory`, `deleteFile`, `findFiles`, etc.).
- Added argument alias/normalization for `bash`, `glob`, and `rm` (`cmd`, `workdir`, `targetDirectory`, `globPattern`, `recursive`, etc.).
- Hardened default tool handlers for argument parsing and better non-fatal behavior.
- Fixed `glob` implementation for slash patterns like `TOOL_REL_DIR/**/*.txt` and permission-denied tolerance.
- Updated loop guard to treat unknown outputs from output-heavy tools (notably `bash`) as success-class for loop accounting.

## Remaining Gaps
- Production runs can still loop on repeated successful tool calls due model behavior (guard stops it, but UX can still be noisy).
- `glob` behavior in full OpenCode sessions can diverge from local executor behavior due duplicate `glob` providers in the registry.
- We still rely heavily on model self-correction for choosing the "best" tool (`bash` vs filesystem-native).

## Distance To “Consistent Tooling”
- For core file/shell tools: **~75-85% stable**.
- For broader OpenCode-native workflows (`skills`, `MCP`, `session_*`, `lsp_*`): **integration exists but reliability/observability work is still pending**.

## Next Critical Work
1. Add tool-provider preference policy (prefer `cursor-acp` implementation for `glob`/`rm`/`mkdir` when duplicates exist).
2. Add structured telemetry per tool call: requested name, aliased name, executor selected, outcome.
3. Build explicit smoke matrix for `skills` + `skill_mcp` + representative MCP tools.
