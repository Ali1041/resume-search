#!/usr/bin/env bash
#
# deploy.sh — the GHR deployment wrapper. The ONLY apply path in v1.
#
#   deploy.sh deploy <git-url-or-local-path> [--app-name NAME] [--env staging|prod]
#                    [--staging-mode slot|app] [--contract PATH] [--yes]
#   deploy.sh destroy <app-name>
#
# Flow: preflight -> terraform plan -> human gate -> apply -> smoke test -> URL.
#
# Environment variables:
#   STAGING_MODE            default staging mode (slot|app), default "slot"
#   BACKEND_CONFIG_ARGS     extra terraform init backend args, e.g.
#                           "-backend-config=backend.hcl" (path relative to infra/app)
#   PLATFORM_APP_SERVICE_PLAN_ID / PLATFORM_RESOURCE_GROUP_NAME / PLATFORM_LOCATION
#                           fallback values when platform root outputs are not readable
#   OPERATOR_OBJECT_ID      AAD object ID of the human operator (Key Vault Secrets Officer)
#   DEPLOY_SP_OBJECT_ID     AAD object ID of the GitHub Actions SP (Website Contributor)
#   SLACK_WEBHOOK_URL       if set, the final URL is posted to this webhook
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${INFRA_DIR}/app"
PLATFORM_DIR="${INFRA_DIR}/platform"
PREFLIGHT="${SCRIPT_DIR}/preflight.py"

