# Answering a permission dialog with `hc keys`: measured keys and live test

Date 2026-11-21. hc 0.1.21, Claude Code 2.1.330 (Haiku 4.5, Bedrock), Windows 10. Marks: [M] measured today, UNKNOWN.
Context: `permission-prompt-remote-answer.md` (mechanism), decision 61. Code: `packages/agent-manager-core/src/reply/HcApproval.ts`, `hcTerminals.ts`; module `backend/hcPermissionRoutes.ts`, UI `owned/HcPermissionCard.tsx`.

## Key sequences [M]

| Decision | Keys | Result |
|---|---|---|
| Allow once | `enter` | Dialog starts on `1. Yes`; command ran, file created, status working then done |
| Deny | `esc` | Command not run, transcript shows `Interrupted - What should Claude do instead?`, status idle (the turn stops) |
| Deny, alternative | `down down enter` (selects `3. No`) | Identical to `esc` (same screen, same status, no file). `esc` is used: it does not depend on the number of options |
| Always allow | never typed | Option 2 writes a standing rule into the project settings |

Not tested: digit keys (`1`, `3`), `shift+tab`, a person typing at the same moment.

## The dialog [M]

`hc get --json` while blocked: `status = {app:"claude-code", kind:"permission", msg:"approve Bash: touch am-allow.txt", state:"blocked"}`, plus `status_ms` (moment the status changed) and `turn`.
`hc read --json -- <t>` returns `{complete, how:"screen", text}`. Layout of `text` (box characters: solid rule U+2500, dashed rule U+254C, cursor U+276F):

```
<solid rule>
 Bash command
 Create am-allow.txt file          (description)
<dashed rule>
 touch am-allow.txt                (command)
<dashed rule>
 Do you want to proceed?
 <cursor> 1. Yes
   2. Yes, and always allow access to <dir> from this project
   3. No

 Esc to cancel . Tab to amend
```

## Findings that shaped the code

| Finding | Consequence |
|---|---|
| The workspace trust dialog is also `blocked` / kind `permission` (`msg: "trust this folder"`) and its default is `No, exit` | `enter` there exits claude. The status alone is not enough: the screen is parsed and a dialog is answered only when the cursor is on `1. Yes` and the last option is `No` |
| `hc keys` does not refuse a blocked terminal and does not check anything | Re-read `hc get`, `hc read`, `hc get` right before the keys; refuse when `status_ms` differs |
| `status_ms` changes with each new dialog | Prompt id = hash(terminal, `status_ms`, `turn`, `msg`, dialog text): the same command asked twice gets two ids |
| `hc keys --json` prints the status found when the keys were sent (`{"status":"blocked","turn":4}`) | Not used as proof of effect; the effect is read from `hc get` afterwards |
| A new terminal in an untrusted folder blocks `HcLauncher` on the trust dialog (`session-not-registered` after the wait) | The error already names `hc read`; here the dialog was answered by `hc keys down enter` (trust is `2.`, second option) |
| `hc ls` + one `hc get` per Claude terminal is about 20 processes | Polling uses a 15 s snapshot for the terminal lookup, then reads only the one terminal |
| Registry pid = `foreground.pid` also holds for a terminal started by `HcLauncher` [M] | Same mapping as the hc transport (`hcTerminals.ts`) |

## Live test (4 Haiku prompts max, 3 used)

Terminal `t21` named `am-hckeys`, started through `HcLauncher` (first live run) in `%TEMP%\am-hckeys\proj`: terminal started, trust dialog blocked the launch (45 s wait, `session-not-registered`), answered with `hc keys down enter`, session registered idle. Prompts sent with the hc transport (`hc send`).

| # | Prompt | Answered with | Outcome |
|---|---|---|---|
| 1 | touch am-allow.txt | `HcApproval.decide(allow)`: `enter` | `effect: closed`, status working then done, file exists; audit: intent `sending`, result `sent: closed` |
| 2 | touch am-deny.txt | `HcApproval.decide(deny)`: `esc` | `effect: closed`, status idle, file absent, `Interrupted` |
| 3 | touch am-deny3.txt | raw `hc keys down down enter` | Same as 2, file absent |

Prompt id of #1: `6c5dc04d143654c5`, status message `approve Bash: touch am-allow.txt`. The audit line holds the command truncated to 80 characters and a hash of the dialog text. Cleanup: `hc kill am-hckeys`, `hc rm am-hckeys` (only this terminal); `hc ls` lists none left.

## UNKNOWN

- Dialog of a hook `ask` (2026-11-22): a user report says there is text between the closing dashed rule and the question. Not captured (terminal t15 no longer showed it, no blocked terminal to read); the hook reason is a 4 to 5 row text (`ask-messages.js`: title, Category, Duration, Reason). The parser accepts such text as a plain-text `notice` under bounds (no box character, option, question or footer line, 12 lines, 2000 characters) and refuses the rest. To verify on the next real one: `hc read --json -- <t>` while blocked, read only.
- Other dialog layouts (file edit, MCP tool, plan approval): only Bash was measured; any other layout that does not match the parser is refused with a visible reason.
- Behaviour with a person typing in the terminal at the same moment (window of a few tens of milliseconds between the last `hc get` and the keys).
- macOS and Linux hosts; hc versions other than 0.1.21.
- Whether `Esc` ends the turn in every Claude Code version (here it does: no tool result is returned and the agent waits for instructions).
