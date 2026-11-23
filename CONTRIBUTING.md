# Contributing to Substrate

Thank you for helping. Substrate aims to be a free code editor for working with
agents: each agent session in its own git worktree, every change reviewed before it is
committed, and everything kept on your own computer. It gets there through real use
and real contributions.

## Where to start

- **Use it and report what goes wrong.** A clear bug report, with steps, the version
  and your platform, is one of the most useful things you can give.
- **Look at the open issues.** Comment on one before starting larger work, so nobody
  builds the same thing twice.
- **Translations** are welcome: Substrate ships in thirty interface languages, with
  the tables in `frontend/src/ui/i18n`. `./formsubstrate i18n` says what a table is
  missing.

## Setting up

Clone the repository and run `./formsubstrate install`, then `./formsubstrate` (or
`formsubstrate.bat install` and `formsubstrate.bat` on Windows). The first installs
what the engine and the window need; the second starts both. `./formsubstrate help`
lists every command, `./formsubstrate doctor` checks the toolchain, and the README's
"Run it from source" section has the details and the requirements.

The code lives in:

| Folder | What is there |
| --- | --- |
| `backend/app` | the engine (Python, FastAPI): files, git, sessions, terminals, runs, language servers, the debugger, MCP |
| `backend/presets` | the plugins, skills and graphs that ship with the app |
| `frontend/src` | the window (TypeScript, Vite, CodeMirror): the editor, the panels and the UI |
| `src-tauri` | the desktop shell (Rust, Tauri) |
| `setup` | install, boot, doctor, freeze and agent scripts |
| `docs` | the user guide, the MCP guide and the maintainers' release notes |
| `.claude/skills` | the skill packs for agents working on or with Substrate |

[`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md) hold the rules of the codebase,
for people as much as for agents. Read them before a first change.

## Before you open a pull request

Run the same checks CI runs:

```sh
(cd frontend && npm ci --no-fund && npm run build)
./formsubstrate i18n
python backend/formsubstrate_engine.py --selfcheck
./formsubstrate agents sync --check
python -m compileall -q backend/app backend/presets backend/formsubstrate_engine.py backend/formsubstrate_mcp.py backend/formsubstrate_ptyhost.py
(cd src-tauri && cargo check --locked)
```

The engine checks need `backend/requirements.txt`. CI also checks the shell scripts
with `bash -n`, and checks the desktop shell on Windows and macOS.

- Keep each pull request to one change, and say in it what you ran and what you
  could not run.
- Write commit subjects the way the history does, in Conventional Commits:
  `feat(editor): ...`, `fix(git): ...`, `docs(...)`. Leave the version alone; a
  maintainer bumps it when releasing.
- Interface text goes through the translation tables: every string a person reads is
  wrapped in `t()`, and `./formsubstrate i18n` fails while any table lacks a key.
- After changing the MCP tools, run `./formsubstrate agents sync`;
  `./formsubstrate agents sync --check` fails while the skill's references drift.
- Every route that changes something needs the window key, and anything a project
  can make Substrate run waits for workspace trust. [SECURITY.md](SECURITY.md) sets
  out the model; a change that widens it is discussed in an issue first.
- Code carries no comments: the reason for a change goes in the `HASHOUT_LOG.md`
  beside the file. Markdown has no em dash and no text has an emoji.
- Every new dependency, binary, font or data file gets a row in `NOTICE.md` before
  it is used.
- Agent programs, language servers and debuggers are found on the person's
  computer. Substrate does not bundle, download or install them.

## Maintainers

Substrate is maintained by:

- the [nodemode-dev](https://github.com/nodemode-dev) organisation on GitHub
- [@nodemode-ai](https://github.com/nodemode-ai)
- [@gbarnai](https://github.com/gbarnai)

Reach them through issues and pull requests.

## How changes land

Only a maintainer pushes to `main`. Everyone else forks the repository and opens a pull request into `main`. A pull request merges when all four checks pass on an up-to-date branch and a maintainer has approved it after its last push.

## Releases

A release is a version, and only a maintainer makes one: after the version is bumped on
`main`, a maintainer cuts a `compile_vX.Y.Z` branch, and formcompiler
(`nodemode-dev/formcompiler`) builds every platform and publishes them together. No
push from a contributor starts a release. See [docs/RELEASE.md](docs/RELEASE.md).

## Licensing

Substrate is licensed under the GNU General Public License v3.0 only
([LICENSE](LICENSE), SPDX `GPL-3.0-only`). By contributing, you agree that your
contribution is licensed under the same terms. Only add code you have the right to
contribute, and name any third-party code and its licence in the pull request.

## Patents and other people's IP

This is engineering diligence, not legal advice. The maintainers hold these lines with counsel; contributors do not decide them.

- Patents: do not add a feature, or a dependency that provides one, that reproduces a method you know to be patented. If you are unsure, open an issue that describes what the feature does, not which patent it resembles. Patent numbers stay out of code, commits, logs and changelogs.
- Trademarks: other vendors' product and feature names appear only to name a program Substrate starts, a file format or compatibility ("reads `.vscode/tasks.json`", "for use with"). No command, menu, panel or agent tool takes another product's feature name. Describe what the feature does.
- Copyright: never copy another product's help, tooltip, dialog or documentation text (link to it instead); never trace or import vendor icons; never bundle vendor themes, snippets, sample files or fonts.
- Licences: every new dependency gets a row in `NOTICE.md` before it is used. AGPL nowhere, LGPL dynamically linked and replaceable, MPL files unedited. Anything whose licence is not compatible with GPL-3.0-only stays out. CC BY credited, CC BY-SA only unmodified, CC NC and ND never.

## Conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Security
problems go through [SECURITY.md](SECURITY.md), never a public issue.
