# HASHOUT_LOG · agent sessions in the window · formsubstrate

Living log for the sessions side of Phase F5 in the window: extensions/sessions (Sessions and Skills panels, agent-new and agent-sessions), io/sessions.ts, ui/chat-pane.ts, ui/new-session.ts, ui/desktop-notify.ts and styles/sessions.css. Source files stay comment-free; what they would have said lives here. The shell-wide log is frontend/HASHOUT_LOG.md.

Current build version: v0.20.0
Last updated: 2026-11-22

### frontend/src/app.ts · terminal hook

- refers-to: frontend/src/app.ts :: startApp; frontend/src/ui/terminal-dock.ts :: TerminalDock.reveal
- kind: rationale
- logged: v0.5.0 · 2026-10-30

The panel's Open terminal action calls the hook set in app.ts, which calls `TerminalDock.reveal(id)`: it opens the dock, and when the id is not among its tabs it lists the engine's terminals again and adopts the new ones. The dock otherwise adopts engine terminals once, at first open, and a session started later would not have a tab.

### frontend/src/io/sessions.ts · SessionsClient

- refers-to: frontend/src/io/sessions.ts :: SessionsClient
- kind: rationale
- logged: v0.5.0 · 2026-10-30

One singleton (`sessionsClient`) owns the session list as a Map keyed by id and emits four events: sessions (the sorted list), notice, line and connection. The list is sorted by `updated` descending, ties by id; timestamps from the engine are ISO strings (its `_now()` is seconds-resolution UTC) and `stamp()` also accepts epoch seconds or milliseconds. The EventSource reconnect is hand written, not the browser's own: on `error` the source is closed and reopened after 1 s, doubling to 10 s, and every successful `open` resets the delay and refetches `GET /api/sessions`, so anything missed while disconnected is repaired. A `session` event is merged into the Map by id (it is a whole Session, not a patch). After create, resume, stop and remove the reply is merged locally as well, so the panel does not wait for the SSE echo; the echo merges to the same values and changes nothing visible.

### frontend/src/io/sessions.ts · transcript

- refers-to: frontend/src/io/sessions.ts :: SessionsClient.addLine
- kind: rationale
- logged: v0.5.0 · 2026-10-30

The contract gives the window no per-message stream, only `lastMessage` on each Session and notice events. The client therefore builds the transcript the pane shows: a line is appended whenever `lastMessage` changes, a state line when the state changes (only for events, not for the refetch after a reconnect), and a notice line for each notice unless it repeats the last line verbatim (the engine's notices usually carry the same text as the lastMessage that caused them). At most 300 lines per session are kept. This is lossy by design this phase: two messages arriving between two session events show only the later one. A real stream (a per-session SSE or websocket of the stream-json lines) is a later step; ChatPane needs no change for it, it only needs `line` events.

### frontend/src/io/sessions.ts · homeList

- refers-to: frontend/src/ui/home.ts :: HomeSession
- kind: warning-context
- logged: v0.5.0 · 2026-10-30

Home knows three states. Failed and stopped sessions are given to it as `done` with the real state written before the elapsed time ("failed 3m 19s"). Extend Home's groups if they should have their own sections.

### frontend/src/extensions/sessions/index.ts · rows

- refers-to: frontend/src/extensions/sessions/index.ts :: SessionsPanel
- kind: rationale
- logged: v0.5.0 · 2026-10-30

The list is one flat keyed list, group header rows (key g:state) and session rows (key s:id), in the order needs-input, working, done, failed, stopped, empty groups left out. It is flat, not one container per group, so that a state change moves the same row node with insertBefore rather than removing it from one group container and building a new one in another: the dot, the title text and the selected class are patched in place on the node that already exists (checked with a MutationObserver: the nodes recorded before the state changes are the same objects, still connected, afterwards). Rows have a fixed height (86 px) and the action row always takes its 24 px, so showing or hiding an action button changes no box. Elapsed time is patched by a 1 s timer that touches only rows in a live state and only when the text differs. Painting is coalesced into one requestAnimationFrame.

Layout shift that remains is inherent to the data: when a state change makes a new group appear (a header and its row inserted), the groups below it move down by that height. Panel open, text, dot, last message and action visibility changes shift nothing.

### frontend/src/extensions/sessions/index.ts · actions

- refers-to: frontend/src/extensions/sessions/index.ts :: SessionsPanel.run
- kind: rationale
- logged: v0.5.0 · 2026-10-30

Open terminal shows for a live (working or needs-input) session with a terminalId, and only once a hook is set through setTerminalHook, so the button never exists without something to call. Resume shows for a session that is not live and has a claudeSessionId. Stop shows for live ones. Remove worktree shows for the rest and asks confirmAction first; the engine's 409 (uncommitted changes) is answered with a second confirm and a retry with force=1. While a request is out the row's buttons are disabled; errors go to the status bar through shell.setStatus(.., 'error').

### frontend/src/extensions/sessions/index.ts · commands and notices

- refers-to: frontend/src/app.ts :: startApp
- kind: rationale
- logged: v0.5.0 · 2026-10-30

The extension registers agent-new (Shift+Mod+A, enabled only with a workspace open) and agent-sessions itself, as the search extension registers its own command, because the Commands registry refuses a duplicate id and the extension owns the dialog. The two soon() placeholders in app.ts are therefore removed. Every notice event raises a toast (error kind for failed) with an Open action that reveals the panel and selects the session, and a desktop notification when the window is not focused. The Sessions extension is `required: true`: its client also feeds Home and the status bar, so it must not be switchable off in Preferences.

The offline label appears only after 2.5 s without a connection, so the short gap between an SSE reconnect and its next open does not flash it.

### frontend/src/ui/chat-pane.ts · ChatPane

- refers-to: /home/claude/ref/formvis/frontend/src/ui/chat-pane.ts :: ChatPane
- kind: explainer
- logged: v0.5.0 · 2026-10-30

Ported in idea from formvis's ChatPane (Apache-2.0, owner's): the log role, the append-only message list, the stick-to-bottom scroll rule (follow only when within 48 px of the end) and the empty-state note. Everything that talked to the formvis Claude process (permission mode select, tool chips, permission cards, install hint, handoff, websocket) is dropped: a headless session here is read-only. It keeps one stream node per session, created on first selection and only hidden or shown afterwards, so switching sessions rebuilds nothing and a line already appended is never touched again; the first line node is the same object after later lines arrive. A stream is dropped when its session disappears. Prompts and labels were rewritten for a code workbench (state lines, "Interactive session: the conversation is in its terminal.").

