# home-ai

Python library + CLI + MCP server for controlling Xiaomi Mijia (米家) smart-home
devices by logging into the Mijia account and driving the MiIo/MIoT APIs. All
user-facing strings and docstrings are in Chinese. GPL-3.0. A maintained fork of
[Do1e/mijia-api](https://github.com/Do1e/mijia-api): package/CLI renamed to
`home-ai`/`home_ai`, version reset to 0.1.0; the public class names
`mijiaAPI`/`mijiaDevice`, the auth path `~/.config/mijia-api/auth.json`, and the
`MIJIA_LOG_LEVEL` env var are intentionally kept unchanged.

## Layout

- `home_ai/` — the package (single Python package, source in `apis.py`,
  `devices.py`, `mcp_server.py`, `miutils.py`, `errors.py`, `__main__.py`
  (CLI), `version.py`).
- `home_ai/version.py` — single source of truth for the version; pyproject
  reads it dynamically. Bump it here AND in `docs/package.json` on release.
- `demos/` — example scripts (manual, not a test suite; there is no `tests/`).
- `decrypt/` — HAR-decryption utilities for reverse-engineering the app API.
- `docs/` — SEPARATE pnpm + VitePress site (own `package.json`, `pnpm-lock`),
  published to mijia-api.do1e.com. Not part of the Python build.
- `skills/SKILL.md` — authored Agent-skill doc for the CLI, kept in sync with
  the CLI.

## Dev environment

Managed with `uv` (Python >= 3.10, pinned in `.python-version`; setuptools
build backend). The PyPI index is overridden to the NJU mirror in
`pyproject.toml` `[[tool.uv.index]]` — expected for a CN environment, don't
"fix" it.

```bash
uv sync                # install prod + dev deps (dev group: ruff, pre-commit)
uv run ruff check      # lint (CI-equivalent; also the pre-commit hook)
uv run ruff format --check .
uv run home-ai -l    # run the CLI locally (needs auth - see Pitfalls)
```

## Build & test

```bash
uv build               # build sdist + wheel
uv run pre-commit run --all-files   # ruff check (only hook configured)
```

There is no automated test suite; `demos/` scripts are manual
exercisers. Lint is the gate — run `uv run ruff check` before committing.

## Conventions

- Ruff: `line-length = 100`; ignores `C901,E501,E721,E741,F402,F823`; select
  `C,E,F,I,W`; double quotes for strings, isort with 2 blank lines after
  imports. Match this style manually (format is `skip-magic-trailing-comma`).
- Version: bump `home_ai/version.py` + `docs/package.json` together.
- Errors: typed exception classes in `errors.py`, each maps a Mijia error code
  to a Chinese message via the `ERROR_CODE` dict there. Add or reuse these;
  don't raise bare `Exception` for API failures.
- CLI: stub args in `parse_args()` (argparse, subcommands `get`/`set`/`action`/
  `statistics`/`run`/`login`/`mcp`), dispatch in `main()`. Console output is
  Chinese.
- Logging: module logger named `mijiaAPI`; level from env `MIJIA_LOG_LEVEL`
  (default `INFO`, validated in `__main__.py`).

## Pitfalls

- AUTH: the CLI needs `~/.config/mijia-api/auth.json` from a QR login.
  `login` prints a QR and BLOCKS until the user scans — never call it in an
  automated/headless flow. `mcp` starts a long-running stdio server — also
  blocking. See `skills/SKILL.md` for the full agent rules.
- Mutated `--run` → use `home-ai run "<prompt>"` subcommand.
- `uv build` output goes to `dist/` (gitignored); don't commit built artifacts.
- `uv.lock` is committed and authoritative — regenerate with `uv lock`, don't
  hand-edit.
- Docs site and Python package share the repo but have independent toolchains;
  never mix `uv` and `pnpm` commands.
