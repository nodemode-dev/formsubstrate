# Changelog

Versions follow `v*.*.*` with dots. Dates are US Eastern. The newest version is first.

The app was renamed Substrate (family name FormSubstrate, machine name `formsubstrate`) at 0.17.0. The entries below read with the new name throughout; the git history keeps the former one.

## 0.18.1 · 2026-11-22

Release paperwork and checks for the first family build.

- The README's release links open this repository's own Releases page, where FormCompiler drafts each release. Before, they pointed at FormCompiler's releases, which holds none.
- This changelog.
- `docs/RELEASE.md` says what Microsoft and Apple say today: no certificate gives SmartScreen reputation at once, Artifact Signing (formerly Trusted Signing) is the recommended service, and Apple's notarization pages are readable and list what notarization needs.
- The check workflow type-checks the desktop shell on Windows and macOS (`cargo check --locked`).
- Three routes under `/api/presets/graphs` that could never be reached are removed from the runs router. The presets service answers the same addresses as before.

## 0.18.0 · 2026-11-22

Substrate starts once, finds Claude Code wherever a terminal would, and recovers from an engine left running.

- Opened from Finder, the Dock or the Start menu, Substrate finds Claude Code in the usual install folders and on your login shell's PATH. Before, it looked only on the short PATH such a launch gets and reported Claude Code missing. `FORMSUBSTRATE_CLAUDE_BIN` points it at one program.
- Terminals and agent sessions get that same PATH, with the program's own folder first.
- Opening Substrate a second time brings the running window forward. Before, the second start ended with "The Substrate engine failed to start".
- On Windows the engine now leaves when the app is gone, and a start that finds an engine left without its app ends it and carries on.
- The engine starts when it is given no output streams.
- The Web Inspector is in debug builds only.
- The Preferences switch "Check for updates at start" is removed; nothing read it. Updates come through FormPortal.

## 0.17.1 · 2026-11-22

Fixes for the first family build.

- A check workflow (`ci.yml`) builds and type-checks the window, installs the pinned engine on Python 3.13, runs its self check and compile, and checks the shell scripts' syntax.
- The Windows engine freeze passes the skill presets and the recipe presets as two `--add-data` arguments.
- `build_app.bat` stops with a message and exit code 1 when the engine or the window install fails.
- The Windows install from source has its window step, and the engine install prefers the Python on the path.
- The macOS engine installs the same pinned versions as `requirements.txt`.
- The window install runs `npm ci`, so it installs exactly the tracked `package-lock.json`.
- The macOS bundle maps the engine folder once.

## 0.17.0 · 2026-11-21

The app is Substrate.

- The application is Substrate, the family name is FormSubstrate, and every name a program reads is `formsubstrate`: the repository, the launcher, the packages, the bundle id `ai.nodemode.formsubstrate`, `FORMSUBSTRATE_*` variables, data folders, the MCP server and the skills.
- State from the former name is carried over once: the data folder, keychain entries, window storage, workspace folders and snapshot refs.
- Variables and webhook headers under the former name are still accepted, with a notice in the log.
