# herdr-core code analysis: `hc send`, `hc keys`, and terminal control

**Status:** Complete analysis from herdrdev/herdr-core (public, Apache-2.0).
Source: hc 0.1.21 binary, schema, help, docs, and Rust source code paths below.
Date: 2026-11-16. Repository: https://github.com/herdrdev/herdr-core.

## Summary: What is proven, with file:line

### (1) Terminal creation: ConPTY on Windows, libc forkpty on Unix

**Windows ConPTY** - `crates/herdr-core/src/platform/windows.rs:spawn_pty`:
- Loads `conpty\conpty.dll` (shipped with hc) or falls back to `kernel32.dll` functions.
- Calls Win32 directly: `CreatePseudoConsole(cols, rows, input_pipe, output_pipe, ...)` -> HPCON.
- Creates `CreateJobObjectW` (to kill all children at once) and `CreateProcessW` with `EXTENDED_STARTUPINFO_PRESENT` + `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE`.
- Process runs suspended, attached to job, then resumed.
- Resizing: `ResizePseudoConsole(hpc, cols, rows)`.
- Closing: `ClosePseudoConsole(hpc)`.
- **hc owns the HPCON handle exclusively; no external terminal support.**

**Unix (Linux/macOS) forkpty** - `crates/herdr-core/src/platform/unix.rs:spawn_pty`:
- Uses **`libc` crate** directly: `libc::openpty(&mut master, &mut slave, ..., &size)` -> file descriptors.
- Child: `pre_exec` calls `libc::setsid()` + `ioctl(0, TIOCSCTTY)` to own the slave as controlling terminal.
- Master set to O_NONBLOCK; stdin/stdout/stderr -> slave.
- Resizing: `ioctl(TIOCSWINSZ)`.
- **hc owns master fd exclusively; no external terminal support.**

**Holder process** - `crates/herdr-core/src/holder.rs`:
- "owns every PTY, is every program's parent, always reads output."
- Pumps terminal output to the core continuously (~1 MB tail per terminal).
- Runs on separate threads: one reader per terminal, one input thread, no blocking.

### (2) `hc send`: text, paste, draft detection, turn

Source: `crates/herdr-core/src/input.rs:type_in` (text send).

**Flow:**
1. Refuse if program is `blocked` (unless `--force`); check `--if idle|working` status gate.
2. Wait for human to be quiet: default 3 s (config `HC_QUIET_MS`).
3. Build steps: `[paste(text), pause(200 ms), press(Enter)]` (or template override key).
4. For multi-line text: wrap in bracketed-paste mode `ESC[200~ ... ESC[201~` if program enabled it (mode 2004); strip any embedded end marker so paste can't be terminated early.
5. Write bytes to PTY input pipe (ConPTY or Unix master fd).
6. If program reports status: watch for `working` or turn advancement; report `started: true/false/null`.

**Draft detection** - `crates/herdr-core/src/input.rs:Gate`:
- Parses human keyboard events frame-by-frame: printable chars -> count++; backspace/delete -> count--; Enter/Ctrl+C/Ctrl+U -> count = 0 + mark draft ended.
- Understands Kitty-style `...u` sequences, Win32 input events (surrogates, repeat counts), and ignores arrows/mouse/focus.
- Buffered across chunks (fragmented escape sequences handled).
- **Draft timeout: 60 s** from last human key (config `draft_wait`); only the paste-gap (default 200 ms) needed if draft just ended.
- Gate state can be checkpointed and restored (for core handover).

**Multi-line paste:** bracketed-paste when mode 2004 enabled; raw `\n` otherwise (not translated to `\r\n` by hc; ConPTY handles it).
**Turn counter:** returned in `SendResult` after send completes; increments each time status exits `working` (see section 4 below).

### (3) `hc keys`: key name parsing and encoding

Source: `crates/herdr-core/src/keys.rs:encode`.

