# Sub-agent usage in transcripts

Measured 2026-11-26, read-only, on 60 real `subagents/agent-<id>.jsonl` files of `~/.claude/projects` (2811 assistant lines).

## Facts

- Same line format as the main transcript: `type: "assistant"`, `message.usage` (`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, ...), `message.model`, `message.id`.
- All 2811 lines carry `isSidechain: true` and `agentId` equal to the file id; all have `usage`.
- One API message spans several lines with the same `message.id` (1632 repeats): `output_tokens` grows, the tailer already merges them (`usageById`).
- `message.model` is an id (`claude-sonnet-4-6`, `claude-sonnet-5-5`, `claude-haiku-4-5-20251001`, Bedrock `anthropic.claude-haiku-4-5-20251001-v1:0`). The meta `model` is absent (50) or `inherit` (10): never use it as the model of a sub-agent.
- No cost field anywhere (main or sub-agent transcripts).

## Consequences

- Tokens in/out, model and context share per sub-agent: `ModelUsageAccumulator(fromStart, agentId)` over the entries of its own transcript, same formulas as the session header (`usageStatus`). Code: `backend/subagentUsage.ts`, incremental per transcript (offset + folded counters).
- Cost: NOT available. No price table exists in this repo and transcripts hold no cost. The card says so; nothing is invented.
- Context share: the window is an estimate (see `statusline-data-in-transcripts.md`), so the share is an estimate, as in the header.
- A fork's first lines are `fork-context-ref` (no usage); only its own messages count.
