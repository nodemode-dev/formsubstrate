# HASHOUT_LOG · cogentics and insight (window) · formsubstrate

Living log for frontend/src/extensions/cogentics/, frontend/src/extensions/console/, frontend/src/ui/dock-panes.ts, frontend/src/io/cogentics.ts and styles/cogentics.css and console.css. Source files stay comment-free; what they would have said lives here.

Current build version: v0.20.0
Last updated: 2026-11-22

### frontend/src/extensions/cogentics/ · panel, ledger, members, insight

- refers-to: frontend/src/extensions/cogentics/panel.ts, ledger.ts, members.ts, rich.ts, insight.ts :: CogenticsPanel, Ledger, MemberRail, InsightPanel
- kind: explainer
- logged: v0.14.0 · 2026-10-31

Ported from substrata `frontend/src/extensions/cogentics/index.ts` (858 lines, MIT, the owner's). substrata drew a full page with three columns (channels, ledger, members). subform has no pages, so the same feature is two right panel sections: Cogentics (a channel select with new and delete, the channel meter, the ledger, the reach line, the composer, and two folded sections for members and channel settings) and Insight (usage and per-turn changes, from substrata `routers/insight.py`; it has no UI of its own in substrata except the Changes link on a run). Kept: run cards with live tool rows, elapsed time and a stalled flag at 30 minutes, continuation rows, group chips, approval cards with an inline diff, exact-ack lines, held deliveries with Release, per-member state and spend, the turn brake, clickable `#N` and `[[ledger]]` references, the composer that puts the default recipient in front of the first typed character, `@` and `#` completion, and the reach line. Rebuilt for the zero-flash rules: each ledger row is built once and patched (text, hidden flags, classes); streaming text goes into one Text node by `data +=`; the final body is painted once with `replaceChildren`, and only when its content changed (`dataset.rich`); member rows, channel options, completion items, usage rows and change rows go through `patchList`; every text slot is reserved (meter and reach lines have fixed height), so nothing shifts when a value arrives. The unread count of other channels shows in the select label. A dropped event stream reconnects by itself and the panel then fetches the channel to catch up (`resync`). Not carried over: substrata's window-wide `substrata:view` event (the right panel's `wb-focus` event refreshes instead) and the `localStorage` token query. A ledger note link opens `.subform/cogentics/<channel>-ledger/<name>.md` in the editor.

### frontend/src/extensions/console/ and ui/dock-panes.ts · Console tab

- refers-to: frontend/src/extensions/console/index.ts, pane.ts :: ConsolePane; frontend/src/ui/dock-panes.ts :: DockPanes; frontend/src/ui/terminal-dock.ts :: openPane
- kind: rationale
- logged: v0.14.0 · 2026-10-31

substrata's console extension was the operator chrome of its window: grouped navigation, a Dashboard of health cards, a Runs page, a Knowledge page and a set of pages (Agents, Chats, Approvals, Documents, Graphs, Triggers, Harnesses, Toolsets, Plugins, MCP Server, Settings, Providers, Workspaces, Health). subform keeps one workbench window, so the console is a tab in the terminal dock next to the terminals. Ported here: Dashboard (cards for Engine, Model, Workspace, Usage over 7 days, Channels and Approvals, plus the recent turns that changed files), Approvals (every pending approval across channels with Allow and Deny), Providers (presets and the provider form, with the key kept in the keyring and a Test connection), and Health (engine version, data folder, git, claude, workspace, model). The pages that sit over engine features owned by other ports (runs, collections, plugins, triggers, harness, MCP servers, graphs) are not in this tab; those features have their own right panel views. The dock owns the tab strip: `dock-panes.ts` is a small registry of pane tabs (a second tab group `ft-dock-ptabs` beside the terminal tabs, so the keyed terminal tab list is untouched) and `TerminalDock.openPane` parks the active terminal (drops its WebGL context and hides its host, as `select` does for the tab it leaves) and shows the pane host. Selecting a terminal tab hides the pane. The pane host is built once on first open and kept hidden, never rebuilt. Dashboard and Approvals refresh every 4 seconds only while the pane is laid out.

### frontend/src/io/cogentics.ts · owner calls

- refers-to: frontend/src/io/cogentics.ts :: cogentics, insight
- kind: rationale
- logged: v0.14.0 · 2026-10-31

All reads use `request`; every call that changes state uses `owner` (window token header, one retry after a 403). The event stream is a plain `EventSource`; it is a read.

### frontend/src/extensions/cogentics/rich.ts · patchFilled

- refers-to: frontend/src/extensions/cogentics/rich.ts :: patchFilled
- kind: removed-code
- logged: v0.15.0 · 2026-11-01

`patchList` (ui/dom.ts) never calls `update` on a node it just created, so every list here that built an empty row in `create` showed blank rows until the next refresh (Insight scopes, files, usage rows, console Health, Recent turns and Approvals, member rows, channel and completion options). `patchFilled` wraps it and runs `update` on the new node before it is inserted, so a row is complete the moment it appears and nothing is painted twice. Found by the Playwright run at 4x throttle: the Health page stayed empty because it is not polled.

### frontend/src/extensions/console/pane.ts and cogentics/insight.ts · tab and range semantics

- refers-to: frontend/src/extensions/console/pane.ts :: ConsolePane; frontend/src/extensions/cogentics/insight.ts :: InsightPanel.paintUsage
- kind: rationale
- logged: v0.15.0 · 2026-11-01

Console tabs carry ids and `aria-controls`, the panels are `tabpanel` with `aria-labelledby`, only the selected tab is in the tab order (`tabindex` 0, others -1) and Arrow keys, Home and End move selection and focus. The 7 and 30 day buttons keep `aria-pressed` in step with `is-on`.
