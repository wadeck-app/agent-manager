# Session and sub-agent cost

Measured 2026-11-27, read-only. Supersedes the "Cost: NOT available" line of `subagent-usage-in-transcripts.md`.

## What the transcripts hold

15 475 `.jsonl` files of `~/.claude/projects` (main and sub-agent), 698 060 usage objects.

- Counts: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` (always present), `cache_creation.ephemeral_1h_input_tokens` / `ephemeral_5m_input_tokens` (698 079 splits, the sum equals the total except 16 lines), `server_tool_use.web_search_requests`, `output_tokens_details.thinking_tokens` (included in `output_tokens`, never priced apart).
- Price modifiers: `speed` is `standard` on all 563 182 lines that have it; `inference_geo` is `""` (global) on all of them; `service_tier` `standard`; `iterations` always empty; no non-zero web search.
- Model ids (usage lines): `claude-sonnet-5-5`, `claude-sonnet-4-6`, `claude-sonnet-5`, `claude-opus-5`, `claude-opus-5-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-opus-4-5-20251101`, `claude-sonnet-4-5-20250929`, `claude-haiku-5-5`, `claude-haiku-4-5-20251001`, Bedrock `anthropic.claude-haiku-4-5-20251001-v1:0`, and `<synthetic>` (227 lines, no price, already excluded from counts).
- No cost field anywhere.

## Sources of the prices

| Rank | Source | Result |
|---|---|---|
| a | Claude Code 2.1.331 binary (`~/.local/bin/claude.exe`, searched read-only): baked model catalog `pricing_tiers` + per-model `pricing`, and the cost function (`inputTokens`, `outputTokens`, `promptCacheWriteTokens`, `promptCacheWrite1hTokens`, `promptCacheReadTokens`, `webSearchRequests`, `longPrompt`) | Every model of the transcripts has a tier |
| b | https://platform.claude.com/docs/en/about-claude/pricing (docs.anthropic.com redirects there), fetched 2026-11-27 | Same numbers as (a) for every model of the table |
| c | LiteLLM `model_prices_and_context_window.json` | NOT consulted: (a) and (b) agree, (c) is only a cross-check |

USD per million tokens, input / output / cache read / cache write 5m / cache write 1h (write = 1.25x and 2x the input on every row):

| Model | In | Out | Read | 5m | 1h | Note |
|---|---|---|---|---|---|---|
| Fable 5.2, Mythos 5.2 | 8 | 40 | 0.20 | 10 | 16 | fast: 16 / 80 |
| Fable 5.1, Mythos 5.1 | 10 | 50 | 0.25 | 12.5 | 20 | |
| Fable 5, Mythos 5 | 10 | 50 | 1 | 12.5 | 20 | |
| Opus 5.5 | 4 | 20 | 0.20 | 5 | 8 | fast: 8 / 40 |
| Opus 5, 4.8 | 5 | 25 | 0.50 | 6.25 | 10 | fast: 10 / 50 |
| Opus 4.7, 4.6, 4.5 | 5 | 25 | 0.50 | 6.25 | 10 | |
| Opus 4.1, 4 | 15 | 75 | 1.50 | 18.75 | 30 | |
| Sonnet 5.5 | 2 | 10 | 0.10 | 2.5 | 4 | |
| Sonnet 5 | 2 | 10 | 0.20 | 2.5 | 4 | docs footnote 3: the introductory price is now standard |
| Sonnet 4.6, 4.5, 4 | 3 | 15 | 0.30 | 3.75 | 6 | |
| Haiku 5.5 | 0.10 | 0.50 | 0.01 | 0.125 | 0.20 | prompt over 100 000 tokens: 0.50 / 2.50 / 0.05 / 0.625 / 1 |
| Haiku 4.5 | 1 | 5 | 0.10 | 1.25 | 2 | |

Other rules (docs "Data residency pricing" and the binary): `inference_geo: "us"` multiplies every token price by 1.1; web search is $0.01 per request; Claude Code prices the long-prompt tier per message from input + cache read + cache write.

## Not priced (shown as "No price for ...", never guessed)

- Any id absent from the table (Claude 3.x exist in the binary only, left out; future ids).
- `speed: "fast"` on a model without a fast price (Sonnet, Haiku, Opus 4.7 and older: the binary has Opus 4.6 / 4.7 fast rates the docs do not list, so they are not used), and any `speed` value other than `standard` / `fast`.
- The Bedrock id of the Haiku 4.5 lines is priced with the Anthropic list price of Haiku 4.5. Bedrock is billed by AWS with its own price list (docs: "partner-operated platforms have independent regional pricing"), so those messages are an estimate on a possibly different basis. Said in the tooltip note: "Anthropic list prices ... not your bill".

## Formula and de-duplication

- `usd = (input*in + output*out + cacheRead*read + (cacheCreate - cache1h)*w5m + cache1h*w1h) / 1e6`, times 1.1 for `us`, plus searches x 0.01; 1h share clamped to `[0, cacheCreate]` (the rest is 5m: covers the 16 lines whose split does not add up).
- One API message spans several transcript lines with the same `message.id` and growing `output_tokens`. The tailer already emits ONE usage entry per message id with the field-wise maximum (`normalize.ts recordUsage`); the cost is computed from that entry, never per line. The new price fields (`cacheCreate1h`, `webSearches`, `speed`, `inferenceGeo`) follow the same rule.
- The accumulator prices a message when it leaves its 64-entry update window, so a late update of a recent message is never priced twice (`ModelUsageAccumulator`, `foldedCost`).

## What is shown

- Sub-agent card, row Cost: figure, or "No price for <model>" with the reason, or "Not available" with the reason when its transcript has no usage.
- Header, tooltip of the tokens chip: rows Main session / Sub-agents (n) / Total, and "No price for" when a model is missing. Main = the whole main transcript read incrementally (`backend/sessionCost.ts` through the sub-agent reader), NOT the 64 KiB tail the digest reads: a tail would undercount. Sub-agents = the sum of their own transcripts (separate files).
- A sum that misses unpriced messages reads "at least $x".
- Every cost carries: "Estimate computed by this app: tokens x Anthropic list prices (table of 2026-11-27), not your bill."

## Limits

- First read of a very large main transcript reads it whole once (bounded `maxBytes` per step), then only new bytes. Not measured on a multi-hundred-MB file.
- Fork transcripts: only their own messages count (`fork-context-ref` lines carry no usage), so a fork's cost is not double counted with its source.
- The table is dated: a new model needs a row (the test `prices.test.ts` fails when a row has no source or asOf).
