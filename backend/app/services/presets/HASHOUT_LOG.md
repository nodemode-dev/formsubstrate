# HASHOUT log · backend/app/services/presets · formsubstrate

Entries for the unified presets service. Newest at the end.

Current build version: v0.20.0
Last updated: 2026-11-22

### backend/app/services/presets/store.py · four groups, one service

- refers-to: backend/app/services/presets/store.py :: listing, read, install; backend/app/routers/presets.py :: router
- kind: rationale
- logged: v0.16.0 · 2026-10-30

Ported from substrata's `backend/app/routers/presets.py` (MIT, the owner's) and its `backend/presets/skills/*` and `plugin_catalog/{http_connector,web_search}.py`. substrata served graph presets, skill presets and a plugin catalog; subform served graph presets twice (`routers/graphs.py` over `app/templates/graphs`, `routers/runs.py` over `backend/presets/graphs`) and had no catalog or skill presets. One service now lists four groups: graphs (the two folders merged, `backend/presets/graphs` winning, which adds foreach-review to the list), recipes (a thin view of `services/recipes/store.py`, which keeps its own preset folder and install), plugins (`backend/presets/plugins/*.py`) and skills (`backend/presets/skills/<name>/SKILL.md`). The same folders are bundled by `setup/freeze_backend` under `presets/`. Plugin metadata for listing is read with `ast.literal_eval` of the `PLUGIN` dict; a preset is never imported or run to be listed.

### backend/app/services/presets/store.py · install rules

- refers-to: backend/app/services/presets/store.py :: install, _target; backend/app/routers/presets.py :: install
- kind: warning-context
- logged: v0.16.0 · 2026-10-30

Every install is a window-token route. A plugin preset is code that runs in the engine, so it installs only with `trust=true` (the window sends it when the workspace is trusted in Preferences) and lands in `.subform/plugins/<name>.py`, where the existing loader treats it like any workspace plugin; the router then reloads plugins with trust so its tools appear. Without trust the answer is 403 and nothing is written. Skill presets copy into `.claude/skills/<name>/` (SKILL.md and any sibling files, at most 16, 512 KB each). Destinations go through `workspace_root.resolve(write=True, follow=False)` and a walk that refuses any symbolic link; an existing file answers 409 unless `replace=true`. Graph installs keep the old 409 on an existing name. Dropped from substrata: install-from-URL (fetches and runs arbitrary code), plugin disable, enable and uninstall (`/api/plugins` already has enable and settings), and the navi_notify plugin (a Navi overlay on a fixed port, not a Form family tool). Kept: http-connector (secret bearer token through the keyring settings path) and web-search, ported to subform's `Host` and `Tool`; skills code-review and surgical-edits got front matter so the skill scanner shows their names.

### backend/app/services/presets/store.py · _write; backend/presets/plugins/http_connector.py · call (review fixes)

- refers-to: backend/app/services/presets/store.py :: _write, install; backend/presets/plugins/http_connector.py :: _origin, call
- kind: warning-context
- logged: v0.16.0 · 2026-11-01

`_write` used a fixed `<target>.tmp` name opened with `open`, which follows a symbolic link, so a cloned repository that committed `.subform/graphs/<name>.json.tmp` as a link could have the install write through it. The temp file is now made by `tempfile.mkstemp` in the target folder (a new name, created exclusively), set to 0644, replaced over the target and removed on any failure. A preset graph with no `doc` object is a 404 instead of a 500. The http connector sent the bearer token and the extra headers to any absolute URL the agent passed; they now go only to the base URL's origin (scheme, host and port), as unredirected headers, so a redirect to another host does not carry them either.
