#!/usr/bin/env python3
"""Preflight validator for GHR app deployments.

Validates a candidate app repo against the azure-deploy.json contract and the
structural rules of the platform BEFORE any Terraform runs. Every failure
pattern discovered in production should be converted into a check here.

Usage:
    preflight.py (--repo <git-url> | --local-path <dir>) \
        [--contract <path>] [--app-name <name>] [--check-names]

Exit codes: 0 = PASS (warnings allowed), 1 = FAIL.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import jsonschema  # type: ignore[import-not-found]

    HAVE_JSONSCHEMA = True
except ImportError:
    HAVE_JSONSCHEMA = False

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schemas" / "azure-deploy.schema.json"

RUNTIMES = ("node", "python")
MONOREPO_MARKERS = ("pnpm-workspace.yaml", "lerna.json", "turbo.json")
DB_PY_DEPS = ("sqlalchemy", "psycopg2", "psycopg2-binary", "asyncpg")
WORKER_PY_DEPS = ("celery", "dramatiq")
DB_FILE_GLOBS = ("drizzle.config.*", "ormconfig*", "knexfile*", "alembic.ini")


def sanitize_name(raw: str) -> str:
    """Sanitize a repo/app name into lowercase alnum+hyphen (Azure web app rules)."""
    name = re.sub(r"[^a-z0-9-]", "-", raw.lower())
    name = re.sub(r"-{2,}", "-", name).strip("-")
    return name or "app"


def derive_app_name(source: str) -> str:
    base = source.rstrip("/").rsplit("/", 1)[-1]
    if base.endswith(".git"):
        base = base[:-4]
    return sanitize_name(base)


def clone_repo(url: str, dest: Path) -> Tuple[bool, str]:
    """Shallow clone, preferring `gh repo clone` (handles private repos)."""
    gh = shutil.which("gh")
    if gh:
        proc = subprocess.run(
            [gh, "repo", "clone", url, str(dest), "--", "--depth", "1"],
            capture_output=True,
            text=True,
        )
        if proc.returncode == 0:
            return True, "gh"
    git = shutil.which("git")
    if not git:
        return False, "neither gh nor git is available to clone the repo"
    proc = subprocess.run(
        [git, "clone", "--depth", "1", url, str(dest)],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return False, f"git clone failed: {proc.stderr.strip()[:400]}"
    return True, "git"


def read_requirements(repo: Path) -> List[str]:
    req = repo / "requirements.txt"
    if not req.is_file():
        return []
    packages: List[str] = []
    for line in req.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        token = re.split(r"[<>=~!;\[]", line, maxsplit=1)[0].strip().lower()
        if token:
            packages.append(token)
    return packages


def find_db_markers(repo: Path, py_deps: List[str]) -> List[str]:
    markers: List[str] = []
    for pattern in DB_FILE_GLOBS:
        for hit in sorted(repo.glob(pattern)):
            markers.append(hit.name)
    if (repo / "prisma").is_dir():
        markers.append("prisma/")
    for dep in DB_PY_DEPS:
        if dep in py_deps:
            markers.append(f"requirements.txt:{dep}")
    return markers


SETTING_KEY_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def structural_schema_checks(contract: Dict[str, Any], failures: List[str]) -> None:
    """Fallback checks when the jsonschema library is not installed."""
    if contract.get("version") != "1":
        failures.append(f'contract "version" must be "1", got {contract.get("version")!r}')
    if contract.get("runtime") not in RUNTIMES:
        failures.append(f'contract "runtime" must be one of {RUNTIMES}, got {contract.get("runtime")!r}')
    for key in ("app_settings", "kv_secrets"):
        if key in contract and not isinstance(contract[key], dict):
            failures.append(f'contract "{key}" must be an object')
            continue
        for setting_key, setting_value in (contract.get(key) or {}).items():
            # Keys/values are rendered into terraform variables downstream;
            # enforce the same charset the JSON Schema would (security audit L1).
            if not SETTING_KEY_PATTERN.match(str(setting_key)):
                failures.append(
                    f'contract "{key}" key {setting_key!r} is invalid: keys must match ^[A-Za-z_][A-Za-z0-9_]*$'
                )
            if not isinstance(setting_value, str):
                failures.append(f'contract "{key}" value for {setting_key!r} must be a string')
    if contract.get("runtime") == "python" and not contract.get("startup_command"):
        failures.append('runtime "python" requires a non-empty "startup_command" in the contract')


def validate_with_schema(contract: Dict[str, Any], failures: List[str], warnings: List[str]) -> None:
    if not SCHEMA_PATH.is_file():
        warnings.append(f"schema file not found at {SCHEMA_PATH}; falling back to structural checks")
        structural_schema_checks(contract, failures)
        return
    if not HAVE_JSONSCHEMA:
        warnings.append(
            "python package 'jsonschema' not installed; skipping full schema validation "
            "(pip install jsonschema). Running structural checks only."
        )
        structural_schema_checks(contract, failures)
        return
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    validator = jsonschema.Draft202012Validator(schema)
    for error in sorted(validator.iter_errors(contract), key=lambda e: list(e.absolute_path)):
        path = "/".join(str(p) for p in error.absolute_path) or "(root)"
        failures.append(f"schema violation at {path}: {error.message}")


def check_name_availability(app_name: str, failures: List[str], warnings: List[str]) -> None:
    az = shutil.which("az")
    if not az:
        warnings.append("az CLI not found; skipping Azure name availability check")
        return
    account = subprocess.run([az, "account", "show"], capture_output=True, text=True)
    if account.returncode != 0:
        warnings.append("az CLI not authenticated (az account show failed); skipping name availability check")
        return
    try:
        subscription_id = json.loads(account.stdout)["id"]
    except (json.JSONDecodeError, KeyError):
        warnings.append("could not parse az account show output; skipping name availability check")
        return
    url = (
        f"https://management.azure.com/subscriptions/{subscription_id}"
        "/providers/Microsoft.Web/checknameavailability?api-version=2023-01-01"
    )
    body = json.dumps({"name": app_name, "type": "Microsoft.Web/sites"})
    proc = subprocess.run(
        [az, "rest", "--method", "post", "--url", url, "--body", body],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        warnings.append(f"name availability check failed to run: {proc.stderr.strip()[:200]}")
        return
    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError:
        warnings.append("could not parse name availability response; skipping")
        return
    if not result.get("nameAvailable", False):
        reason = result.get("message") or result.get("reason") or "unavailable"
        failures.append(
            f"web app name '{app_name}' is not globally available on Azure ({reason}). "
            "Pick another --app-name, or use the hash-suffix fallback: "
            f"'{sanitize_name(app_name)[:24]}-<4char>'."
        )


def run_checks(repo: Path, contract_path: Path, app_name: str, check_names: bool) -> Tuple[List[str], List[str]]:
    failures: List[str] = []
    warnings: List[str] = []

    # 1. Contract exists, parses, has version + runtime.
    if not contract_path.is_file():
        failures.append(
            f"azure-deploy.json not found at {contract_path}. "
            "Copy infra/templates/app-repo/azure-deploy.json into the repo root and fill it in."
        )
        return failures, warnings
    try:
        contract: Dict[str, Any] = json.loads(contract_path.read_text(encoding="utf-8", errors="replace"))
    except json.JSONDecodeError as exc:
        failures.append(f"azure-deploy.json is not valid JSON: {exc}")
        return failures, warnings
    if not isinstance(contract, dict):
        failures.append("azure-deploy.json must contain a JSON object")
        return failures, warnings
    for required_key in ("version", "runtime"):
        if required_key not in contract:
            failures.append(f'azure-deploy.json is missing required key "{required_key}"')

    # 2. Schema validation (full when jsonschema is importable).
    validate_with_schema(contract, failures, warnings)

    runtime = contract.get("runtime")
    py_deps = read_requirements(repo)

    # 3. Runtime-specific repo shape.
    if runtime == "node":
        if not (repo / "package.json").is_file():
            failures.append('runtime "node" declared but no package.json at repo root')
    elif runtime == "python":
        if not (repo / "requirements.txt").is_file():
            failures.append('runtime "python" declared but no requirements.txt at repo root')
        if not contract.get("startup_command"):
            failures.append('runtime "python" requires "startup_command" in azure-deploy.json')

    # 4. Structural refusals (out of contract — route to a human).
    for marker in MONOREPO_MARKERS:
        if (repo / marker).is_file():
            failures.append(
                f"monorepo marker '{marker}' found: monorepos are out of contract for v1. "
                "Route this app to a human operator."
            )
    for dockerfile in sorted(repo.glob("Dockerfile*")):
        failures.append(
            f"'{dockerfile.name}' found: container-based apps are out of contract for v1. "
            "Route this app to a human operator."
        )
    procfile = repo / "Procfile"
    if procfile.is_file():
        for line in procfile.read_text(encoding="utf-8", errors="replace").splitlines():
            if re.match(r"^\s*worker\s*:", line, flags=re.IGNORECASE):
                failures.append(
                    "Procfile declares a 'worker' process: background workers are out of "
                    "contract for v1. Route this app to a human operator."
                )
                break
    for dep in WORKER_PY_DEPS:
        if dep in py_deps:
            failures.append(
                f"requirements.txt includes '{dep}': background workers are out of contract "
                "for v1. Route this app to a human operator."
            )

    # 5. Database markers require declared Key Vault secrets.
    db_markers = find_db_markers(repo, py_deps)
    kv_secrets = contract.get("kv_secrets") or {}
    if db_markers and not kv_secrets:
        failures.append(
            f"database detected ({', '.join(db_markers)}) but no Key Vault secret declared: "
            "add a kv_secrets entry (e.g. \"DATABASE_URL\": \"database-url\") to "
            "azure-deploy.json and ask the operator to create the secret with "
            "'az keyvault secret set' before deploying."
        )
    if db_markers and kv_secrets and not contract.get("db_migration_command"):
        warnings.append(
            "database detected but no db_migration_command in contract: schema changes "
            "will NOT run automatically in CI. Add e.g. \"db_migration_command\": "
            "\"npm run db:push\" (drizzle) or \"alembic upgrade head\"."
        )

    # 6. Secret hygiene (security audit L4): warn on committed env files and
    # secret-looking app_settings keys. Secrets belong in kv_secrets only.
    # Example/template env files (.env.example, .env.sample, ...) are committed
    # deliberately and carry no secrets — skip them.
    env_template_suffixes = (".example", ".sample", ".template", ".dist")
    for env_file in sorted(repo.glob(".env*")):
        if env_file.is_file() and not env_file.name.endswith(env_template_suffixes):
            warnings.append(
                f"committed environment file '{env_file.name}' detected: it would be "
                "packaged into the deploy artifact. Remove it and move secrets to kv_secrets."
            )
    app_settings = contract.get("app_settings") or {}
    if isinstance(app_settings, dict):
        for key in app_settings:
            if re.search(
                r"(?i)(password|passwd|secret|token|api[_-]?key|private[_-]?key|connection[_-]?string)",
                str(key),
            ):
                warnings.append(
                    f"app_settings key '{key}' looks secret: app_settings are stored in plaintext. "
                    "Move it to kv_secrets (Key Vault reference) instead."
                )

    # 7. Soft warning for missing health check path.
    if not contract.get("health_check_path"):
        warnings.append("no health_check_path in contract; default /health will be used")

    # 8. Optional Azure global name availability check.
    if check_names:
        check_name_availability(app_name, failures, warnings)

    return failures, warnings


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="GHR deployment preflight validator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--repo", help="git URL to shallow-clone and validate")
    source.add_argument("--local-path", help="local directory to validate")
    parser.add_argument("--contract", help="path to an azure-deploy.json (overrides <repo>/azure-deploy.json)")
    parser.add_argument("--app-name", help="web app name (default: derived from repo/path name)")
    parser.add_argument(
        "--check-names",
        action="store_true",
        help="check Azure global name availability via az CLI (skipped with a warning if az is unavailable)",
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)

    tmp: Optional[tempfile.TemporaryDirectory[str]] = None
    if args.repo:
        tmp = tempfile.TemporaryDirectory(prefix="ghr-preflight-")
        repo = Path(tmp.name) / "repo"
        ok, detail = clone_repo(args.repo, repo)
        if not ok:
            print(f"FAIL  could not clone {args.repo}: {detail}")
            tmp.cleanup()
            return 1
        source_desc = f"{args.repo} (cloned with {detail})"
    else:
        repo = Path(args.local_path).resolve()
        if not repo.is_dir():
            print(f"FAIL  local path does not exist or is not a directory: {repo}")
            return 1
        source_desc = str(repo)

    app_name = sanitize_name(args.app_name) if args.app_name else derive_app_name(args.repo or str(repo))
    contract_path = Path(args.contract).resolve() if args.contract else repo / "azure-deploy.json"

    failures, warnings = run_checks(repo, contract_path, app_name, args.check_names)

    print("=" * 64)
    print("GHR DEPLOYMENT PREFLIGHT")
    print(f"  source:    {source_desc}")
    print(f"  app name:  {app_name}")
    print(f"  contract:  {contract_path}")
    print("=" * 64)
    for warning in warnings:
        print(f"  WARN  {warning}")
    for failure in failures:
        print(f"  FAIL  {failure}")
    print("-" * 64)
    if failures:
        print(f"RESULT: FAIL ({len(failures)} failure(s), {len(warnings)} warning(s))")
        if tmp:
            tmp.cleanup()
        return 1
    print(f"RESULT: PASS ({len(warnings)} warning(s))")
    if tmp:
        tmp.cleanup()
    return 0


if __name__ == "__main__":
    sys.exit(main())
