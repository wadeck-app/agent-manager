# Status line data in transcripts

Measured 2026-11-15, read-only, on `~/.claude/projects` (Claude Code 2.1.3xx; ~30 newest files for counts, greps over all 7.6 GB for id forms) and on the installed binary (`claude.exe` 2.1.325, `grep -a`). Scripts: `poc/scripts/probe-model-*.mjs`, `probe-context-window.mjs`, `probe-cost-state.mjs`, `probe-rollup-real.mjs`.

## What the transcript offers

| Source | Fields | Notes |
|---|---|---|
| `attachment` line, `attachment.type == "model"` | `identity.{modelId, marketingName, knowledgeCutoff}` | Written at session start, after `/model`, on resume. `modelId` is exact (`us.anthropic.claude-opus-5-5[1m]`), `marketingName` is the statusline `display_name` ("Opus 5.5 (1M context)"). Usually just AFTER the first assistant line of a new model, at start BEFORE it. |
| `assistant` line | `message.model`, `requestedModel` (top level), `message.usage` | `message.model` drops the region and the `[1m]` tag. `requestedModel` keeps the Bedrock form. |
| `usage` keys | `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `service_tier`, `speed`, ... | One line per content block, same message id, `output_tokens` grows. |
| `/model` | user line `<command-name>/model</command-name>` + user line `<local-command-stdout>Set model to \`Haiku 5.5\` and saved as your default for new sessions</local-command-stdout>` | Variants: `... for this session only`, `... for this session`, `Kept model as \`X\`` (no change). Gives the NAME only, no id. |
| `cost-state` line | `totalDuration`, `startTime`, `modelUsage{<id incl. [1m]>: tokens, costUSD}`, `totalCostUSD` | Written when the session ends (23 in 30 files): useless for a live session. |
| `system` subtypes | `turn_duration`, `stop_hook_summary`, `away_summary`, `local_command`, `compact_boundary` | No model-change subtype exists. `compact_boundary` has `trigger` and `preTokens`. |

Model id forms seen in `message.model`: `claude-sonnet-5-5`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-opus-5`, `claude-opus-5-5`, `claude-opus-4-8`, `claude-haiku-4-5-20251001`, `claude-haiku-5-5`, `anthropic.claude-haiku-4-5-20251001-v1:0`, `us.anthropic.claude-sonnet-5-5`, `us.anthropic.claude-opus-5-5[1m]` (attachment/cost-state only), `<synthetic>` (Claude Code's own messages, ignore), aliases `haiku|sonnet|opus` (sub-agent metas only). Canonical form: strip region, `anthropic.`, `-vN:N`, `-YYYYMMDD`, `@YYYYMMDD`, `[1m]`.

## Statusline fields

Read in the binary: `total_input_tokens = current_usage.input + cache_creation + cache_read` and `total_output_tokens = current_usage.output_tokens` of the LAST API call (not running totals); `used_percentage = clamp(round(that_input / context_window_size * 100))`.

| Field | Derivation | Exactness |
|---|---|---|
| `model.display_name` | `marketingName` of the attachment; else table by canonical id | exact with attachment, derived otherwise; unknown id shown raw, `known: false` |
| `total_input_tokens` | last assistant message usage, three input counters | exact |
| `total_output_tokens` | last assistant message `output_tokens` | exact (grows while streaming) |
| `used_percentage` | formula above, window assumed | ESTIMATE: `context_window_size` is not in the transcript |
| `total_duration_ms` | `now - registry startedAt` | approximation: the real value is a wall clock Claude Code restores on resume; `cost-state.totalDuration` ~ `now - startTime` on 8 files, but carries the old value after a resume (56432775 vs 237348 ms) |
| branch, role, bypasses | `git -C`, roles file, bypass file | read as `statusline*.js` does |

## Context window (the estimate)

The binary takes the window from a model catalog (`window`, `maximum_window`) plus the `context-1m` beta; nothing is written to the transcript. Evidence used, in order:

1. `[1m]` in the attachment `modelId`, or "(1M context)" in `marketingName`: 1M.
2. `claude-sonnet-5-5` and `claude-sonnet-5`: no tag, yet contexts up to 967,657 / 966,778 tokens and auto-compactions at ~966-969k (`compact_boundary`): 1M. The user's example (367.8k = 37%) agrees (~994k). Marked `provenWindow` in the table. The chip now shows the share of the auto-compact point (window - 33k), see ui-audit.md "Context gauge".
3. Any context above 200k: the window cannot be 200k, 1M assumed (`observed-over-default`).
4. Else 200k default. Unproven for Opus/Haiku/Sonnet 4.x without tag (Sonnet 4.6 seen only up to 123k).

`basis` is therefore always `estimate`, with the source in `note`.

## Behaviour decisions

- Current model = model of the last main-session assistant/usage entry (sub-agents and `<synthetic>` ignored). `message.model` alone cannot tell the 1M variant; the attachment is looked for once per model, up to 2 MiB backwards (cached by mtime+size).
- Model-change notice: from the `/model` stdout (placed at the command) OR the first assistant entry with a different canonical model (placed before its message, thinking included); a command suppresses the assistant one. A window starting after the previous model cannot notice a change at its edge; log cursors carry the model (`m`) so polling does not lose it.
- Attachment on `Fable 5.1` after `/model` while Haiku answered (file 9422b6b6, line 13 vs 37): the attachment does not prove the main model; only assistant lines do.

## Unknowns

- Real `context_window_size` per model (catalog, runtime). Verifiable only by capturing the statusline stdin payload.
- Cumulative token totals need the whole file (`cumulativeComplete` flag in core; the module does not compute them).
- Whether `startedAt` of the registry resets on `--resume`.