usage() {
  cat <<'EOF'
Usage:
  deploy.sh deploy <git-url-or-local-path> [--app-name NAME] [--env staging|prod]
                   [--staging-mode slot|app] [--contract PATH] [--yes]
  deploy.sh destroy <app-name>
EOF
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

sanitize_name() {
  local raw lowered
  raw="$1"
  lowered="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  printf '%s' "$lowered" | tr -c 'a-z0-9-' '-' | sed -e 's/-\{2,\}/-/g' -e 's/^-\{1,\}//' -e 's/-\{1,\}$//'
}

derive_app_name() {
  local base
  base="${1%/}"
  base="${base##*/}"
  base="${base%.git}"
  local name
  name="$(sanitize_name "$base")"
  printf '%s' "${name:-app}"
}

# contract_get <contract-file> <key> — prints a scalar field or empty string.
contract_get() {
  local file="$1" key="$2"
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$key" '.[$k] // empty | if type == "string" then . else empty end' "$file"
  else
    python3 - "$file" "$key" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    value = json.load(fh).get(sys.argv[2])
print(value if isinstance(value, str) else "")
PY
  fi
}

# contract_write_tfvars_json <contract-file> <out-file> — writes contract-derived
# terraform variables as a JSON tfvars file. JSON var files need no HCL rendering
# in bash, which removes the -var injection class entirely (security audit M3).
contract_write_tfvars_json() {
  local file="$1" out="$2"
  if command -v jq >/dev/null 2>&1; then
    jq -n --slurpfile c "$file" '
      ($c[0]) as $contract
      | {
          runtime: $contract.runtime,
          health_check_path: ($contract.health_check_path // "/health"),
          app_settings: ($contract.app_settings // {}),
          kv_secret_references: ($contract.kv_secrets // {})
        }
      + (if $contract.runtime_version then {runtime_version: $contract.runtime_version} else {} end)
      + (if $contract.startup_command then {startup_command: $contract.startup_command} else {} end)
    ' > "$out"
  else
    python3 - "$file" "$out" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    contract = json.load(fh)
data = {
    "runtime": contract.get("runtime"),
    "health_check_path": contract.get("health_check_path") or "/health",
    "app_settings": contract.get("app_settings") or {},
    "kv_secret_references": contract.get("kv_secrets") or {},
}
if contract.get("runtime_version"):
    data["runtime_version"] = contract["runtime_version"]
if contract.get("startup_command"):
    data["startup_command"] = contract["startup_command"]
with open(sys.argv[2], "w", encoding="utf-8") as fh:
    json.dump(data, fh)
PY
  fi
}

# json_field <key> — reads an output value from `terraform output -json` on stdin.
# Output documents wrap every value as {"<key>": {"value": ..., ...}}.
json_field() {
  local key="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$key" '.[$k].value // empty'
  else
    python3 -c 'import json,sys; print((json.load(sys.stdin).get(sys.argv[1]) or {}).get("value") or "")' "$key"
  fi
}

# resolve_platform — populate RG_NAME, LOCATION, PLAN_ID and
# PLATFORM_STAGING_MODE from platform root outputs, falling back to env vars.
resolve_platform() {
  local outputs=""
  if outputs="$(terraform -chdir="$PLATFORM_DIR" output -json 2>/dev/null)"; then
    RG_NAME="$(printf '%s' "$outputs" | json_field resource_group_name)"
    LOCATION="$(printf '%s' "$outputs" | json_field location)"
    PLAN_ID="$(printf '%s' "$outputs" | json_field app_service_plan_id)"
    PLATFORM_STAGING_MODE="$(printf '%s' "$outputs" | json_field staging_mode)"
  fi
  RG_NAME="${RG_NAME:-${PLATFORM_RESOURCE_GROUP_NAME:-}}"
  LOCATION="${LOCATION:-${PLATFORM_LOCATION:-canadacentral}}"
  PLAN_ID="${PLAN_ID:-${PLATFORM_APP_SERVICE_PLAN_ID:-}}"
  if [[ -z "$RG_NAME" || -z "$PLAN_ID" ]]; then
    die "could not resolve platform outputs. Run the platform root first (infra/platform) or set PLATFORM_RESOURCE_GROUP_NAME and PLATFORM_APP_SERVICE_PLAN_ID."
  fi
}

clone_source() {
  local url="$1" dest="$2"
  if command -v gh >/dev/null 2>&1; then
    if gh repo clone "$url" "$dest" -- --depth 1; then
      return 0
    fi
    echo "gh repo clone failed; falling back to git clone" >&2
  fi
  git clone --depth 1 "$url" "$dest"
}

smoke_test() {
  local url="$1" attempt
  for attempt in 1 2 3 4 5 6; do
    if curl -fsS --max-time 20 --connect-timeout 10 -o /dev/null "$url"; then
      echo "smoke test OK: $url"
      return 0
    fi
    echo "smoke attempt ${attempt}/6 failed for $url"
    if [[ "$attempt" -lt 6 ]]; then
      sleep 30
    fi
  done
  return 1
}

log_tail_hint() {
  local rg="$1" app="$2" env_target="$3" mode="$4"
  if [[ "$env_target" == "staging" && "$mode" == "slot" ]]; then
    echo "  az webapp log tail --name $app --resource-group $rg --slot staging"
  elif [[ "$env_target" == "staging" && "$mode" == "app" ]]; then
    echo "  az webapp log tail --name ${app}-staging --resource-group $rg"
  else
    echo "  az webapp log tail --name $app --resource-group $rg"
  fi
}

notify_slack() {
  local message="$1"
  local payload
  if command -v jq >/dev/null 2>&1; then
    payload="$(jq -n --arg t "$message" '{text: $t}')"
  else
    payload="$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' "$message")"
  fi
  curl -sS -X POST -H 'Content-Type: application/json' -d "$payload" "$SLACK_WEBHOOK_URL" >/dev/null \
    && echo "slack notification sent" \
    || echo "WARNING: slack notification failed" >&2
}

cmd_deploy() {
  local source="" app_name="" env_target="prod" contract_arg="" assume_yes="false"
  local staging_mode="${STAGING_MODE:-slot}"

  # Temp artifacts (clone dir, plan file, tfvars dir) are globals so the EXIT
  # trap can clean them up on every exit path, including die (security audit L3).
  work_dir=""
  plan_file=""
  tmp_vars_dir=""
  trap '[[ -n "$work_dir" ]] && rm -rf "$work_dir"; [[ -n "$plan_file" ]] && rm -f "$plan_file"; [[ -n "$tmp_vars_dir" ]] && rm -rf "$tmp_vars_dir"; return 0' EXIT

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --app-name) app_name="$2"; shift 2 ;;
      --env) env_target="$2"; shift 2 ;;
      --staging-mode) staging_mode="$2"; shift 2 ;;
      --contract) contract_arg="$2"; shift 2 ;;
      --yes) assume_yes="true"; shift ;;
      -h|--help) usage; exit 0 ;;
      *)
        if [[ -z "$source" ]]; then
          source="$1"; shift
        else
          die "unexpected argument: $1"
        fi
        ;;
    esac
  done

  [[ -n "$source" ]] || { usage; exit 1; }
  [[ "$env_target" == "staging" || "$env_target" == "prod" ]] || die "--env must be staging or prod"
  [[ "$staging_mode" == "slot" || "$staging_mode" == "app" ]] || die "--staging-mode must be slot or app"

  # Resolve source to a local directory (clone if it is a URL).
  work_dir=""
  local repo_dir=""
  if [[ -d "$source" ]]; then
    repo_dir="$(cd "$source" && pwd)"
  else
    # Validate the scheme before handing the URL to gh/git (security audit L2).
    [[ "$source" == https://* || "$source" == git@* ]] \
      || die "unsupported repo URL scheme (expected https:// or git@...): $source"
    work_dir="$(mktemp -d -t ghr-deploy)"
    repo_dir="${work_dir}/repo"
    echo "cloning $source ..."
    clone_source "$source" "$repo_dir"
  fi

  if [[ -z "$app_name" ]]; then
    app_name="$(derive_app_name "$source")"
  else
    app_name="$(sanitize_name "$app_name")"
  fi
  [[ -n "$app_name" ]] || die "could not derive a valid app name"

  local contract_file
  if [[ -n "$contract_arg" ]]; then
    contract_file="$(cd "$(dirname "$contract_arg")" && pwd)/$(basename "$contract_arg")"
  else
    contract_file="${repo_dir}/azure-deploy.json"
  fi
  [[ -f "$contract_file" ]] || die "contract file not found: $contract_file"

  # 1. Preflight. Full schema validation is mandatory for deploys (the
  # structural fallback is for standalone preflight runs only).
  if ! python3 -c 'import jsonschema' >/dev/null 2>&1; then
    die "python3 package 'jsonschema' is required for deployment (pip3 install --user jsonschema). Standalone preflight runs may skip it; deploys must validate the contract against the full schema."
  fi
  local preflight_args=(--local-path "$repo_dir" --contract "$contract_file" --app-name "$app_name")
  if command -v az >/dev/null 2>&1; then
    preflight_args+=(--check-names)
  fi
  if ! python3 "$PREFLIGHT" "${preflight_args[@]}"; then
    die "preflight failed; refusing to deploy"
  fi

  # 2. Read contract fields. Values passed to terraform go through a JSON
  # tfvars file (never bash-rendered HCL); scalars below are for script logic.
  local runtime health_path
  runtime="$(contract_get "$contract_file" runtime)"
  health_path="$(contract_get "$contract_file" health_check_path)"
  [[ -n "$runtime" ]] || die "contract is missing runtime"
  health_path="${health_path:-/health}"

  tmp_vars_dir="$(mktemp -d -t ghr-deploy-vars)"
  local tfvars_json="${tmp_vars_dir}/contract.tfvars.json"
  contract_write_tfvars_json "$contract_file" "$tfvars_json"

  # 3. Platform wiring.
  local RG_NAME="" LOCATION="" PLAN_ID="" PLATFORM_STAGING_MODE=""
  resolve_platform
  # Fail fast on staging-mode drift: the platform plan SKU was sized for one
  # strategy, so a mismatched deploy would fail deep inside the Azure apply.
  if [[ -n "$PLATFORM_STAGING_MODE" && "$PLATFORM_STAGING_MODE" != "$staging_mode" ]]; then
    die "staging-mode mismatch: platform was applied with staging_mode=${PLATFORM_STAGING_MODE} but this deploy uses --staging-mode ${staging_mode}. Re-apply infra/platform with staging_mode=${staging_mode} (and a slot-capable SKU if switching to \"slot\") or re-run with --staging-mode ${PLATFORM_STAGING_MODE}."
  fi

  local tf_vars=(
    -var-file="$tfvars_json"
    -var "app_name=${app_name}"
    -var "resource_group_name=${RG_NAME}"
    -var "location=${LOCATION}"
    -var "app_service_plan_id=${PLAN_ID}"
    -var "staging_mode=${staging_mode}"
  )
  if [[ -n "${OPERATOR_OBJECT_ID:-}" ]]; then
    tf_vars+=(-var "operator_object_id=${OPERATOR_OBJECT_ID}")
  fi
  if [[ -n "${DEPLOY_SP_OBJECT_ID:-}" ]]; then
    tf_vars+=(-var "deploy_sp_object_id=${DEPLOY_SP_OBJECT_ID}")
  fi

  local backend_args=(-backend-config="key=apps/${app_name}.tfstate")
  if [[ -n "${BACKEND_CONFIG_ARGS:-}" ]]; then
    local extra_backend_args=()
    read -r -a extra_backend_args <<< "$BACKEND_CONFIG_ARGS"
    backend_args+=("${extra_backend_args[@]}")
  fi

  # 4. Plan (plan file kept out of the repo tree).
  plan_file="$(mktemp -t "tfplan-${app_name}")"
  terraform -chdir="$APP_DIR" init -input=false -reconfigure "${backend_args[@]}"
  terraform -chdir="$APP_DIR" plan -input=false -out="$plan_file" "${tf_vars[@]}"

  # 5. Human gate.
  if [[ "$assume_yes" != "true" ]]; then
    echo
    echo "Plan complete. Type the app name (${app_name}) to apply:"
    read -r confirm
    if [[ "$confirm" != "$app_name" ]]; then
      die "confirmation did not match; nothing was applied"
    fi
  fi

  # 6. Apply.
  terraform -chdir="$APP_DIR" apply -input=false "$plan_file"
  rm -f "$plan_file"
  plan_file=""
  local outputs production_url staging_url kv_name target_url
  outputs="$(terraform -chdir="$APP_DIR" output -json)"
  production_url="$(printf '%s' "$outputs" | json_field production_url)"
  staging_url="$(printf '%s' "$outputs" | json_field staging_url)"
  kv_name="$(printf '%s' "$outputs" | json_field key_vault_name)"

  if [[ "$env_target" == "staging" ]]; then
    target_url="$staging_url"
  else
    target_url="$production_url"
  fi

  # 7. Smoke test.
  if ! smoke_test "${target_url}${health_path}"; then
    echo "SMOKE TEST FAILED for ${target_url}${health_path}" >&2
    echo "Tail logs with:" >&2
    log_tail_hint "$RG_NAME" "$app_name" "$env_target" "$staging_mode" >&2
    exit 2
  fi

  # 8. Report.
  echo
  echo "deploy complete"
  echo "  production: $production_url"
  echo "  staging:    $staging_url"
  echo "  key vault:  $kv_name  (set secrets with: az keyvault secret set --vault-name $kv_name --name <secret> --value <value>)"
  if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
    notify_slack "GHR deploy complete: ${app_name} -> ${target_url}"
  fi
}

cmd_destroy() {
  local app_name="${1:-}"
  [[ -n "$app_name" ]] || { usage; exit 1; }
  app_name="$(sanitize_name "$app_name")"
  [[ -n "$app_name" ]] || die "invalid app name"

  # Guard: never run destroy against the platform (shared infra) root.
  local target_dir platform_real target_real
  target_dir="$APP_DIR"
  platform_real="$(cd "$PLATFORM_DIR" && pwd -P)"
  target_real="$(cd "$target_dir" && pwd -P)"
  if [[ "$target_real" == "$platform_real" ]]; then
    die "refusing to run destroy in the platform root; shared infrastructure is never destroyed by this script"
  fi

  local RG_NAME="" LOCATION="" PLAN_ID=""
  resolve_platform

  echo "This will DESTROY all Azure resources for app '${app_name}' (state key apps/${app_name}.tfstate)."
  echo "Type the app name (${app_name}) to confirm:"
  read -r confirm
  if [[ "$confirm" != "$app_name" ]]; then
    die "confirmation did not match; nothing was destroyed"
  fi

  local backend_args=(-backend-config="key=apps/${app_name}.tfstate")
  if [[ -n "${BACKEND_CONFIG_ARGS:-}" ]]; then
    local extra_backend_args=()
    read -r -a extra_backend_args <<< "$BACKEND_CONFIG_ARGS"
    backend_args+=("${extra_backend_args[@]}")
  fi

  terraform -chdir="$target_dir" init -input=false -reconfigure "${backend_args[@]}"
  # Variable values are irrelevant to destroy (it acts on state), but required
  # variables must still be given; runtime=node is a neutral placeholder.
  terraform -chdir="$target_dir" destroy \
    -var "app_name=${app_name}" \
    -var "resource_group_name=${RG_NAME}" \
    -var "location=${LOCATION}" \
    -var "app_service_plan_id=${PLAN_ID}" \
    -var "runtime=node"

  cat <<EOF

Destroyed resources for '${app_name}'.

NOTE: the app's Key Vault is soft-deleted, not purged. The vault NAME stays
reserved for the 90-day retention period. To reuse the name sooner:
  az keyvault recover --name <vault-name>     # restore it, or
  az keyvault purge  --name <vault-name>      # permanently delete (irreversible)
EOF
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    deploy)
      shift
      cmd_deploy "$@"
      ;;
    destroy)
      shift
      cmd_destroy "$@"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