**Parsing:**
- Lowercase, split on `+`: modifiers are all-but-last, key name is last.
- Modifiers: `shift=1, ctrl/control=2, alt/meta/opt=4, super/cmd=8`; others -> error.
- Key names: `a-z`, `0-9`, punctuation (`` ` `` `[` `]` `,` `=` `-` `.` `'` `;` `/` `\`/`backslash`), named keys (`enter`/`return`, `delete`/`del`, `esc`/`escape`, `space`, `tab`, `backspace`, `home`, `end`, `insert`, arrow keys, `f1-f12`).
- Invalid: `hello`, `hyper+x`, `f13`, `ctrl+` (empty key), empty string -> error.

**Encoding to PTY:**
- Calls `screen.encode_key(code, mods, text, codepoint)` from **`ghostty_vt` crate** (terminal emulation).
- Output depends on terminal modes (set by the program):
  - Default: `\r` for enter, `\x03` for ctrl+c, `\x1bx` for alt+x, `\x1b[A` for up, `\x1bOP` for f1.
  - After `\x1b[?1h` (app cursor): `\x1bOA` for up, `\x1bOD` for left.
  - After `\x1b[>1u` (Kitty protocol): `\x1b[27u` for esc, `\x1b[92;5u` for ctrl+backslash.
- No manual escape-sequence building; terminal modes are authoritative.

**No draft wait:** keys sent after ~3 s quiet pause (no 60 s hold).

### (4) Turn counter and status detection

Source: `crates/herdr-core/src/status.rs:apply`, `reset`.

**Turn counter (`t.turn`):**
- Increments by 1 when root status exits `working` (to any other state: idle, done, blocked, error, or process exit).
- Does not increment on repeated reports or child-record changes.
- Returned in `SendResult` and `KeysResult` for delivery correlation.

**Status detection:**
- Programs emit OSC 7501 escape sequences: `OSC 7501 ; id ; key = value ; ... ST` (or `BEL`).
- No `id` -> replaces root status. `id` present -> replaces/inserts child record in `t.records` (capped at 256).
- Root fields parsed: `state`, `kind`, `msg`, `progress`, `title`, `app`.
- States: `idle`, `working`, `done`, `blocked`, `error` (program-defined strings, kept exactly).
- Blocked kinds: `permission`, `question`, `auth` (only when state==blocked); not inferred by hc.

**Stuck flag in change events:**
- Set when root becomes `blocked` or `error` from a different state.
- Repeated same-state doesn't re-fire.
- Can occur outside a turn change.

**Delivery feedback from `send`:**
- `started`: bool (true if status went working within a few seconds) or null (if program never reports status).
- `status`: program's word at send time (may be null if never reported).
- `turn`: counter at send time (informational handle, not a transcript key).
- `--wait`: blocks until turn advances past this send's turn.

### (5) Blocked detection: "permission" vs. other kinds

Source: `crates/herdr-core/src/input.rs` (blocked refusal), `status.rs` (kind storage).

**Before send:** `input.rs` checks current status. If `status.blocked == true` and `--force` not set, send fails with error `kind: "blocked"`.

**Blocked kinds:** Not inferred by hc; stored as reported by the program in OSC 7501:
- `kind: "permission"` - hc stores exactly what the program reported; no pattern matching.
- `kind: "question"` or `kind: "auth"` - similar; program-defined.
- Seen in M1 research (hc-transport.md:31): "Not logged in" (Claude Code auth dialog) -> `blocked` with `kind: "auth"`.

**No hc-specific permission detection logic.** The program (e.g., Claude Code, a debugger) must emit OSC 7501 with `state:blocked kind:permission`.

### (6) External terminals: not supported

Source: `terminals.rs:create`, `holder.rs` (holder owns PTY), schema (no attach/import methods).

- Every terminal created via `registry.create(NewTerminal{argv, cwd, ...})`.
- `holder.spawn_pty(...)` is the **only** path to a live terminal; hc always initiates spawn.
- No code path exists to import, adopt, or attach to a terminal not created by hc.
- **Conclusion:** ConPTY and Unix PTY are created and held exclusively by hc (or its holder process). External terminals cannot be controlled via `send`/`keys`.

## What is unknown or unconfirmed

- **HPCON handle ownership across processes:** Can another process acquire or interact with an HPCON after hc creates it? Unlikely (Windows process isolation), but not confirmed.
- **Delivery confirmation beyond turn:** hc returns `turn` as an informational handle. No frame IDs or per-keystroke acks. Text marker used for draft detection (not ACK).
- **Connect protocol framing:** `hc connect` offers framed JSON-RPC over stdin. Exact frame format and sequence number handling not analyzed.
- **OSC 7501 parsing edge cases:** Encoding, truncation, buffering rules (e.g., incomplete sequences) not detailed in the source shown.
- **Interrupt/blocked recovery:** Whether `hc send --force` after a block can reliably answer a dialog (vs. race condition) not tested.
- **Signal handling for interrupt:** `hc interrupt` presses esc (if reporting status) or ctrl+c. Whether the stop key can be customized per program unknown.
- **Process attachment on Windows ConPTY:** Can a new process attach to an existing ConPTY, or is HPCON tied to the creating process?

## Delivery confirmation and feedback API

Source: schema from `hc schema` and `crates/herdr-core/src/status.rs`, `holder.rs`.

**Text delivery feedback:**
- Holder continuously reads PTY output (no race; ~1 MB tail per terminal, pumped to core).
- Core parses terminal output for OSC 7501 status reports.
- `SendResult` returned immediately after text written: `{turn, status, started, wait}`.
  - `turn`: counter at send time (incremented on status exits `working`).
  - `status`: program's word at send time (null if never reported).
  - `started`: bool (true if status went `working` within ~3 s) or null (no reporting).
  - `wait`: if `--wait` set, block until turn advances past this send's turn (timeout: config or 180 s).

**Turn as delivery correlation:**
- Not a per-keystroke sequence number; increments only on status exit from `working`.
- Sender can correlate: "send set turn T, my work completes when turn > T or status becomes done/blocked/error".

**Streaming delivery via `attach`:**
- Framed stream on a separate connection (see schema `terminal.attach`).
- Core sends raw PTY bytes (live screen, no buffering by hc).
- Viewer sends keys as DATA frames; signals as RESIZE, FOCUS, etc.
- No per-byte ACK; stream is real-time capture.

## API surface exposed (from schema)

| Call | Returns |
|---|---|
| `terminal.send(terminal, text, --if, --force, --wait, --timeout)` | `{turn, status, started, wait}` |
| `terminal.keys(terminal, keys=[])` | `{turn, status}` |
| `terminal.get(terminal)` | Terminal with status, foreground, turn, records (7501 reports) |
| `terminal.wait(terminal, --output, --children, --timeout)` | `{ended, reason, status, turn, terminal, children[], signal, exit_code}` |
| `terminal.attach(terminal, cols, rows, --observe, --history, --display)` | Framed stream (raw PTY bytes + control frames) |
| `events.subscribe(--terminal, --labels, --children_of)` | Stream of terminal facts + heartbeat |

No built-in method to import or adopt external terminals.

## Additional implementation details (from source inspection)

### Frame format and holder protocol

Source: `crates/herdr-core/src/holder_proto.rs`.

**Frame format between core and holder:**
```
[kind: u8][terminal_id: u32 LE][len: u32 LE][payload: N bytes]
```
Nine-byte header; kind determines payload interpretation.

**Core -> holder commands:** SPAWN, INPUT, RESIZE, SIGNAL, RELEASE, GOODBYE, FOREGROUND, DRAIN.
**Holder -> core responses:** WELCOME, TAIL, OUTPUT, SPAWNED, SPAWN_FAILED, EXITED, BYE, FOREGROUND_IS.

**Holder process architecture:**
- "owns every PTY, is every program's parent, always reads output" (holder.rs doc).
- Per-terminal reader thread: continuously pumps output to core (~1 MB tail kept for screen restoration).
- Per-terminal input thread: serializes INPUT commands to avoid collisions with viewer input.
- Reaper: waits for child exit, reaps status, closes PTY (ConPTY or Unix fd).
- Handover support: newer core build can take over running terminals; old holder drains and exits.

### Human-typing collision avoidance (`Gate` in input.rs)

**Draft tracking:**
- Viewer bytes pass through unchanged.
- Human keystrokes parsed per-chunk: printable chars update count, backspace/delete decrement, Enter/Ctrl+C/Ctrl+U reset to 0.
- Parses: legacy keys, bracketed-paste sequences, CSI-u, Win32 input events (surrogates, repeat counts).
- Ignores: arrow keys, mouse, focus events.
- Fragmented escape sequences buffered across calls.
- Draft timeout: 60 s from last human keystroke (config `draft_wait` in `config.toml`).

**Quiet detection:**
- Viewer input held in buffer while send runs (busy flag set).
- Buffer flushed after send completes.
- Default quiet period: 3 s (config `HC_QUIET_MS`).
- Default pause before Enter: 200 ms (config `paste_gap_ms`).

### Terminal address allocation

Source: `crates/herdr-core/src/terminals.rs:create`.

- Counter incremented per creation (no reuse).
- Addresses rendered as `t{counter}` base 32: `t7`, `t1b`, `t100`, etc.
- Names (separate from addresses): validated, unique among live terminals.
- Labels: free-form key=value, never interpreted by hc.

### External terminal adoption: definitively not supported

Source: `terminals.rs:create`, `exec.rs` (no attach), schema (no adopt/import method).

- **Every** terminal flows through `registry.create(NewTerminal{...})` -> `holder::spawn_pty(...)`.
- No code path imports, adopts, or attaches to externally-created PTYs.
- `exec.rs` runs programs without terminal (piped stdin/stdout).
- `attach.rs` only works on terminals created and managed by this core's holder.
- **Implication:** ConPTY on Windows and Unix PTY are fully enclosed in hc's process and holder; external processes cannot be directed this way.

## Answering the original research questions

### (a) How are terminals created, and who owns the PTY master?

**Windows:** `CreatePseudoConsole(cols, rows, input_handle, output_handle, ...)` -> HPCON; hc's holder process holds the handle and pipes.
**Unix:** `libc::openpty()` -> master fd; hc's holder process owns the master fd.
**Owner:** Holder process (per `holder.rs`), which is hc's privileged child on the same machine. On remote machines (via `hc machine add`), the remote hc's holder owns the PTY.

### (b) How does `hc send` work?

1. Check status (blocked? -> refuse unless `--force`).
2. Wait for human draft to be sent or timeout (60 s).
3. Wait for quiet (3 s default).
4. Build: [paste(text, with bracketed-paste if mode 2004), pause(200 ms), press(Enter)].
5. Write bytes to PTY input pipe (ConPTY or Unix master).
6. Poll status for 3 s to detect if program woke up (`started`).
7. Return turn counter for correlation.

**Multi-line:** Pasted as a single block (bracketed-paste if supported); newlines inside do not submit.

### (c) How does `hc keys` work?

1. Parse key name (modifiers + key).
2. Map to Ghostty key code.
3. Call terminal's `encode_key()` method (respects current terminal modes).
4. Write bytes to PTY input.

**Mode-aware:** Output depends on what modes the program enabled (app-cursor, Kitty protocol, etc.).

### (d) How is blocked status detected?

Programs report `state: "blocked"` via OSC 7501. hc does not infer or detect it; it stores what the program reported.
`kind: "permission"` is a program-defined subtype; hc does not pattern-match on messages.

### (e) What is the turn counter?

Increments each time status exits `working` (to done, idle, blocked, error, or exit).
Returned in `SendResult` and `KeysResult` for delivery correlation.
Initial value: 0 per terminal.

### (f) Can hc control terminals NOT created by hc?

**No.** hc owns the ConPTY or Unix PTY handle exclusively. External terminals cannot be controlled via `send`/`keys`.
The holder process is hc's privileged child; no adoption or attachment of external PTYs is possible.

