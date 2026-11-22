# HASHOUT and NOTICE

## HASHOUT entries

Source files carry no comments. Each folder that holds code has a HASHOUT_LOG.md; add entries at the end, by an edit whose old text is the log's current last lines.

```text
### [repo-relative path] · [symbol]

- refers-to: [repo-relative path] :: [symbol]
- kind: explainer | rationale | warning-context | removed-code | todo
- logged: [version from your brief] · [date from your brief]

[Text: why, what is non-obvious, what must not be changed.]
```

Kinds: explainer says what a thing does; rationale says why it is this way; warning-context says what breaks if changed; removed-code keeps what was deleted and why; todo records what is left.

Log locations (each is `[folder]/HASHOUT_LOG.md`): `frontend`, `frontend/src/extensions`, `frontend/src/extensions/sessions`, `frontend/src/ui` with `editor`, `graph`, `palette`, `review`, `preview`, `frontend/src/io`, `backend`, `backend/app/core`, `backend/app/routers`, `backend/app/services`, `backend/app/templates` (and its `common`, `python`, `rust` subfolders), `src-tauri`. The `logged:` value is the version the brief names for the build in progress (v0.14.0 for the turn after v0.13.0), with the date the brief gives. A new code folder gets its own log, created whole with a header: title, current build version, last updated. Entries about ported code name the formvis or substrata source file.

## NOTICE.md

Sections: Ported code (source, licence, what came over), Engine (Python packages), Freeze tool (build only), Window (TypeScript packages), Desktop shell (Rust, with a transitive crates subsection), Found on the system (never bundled) and Art. A row needs name, version, licence, and where it runs. Add the row before the dependency is used, after checking the registry for the version and licence. Ported code extends the Ported code row for its source repository.