### frontend/src/ui/new-session.ts · NewSessionDialog

- refers-to: frontend/src/ui/dialogs.ts :: Dialog
- kind: rationale
- logged: v0.5.0 · 2026-10-30

Built once on Dialog (fields title, mode, prompt, base branch). Prompt is always present and is disabled and dimmed (is-off) in interactive mode instead of being hidden, so the dialog does not change height when the mode changes. The POST body is {title, mode} plus prompt only for headless and base only when not empty. The base field is prefilled with the workspace branch each time the dialog opens (the engine default is HEAD, which is the same commit when the workspace is on that branch); clearing it sends no base. Start session is disabled until the title (and, for headless, the prompt) is filled. An engine error shows under the fields in a line whose height is reserved.

### frontend/src/ui/desktop-notify.ts · desktopNotify

- refers-to: src-tauri/capabilities/default.json :: notification:default
- kind: rationale
- logged: v0.5.0 · 2026-10-30

In the Tauri app the three plugin commands (is_permission_granted, request_permission, notify) are invoked through `window.__TAURI_INTERNALS__.invoke`, which is what @tauri-apps/plugin-notification wraps, so no npm dependency is added. The page is served from http://127.0.0.1 as a remote origin, so the capability `notification:default` in default.json is what authorises these calls. A notification is sent only when `document.hasFocus()` is false or the document is hidden. Outside Tauri the web Notification API is used if permission is already granted; permission is requested from the user's click on Start session (primeDesktopNotifications), since browsers ignore a request that is not from a gesture.

### frontend/src/extensions/sessions/index.ts · SkillsPanel

- refers-to: frontend/src/extensions/sessions/index.ts :: SkillsPanel
- kind: rationale
- logged: v0.5.0 · 2026-10-30

A read-only list from GET /api/skills: name (mono), a source badge (project in the accent, user muted), the description clamped to two lines, the SKILL.md path as the row tooltip. Keyed `source:name`. A newer request wins over an older one by a counter. It loads once at start, on panel focus, on the refresh button and when the workspace changes (project skills come from the workspace). The bottom note says installs go through formskills; there is no install button.

### frontend/src/styles/sessions.css · module

- refers-to: frontend/src/styles/sessions.css :: .cv-ss
- kind: explainer
- logged: v0.5.0 · 2026-10-30

Rules for .cv-ss-* (sessions panel), .cv-chat-* (transcript), .cv-sk-* (skills) and .cv-ns-* (new session dialog), all on tokens. State dot colours: needs-input --warn, working --accent-color, done --ok, failed --danger, stopped --text-muted. The transcript region is a fixed 200 px (custom property --ss-chat-h on .cv-ss); a draggable splitter is not built this phase.

### frontend/src/ui/icons.ts · stop

- refers-to: frontend/src/ui/icons.ts :: ICONS.stop
- kind: explainer
- logged: v0.5.0 · 2026-10-30

New filled rounded square for the Stop action. The Sessions rail icon is the existing agent icon and the Skills rail icon the existing pfPlugins icon.
