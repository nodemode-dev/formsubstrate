---
name: gate-cards
description: Answer Substrate's existing-slot gate cards. Covers when an agent's write waits, the Use, Adapt and Write new anyway buttons, the bar in an interactive terminal tab, skipped gates in review, the Slots tab, and what an agent sees from its side.
---

# gate-cards

## Purpose

Help the person answer a waiting gate quickly and correctly, and help an agent understand why its write is waiting.

## When a gate fires

Before a session's Write, Edit, MultiEdit or Bash writes a file, a hook asks formslot whether something like it already exists. Bash commands are read for write forms (redirections, `cp`, `mv`, `tee`, `sed -i`, `curl -o`, `rsync`, archive extraction and more) and never run by the check. If a slot matches, the write waits and a card appears in the window. Graph runs that edit files pass the same gate.

## Answer it

- Use: tell the agent to reuse the existing slot.
- Adapt: tell the agent to adapt the existing slot instead of writing a parallel copy.
- Write new anyway: let the write go ahead.

Where the card shows:

- For an interactive session, as a bar at the bottom of that terminal's tab: "Substrate is waiting for your answer", with the slot name and the three buttons. The tab carries a badge; `+2` means two more wait.
- `Alt+Ctrl+G` (`Option+Cmd+G` on macOS), Answer Existing Slot Prompt, jumps to the first open card.

Only the window can answer. The agent cannot answer its own gate. If the agent retries the same write after Use or Adapt, the person is asked again.

Choosing: Use when the slot already does the job; Adapt when it nearly does and should be extended in place; Write new anyway only when the new code is meant to differ, because a parallel copy is what the gate exists to prevent.

## Skipped gates and Bash overlaps

- If the check could not run (the engine did not answer, or the hook failed), the write is allowed rather than stuck. The review pane marks the file "Gate skipped" with the reason and shows a count such as "1 gate skipped" in its header. Read those files by hand.
- A Bash write that overlapped a slot after the fact is marked "Written by Bash, overlaps slot".
- An agent sees the same notes with the MCP tool `gate_notes` (its own session with the gate token; the window must name the session).

## See what covers a file

- The right panel's Slots tab shows which slots or code units cover the open file, or "No slot or unit covers this file".
- The formslot section on the left searches slots.
- An agent calls `formslot_slot` with a path before reworking a file.

## Gate

The card is answered from the window, and any "Gate skipped" file is named to the person for a manual look.

## Owned resources

None.
