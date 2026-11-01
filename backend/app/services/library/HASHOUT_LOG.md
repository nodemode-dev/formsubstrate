# HASHOUT_LOG · backend/app/services/library and its routers · subform

Living log for the substrata library port: collections, tools, plugins, MCP servers and the activity feed. Source files stay comment-free; what they would have said lives here. Routers: routers/collections.py, tools.py (also `/activity`), plugins.py, mcp_servers.py.

Current build version: v0.14.0
Last updated: 2026-10-31

### backend/app/services/library · port map

- refers-to: backend/app/services/library/collections.py :: search, add_doc; backend/app/routers/collections.py :: router
- kind: explainer
- logged: v0.14.0 · 2026-10-31

Ported from substrata (MIT, owner's): routers/collections.py (JSONL store, MMR retrieval) to services/library/collections.py plus routers/collections.py; core/scoring.py (lexical scorer only) to services/library/scoring.py; core/plugins.py to services/library/plugins.py; core/mcp_client.py to services/library/mcp_client.py; routers/tools.py, plugins.py and mcp_servers.py to the routers of the same names; core/substrate.py's Tool and ToolRegistry to services/library/registry.py; core/meta_tools.py's search_capabilities to services/library/builtin.py. The workspace folder `.substrata/` is `.subform/`. Left out: the embedding provider (config in the home folder, secrets in a file), the LLM provider config routes (the Studio port owns models), routers/extensions.py (installs JavaScript into the window from a zip or git url).

### backend/app/services/library/collections.py · names

- refers-to: backend/app/services/library/paths.py :: clean_name
- kind: warning-context
- logged: v0.14.0 · 2026-10-31

substrata used the collection name straight in a path. A name is now 1 to 64 characters of lowercase letters, digits, dash and underscore, so `../x` is a 400. Limits: 100,000 characters a document, 8,000 bytes of metadata, 5,000 documents a collection. Reads are open to LocalGuard; adding and deleting need the window token.

### backend/app/services/library/plugins.py · trust

- refers-to: backend/app/services/library/plugins.py :: reload, listing
- kind: rationale
- logged: v0.14.0 · 2026-10-31

A plugin is Python that runs inside the engine. Bundled plugins (services/library/bundled) always load. Plugins found in `<workspace>/.subform/plugins` are listed as held and are imported only by `POST /api/plugins/reload?trust=true`, `enabled` and `settings` with the window token, where the window sends `trust=true` only for a trusted workspace (the same rule as language servers). `GET /api/plugins` never imports a workspace file. A disabled plugin is not imported at all; the disabled names live in the data folder (library/state.json). Plugin `register(host, settings)`: `host.tools.register(Tool(...))` with `Tool` from services/library/registry.py (a substrata plugin changes only its import). The suggested-triggers field of substrata's connector spec is dropped: subform has no trigger engine. A frozen build must add services/library/bundled to the PyInstaller data (todo for setup/freeze_backend).

### backend/app/services/library/plugins.py · settings

- refers-to: backend/app/services/library/plugins.py :: save_settings, settings_view
- kind: rationale
- logged: v0.14.0 · 2026-10-31

Values of settings declared `secret` go to the system keyring (`plugin.<plugin>.<setting>`) and are never returned: the window gets `secret_set`. An empty secret field keeps the stored value. Other values live in `<workspace>/.subform/plugin_settings.json`. Without a keyring the save is a 503 that says so.

### backend/app/services/library/mcp_client.py · storage and spawn

- refers-to: backend/app/services/library/mcp_client.py :: McpClientManager, _StdioSession
- kind: rationale
- logged: v0.14.0 · 2026-10-31

User servers are stored in the data folder (library/mcp-servers.json), not in the workspace, so a repository cannot plant a server that runs a command. Header values (tokens) go to the keyring as one JSON secret per server; the file holds only the header names. Adding, enabling, refreshing and removing need the window token. A stdio server is spawned with the engine's environment minus every `SUBFORM_*` variable, in the workspace folder or the home folder. Servers connect on first use of the library routes (no lifespan hook), and an atexit handler terminates stdio children. Mounted tools are `mcp_<server>__<tool>` with source `mcp:<server>`. `session_entries()` returns the user servers flagged for sessions as `mcp.json` entries (`user-<name>`): stdio ones as command and args, http ones without headers as a url; one with secret headers is skipped with a note because the session file is plain text on disk. services/sessions.py `_mcp_config` should merge them (todo: that file is outside this unit).

### backend/app/routers/mcp_servers.py · builtin rows

- refers-to: backend/app/routers/mcp_servers.py :: builtin_rows
- kind: explainer
- logged: v0.14.0 · 2026-10-31

`GET /api/mcp-servers` answers `servers` (yours) and `builtin`: subform's own server at `/mcp`, the launcher, formMCP and formslot, found the way `_mcp_config` finds them but without running `formslot --help`. Builtin rows are read-only in the window.

### backend/app/services/library/activity.py · feed

- refers-to: backend/app/services/library/activity.py :: emit, since
- kind: explainer
- logged: v0.14.0 · 2026-10-31

A 500-event ring with a sequence number. `GET /api/activity?since=N` answers events after N and `last`; the window polls every 2 s while the panel is visible. Engine code reports with `activity.emit(label, phase, note, source)`; phases are enter, exit, tool, output, delta, skills, loop, yielded, halt, error, compaction. The Studio runner can call `emit` directly, or the window can post to `POST /api/activity` (window token), or dispatch the `subform:run-event` window event, which the panel also takes live.
