#!/usr/bin/env bash
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-"$(pwd)"}"
cd "$ROOT"

echo "== BigBoss boot =="
echo "Actor: ${GITHUB_ACTOR:-unknown}"
echo "Repo : ${GITHUB_REPOSITORY:-unknown}"
echo "Event: ${GITHUB_EVENT_NAME:-unknown}"
echo "SHA  : ${GITHUB_SHA:-unknown}"

redact_secrets() {
  # Best-effort redaction for logs. Never print secrets verbatim.
  local s="${1:-}"
  local v
  for v in "${CURSOR_API_KEY:-}" "${CURSOR_CLOUD_API_KEY:-}" "${GH_TOKEN:-}"; do
    if [ -n "${v:-}" ]; then
      s="${s//$v/<redacted>}"
    fi
  done
  printf "%s" "$s"
}

gh_api_json() {
  # Print JSON to stdout. On failure, emit a warning to stderr and return non-zero.
  local out status
  set +e
  out="$(gh api -X GET --paginate --slurp "$@" 2>&1)"
  status=$?
  set -e
  if [ $status -ne 0 ]; then
    echo "WARN: gh api failed (exit=$status): gh api $*" >&2
    echo "$out" | head -c 2000 >&2 || true
    echo >&2
    return $status
  fi
  printf "%s" "$out"
}

AGENT_YML="${BIGBOSS_AGENT_YML:-".github/workflows/bigboss/agent.yml"}"
echo
echo "== Config =="
echo "agent.yml: $AGENT_YML"

# Pass the agent config path to self-check logic (to decide which optional
# capabilities should be required).
export AGNET_SELF_CHECK_AGENT_YML="$AGENT_YML"

echo
echo "== Event payload head =="
head -c 2000 "${GITHUB_EVENT_PATH}" || true
echo
echo

read_comment_body() {
  node - << 'NODE'
import fs from "node:fs";
const p = process.env.GITHUB_EVENT_PATH;
let body = "";
try {
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  if (data && typeof data === "object") {
    body = (((data.comment ?? {}).body) ?? "");
  }
} catch {
  // ignore
}
process.stdout.write(String(body).replace(/\r\n/g, "\n"));
NODE
}

BODY="$(read_comment_body)"

read_sender_assoc() {
  node - << 'NODE'
import fs from "node:fs";
const p = process.env.GITHUB_EVENT_PATH;
let assoc = "";
try {
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  assoc = String((data?.comment?.author_association ?? data?.sender?.type ?? "") || "");
} catch {}
process.stdout.write(assoc);
NODE
}

SENDER_ASSOC="$(read_sender_assoc)"

read_dispatch_prompt() {
  node - <<'NODE'
import fs from "node:fs";
const p = process.env.GITHUB_EVENT_PATH;
let prompt = "";
try {
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  prompt = String(data?.inputs?.prompt ?? "");
} catch {}
process.stdout.write(prompt.replace(/\r\n/g, "\n"));
NODE
}

is_allowed_summoner() {
  # Only maintainers can summon (OWNER/MEMBER/COLLABORATOR).
  # For discussion comments, author_association should still be present.
  case "${SENDER_ASSOC:-}" in
    OWNER|MEMBER|COLLABORATOR) return 0 ;;
    *) return 1 ;;
  esac
}

should_wake_up() {
  # Minimal gate:
  # - wake if comment body mentions @bigboss (or common typo @bigbos) or /bigboss or contains /do
  # - also wake on workflow_dispatch where there may be no comment body
  local event="${GITHUB_EVENT_NAME:-}"
  if [ "$event" = "workflow_dispatch" ]; then
    return 0
  fi
  if echo "${BODY:-}" | grep -Eqi '(^|\s)(/bigboss|@bigboss|@bigbos)\b|/do\b'; then
    return 0
  fi
  return 1
}

if should_wake_up; then
  echo "Wake-up: YES"
else
  echo "Wake-up: NO (exit)"
  exit 0
fi

if [ "${GITHUB_EVENT_NAME:-}" != "workflow_dispatch" ]; then
  if is_allowed_summoner; then
    echo "Summoner allowed: YES (${SENDER_ASSOC:-unknown})"
  else
    echo "Summoner allowed: NO (${SENDER_ASSOC:-unknown})"
    # Silently ignore non-maintainer summons.
    exit 0
  fi
fi

echo
echo "== Secrets / env sanity =="

# Back-compat: allow either CURSOR_CLOUD_API_KEY (preferred) or CURSOR_API_KEY (existing in this repo).
if [ -z "${CURSOR_API_KEY:-}" ] && [ -n "${CURSOR_CLOUD_API_KEY:-}" ]; then
  export CURSOR_API_KEY="${CURSOR_CLOUD_API_KEY}"
fi

missing=()
if [ -z "${GH_TOKEN:-}" ]; then missing+=("GH_TOKEN (Actions token)"); fi
if [ -z "${CURSOR_API_KEY:-}" ]; then missing+=("CURSOR_CLOUD_API_KEY (or CURSOR_API_KEY)"); fi

echo "GH_TOKEN set         : $([ -n "${GH_TOKEN:-}" ] && echo yes || echo no)"
echo "CURSOR_API_KEY set   : $([ -n "${CURSOR_API_KEY:-}" ] && echo yes || echo no)"
echo "CURSOR_CLOUD_API_KEY : $([ -n "${CURSOR_CLOUD_API_KEY:-}" ] && echo yes || echo no)"

detect_notify_target() {
  node - <<'NODE'
import fs from "node:fs";
const p = process.env.GITHUB_EVENT_PATH;
let data = {};
try {
  data = JSON.parse(fs.readFileSync(p, "utf8"));
} catch {
  // ignore
}
let kind = "";
let number = "";
if (data && typeof data === "object") {
  // issue_comment event includes { issue: { number } }
  if (data.issue?.number) {
    kind = "issue";
    number = String(data.issue.number);
  } else if (data.pull_request?.number) {
    // PRs can be commented through the issues API as well.
    kind = "issue";
    number = String(data.pull_request.number);
  } else if (typeof data.pull_request_url === "string" && data.pull_request_url.trim()) {
    // pull_request_review_comment payload includes `pull_request_url` like:
    // https://api.github.com/repos/<owner>/<repo>/pulls/<number>
    const m = data.pull_request_url.match(/\/pulls\/(\d+)\b/);
    if (m) {
      kind = "issue";
      number = String(m[1]);
    }
  }
}
if (kind && number) {
  process.stdout.write(`BIGBOSS_NOTIFY_KIND=${kind}\nBIGBOSS_NOTIFY_NUMBER=${number}\n`);
}
NODE
}

extract_prompt() {
  node - <<'NODE'
import fs from "node:fs";
const p = process.env.GITHUB_EVENT_PATH;
let data: any = {};
try { data = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
const body = String(data?.comment?.body ?? "").replace(/\r\n/g, "\n");
const patterns = [/@bigboss\b/i, /@bigbos\b/i, /\/bigboss\b/i];
let idx = -1;
let matchLen = 0;
for (const re of patterns) {
  const m = re.exec(body);
  if (!m || typeof m.index !== "number") continue;
  if (idx === -1 || m.index < idx) {
    idx = m.index;
    matchLen = m[0].length;
  }
}
if (idx === -1) process.exit(0);
const after = body.slice(idx + matchLen).trim();
process.stdout.write(after);
NODE
}

bigboss_issue_title() {
  if [ -n "${BIGBOSS_ISSUE_TITLE:-}" ]; then
    echo "${BIGBOSS_ISSUE_TITLE}"
    return 0
  fi
  # Back-compat: allow older env names, but default to a single reserved issue.
  if [ -n "${BIGBOSS_MEMORY_ISSUE_TITLE:-}" ]; then
    echo "${BIGBOSS_MEMORY_ISSUE_TITLE}"
    return 0
  fi
  if [ -n "${BIGBOSS_STATE_ISSUE_TITLE:-}" ]; then
    echo "${BIGBOSS_STATE_ISSUE_TITLE}"
    return 0
  fi
  echo "BigBoss"
}

bigboss_label() {
  echo "${BIGBOSS_MEMORY_LABEL:-BIGBOSS}"
}

ensure_label_exists() {
  local label="$1"
  if [ -z "${label:-}" ]; then
    return 1
  fi

  if gh api "repos/${GITHUB_REPOSITORY}/labels/${label}" >/dev/null 2>&1; then
    return 0
  fi

  # Create the label if missing (common root cause for issue creation failures).
  gh api -X POST "repos/${GITHUB_REPOSITORY}/labels" \
    -f name="$label" \
    -f color="0E8A16" \
    -f description="Bigboss bot internal label" \
    >/dev/null 2>&1 || true
}

find_issue_number_by_label_and_title() {
  local label="$1"
  local title="$2"

  local raw
  raw="$(gh_api_json "repos/${GITHUB_REPOSITORY}/issues" -F state=all -F per_page=100 -F labels="$label" || true)"
  if [ -z "$raw" ]; then
    echo ""
    return 0
  fi

  node - <<'NODE' "$raw" "$title"
const raw = process.argv[1] ?? "[]";
const wantTitle = process.argv[2] ?? "BigBoss";
let arr = [];
try { arr = JSON.parse(raw); } catch {}
if (!Array.isArray(arr)) process.exit(0);
// Prefer a real issue (not a PR) whose title matches.
const existing = arr.find((x) => !x?.pull_request && (x?.title ?? "") === wantTitle);
if (existing?.number) process.stdout.write(String(existing.number));
NODE
}

issue_has_label() {
  local issue_number="$1"
  local label="$2"
  gh api "repos/${GITHUB_REPOSITORY}/issues/${issue_number}" 2>/dev/null | node - <<'NODE' "$label"
const raw = require("node:fs").readFileSync(0, "utf8");
const label = process.argv[1] ?? "";
let j = {};
try { j = JSON.parse(raw); } catch {}
const labels = Array.isArray(j?.labels) ? j.labels : [];
const ok = labels.some((l) => (l?.name ?? "") === label);
process.stdout.write(ok ? "1" : "0");
NODE
}

issue_set_title() {
  local issue_number="$1"
  local title="$2"
  gh api -X PATCH "repos/${GITHUB_REPOSITORY}/issues/${issue_number}" -f title="$title" >/dev/null 2>&1 || true
}

issue_remove_label_if_present() {
  local issue_number="$1"
  local label="$2"
  gh api -X DELETE "repos/${GITHUB_REPOSITORY}/issues/${issue_number}/labels/${label}" >/dev/null 2>&1 || true
}

issue_add_label() {
  local issue_number="$1"
  local label="$2"
  gh api -X POST "repos/${GITHUB_REPOSITORY}/issues/${issue_number}/labels" -f "labels[]=${label}" >/dev/null 2>&1 || true
}

normalize_bigboss_reserved_issue() {
  # Goal:
  # - keep exactly one reserved issue for BigBoss
  # - ensure it has title "BigBoss" and label BIGBOSS
  # - remove BIGBOSS/BOSSS labels from any extra issues (so they’re not “reserved” anymore)
  local title
  title="$(bigboss_issue_title)"
  local label
  label="$(bigboss_label)"
  local legacy_label="BOSSS"
  local canonical_title="BigBoss"

  # If someone configured a different title, we still normalize duplicates by label,
  # but the canonical reserved thread name should remain stable for humans.
  if [ -n "${title:-}" ]; then
    canonical_title="$title"
  fi

  local primary=""

  # Prefer exact match on the new label + canonical title.
  primary="$(find_issue_number_by_label_and_title "$label" "$canonical_title")"

  # If not found, try to adopt one of the legacy titles under new label.
  if ! [[ "${primary:-}" =~ ^[0-9]+$ ]]; then
    primary="$(find_issue_number_by_label_and_title "$label" "BigBoss Memory")"
  fi
  if ! [[ "${primary:-}" =~ ^[0-9]+$ ]]; then
    primary="$(find_issue_number_by_label_and_title "$label" "BigBoss State")"
  fi

  # If still not found, try legacy label + any of the known titles.
  if ! [[ "${primary:-}" =~ ^[0-9]+$ ]]; then
    primary="$(find_issue_number_by_label_and_title "$legacy_label" "$canonical_title")"
  fi
  if ! [[ "${primary:-}" =~ ^[0-9]+$ ]]; then
    primary="$(find_issue_number_by_label_and_title "$legacy_label" "BigBoss Memory")"
  fi
  if ! [[ "${primary:-}" =~ ^[0-9]+$ ]]; then
    primary="$(find_issue_number_by_label_and_title "$legacy_label" "BigBoss State")"
  fi

  if ! [[ "${primary:-}" =~ ^[0-9]+$ ]]; then
    # Nothing to normalize yet.
    return 0
  fi

  ensure_label_exists "$label"

  # Make the primary the canonical reserved issue.
  issue_set_title "$primary" "$canonical_title"
  issue_add_label "$primary" "$label"
  issue_remove_label_if_present "$primary" "$legacy_label"

  # Remove reserved labels from any other issues so only one remains “reserved”.
  # This is best-effort; if listing fails, we simply won't de-label extras.
  for lbl in "$label" "$legacy_label"; do
    raw="$(gh_api_json "repos/${GITHUB_REPOSITORY}/issues" -F state=all -F per_page=100 -F labels="$lbl" || true)"
    if [ -z "${raw:-}" ]; then
      continue
    fi

    extras="$(node - <<'NODE' "$raw" "$primary"
const raw = process.argv[1] ?? "[]";
const primary = String(process.argv[2] ?? "");
let arr = [];
try { arr = JSON.parse(raw); } catch {}
if (!Array.isArray(arr)) process.exit(0);
const out = arr
  .filter((x) => !x?.pull_request)
  .map((x) => String(x?.number ?? ""))
  .filter((n) => n && n !== primary);
process.stdout.write(out.join(" "));
NODE
)"

    for n in ${extras:-}; do
      issue_remove_label_if_present "$n" "$label"
      issue_remove_label_if_present "$n" "$legacy_label"
    done
  done
}

ensure_bigboss_issue_number() {
  local title="$1"
  local label
  label="$(bigboss_label)"
  local legacy_label="BOSSS"

  # Before selecting/creating, normalize duplicates (best-effort).
  normalize_bigboss_reserved_issue || true

  local n
  n="$(find_issue_number_by_label_and_title "$label" "$title")"
  if [[ "${n:-}" =~ ^[0-9]+$ ]]; then
    echo "$n"
    return 0
  fi

  # Migration: if we used to store memory under BOSSS, adopt that issue and move it to the new label.
  if [ "$label" != "$legacy_label" ]; then
    local legacy
    legacy="$(find_issue_number_by_label_and_title "$legacy_label" "$title")"
    if [[ "${legacy:-}" =~ ^[0-9]+$ ]]; then
      ensure_label_exists "$label"
      gh api -X POST "repos/${GITHUB_REPOSITORY}/issues/${legacy}/labels" -f "labels[]=${label}" >/dev/null 2>&1 || true
      gh api -X DELETE "repos/${GITHUB_REPOSITORY}/issues/${legacy}/labels/${legacy_label}" >/dev/null 2>&1 || true
      # Align title to the configured canonical title (best-effort).
      issue_set_title "$legacy" "$title"
      echo "$legacy"
      return 0
    fi
  fi

  echo ""
}

create_bigboss_issue() {
  local title="$1"
  local body="$2"
  local label
  label="$(bigboss_label)"

  ensure_label_exists "$label"

  local out
  out="$(gh api -X POST "repos/${GITHUB_REPOSITORY}/issues" -f title="$title" -f body="$body" -f "labels[]=$label" 2>/dev/null || true)"
  node - <<'NODE' "$out"
try {
  const j = JSON.parse(process.argv[1] ?? "");
  if (j?.number) process.stdout.write(String(j.number));
} catch {}
NODE
}

ensure_state_issue_number() {
  ensure_bigboss_issue_number "$(bigboss_issue_title)"
}

create_state_issue() {
  create_bigboss_issue "$(bigboss_issue_title)" "$1"
}

ensure_memory_issue_number() {
  ensure_bigboss_issue_number "$(bigboss_issue_title)"
}

create_memory_issue() {
  create_bigboss_issue "$(bigboss_issue_title)" "$1"
}

post_notice() {
  local msg="$1"

  local kind="" number=""
  eval "$(detect_notify_target || true)"
  kind="${BIGBOSS_NOTIFY_KIND:-}"
  number="${BIGBOSS_NOTIFY_NUMBER:-}"

  if [ -z "$kind" ] || [ -z "$number" ]; then
    # No thread context (e.g. cron). Post to the single BigBoss issue.
    local state
    state="$(ensure_state_issue_number)"
    if [[ "$state" =~ ^[0-9]+$ ]]; then
      kind="issue"
      number="$state"
    else
      local created
      created="$(create_state_issue "$msg")"
      if [[ "$created" =~ ^[0-9]+$ ]]; then
        kind="issue"
        number="$created"
      fi
    fi
  fi

  if [ -z "$kind" ] || [ -z "$number" ]; then
    echo "WARN: could not determine a place to report (no issue/PR/discussion context)."
    echo "$msg"
    return 0
  fi

  if [ "$kind" = "issue" ]; then
    if ! gh api -X POST "repos/${GITHUB_REPOSITORY}/issues/${number}/comments" -f body="$msg" >/dev/null 2>&1; then
      echo "WARN: failed to post notice via GitHub API (check token/permissions)."
      echo "$msg"
    fi
    return 0
  fi
}

if [ "${#missing[@]}" -gt 0 ]; then
  missing_lines=""
  for m in "${missing[@]}"; do
    missing_lines+="- **Missing**: \`${m}\`\n"
  done

  notice="$(cat <<EOF
### BigBoss setup: missing secrets

I can run in **minimal mode**, but some capabilities are disabled until these are configured:

$missing_lines

Notes:
- This repo’s OpenAPI MCP wrapper reads \`CURSOR_API_KEY\`. In Actions we also accept \`CURSOR_CLOUD_API_KEY\` and map it automatically.
- If you only want schema checks, secrets are optional; if you want real Cursor Cloud API calls, the Cursor key is required.
EOF
)"
  # Interpret "\n" sequences we added in missing_lines.
  notice="$(printf "%b" "$notice")"
  post_notice "$notice"
fi

PROMPT="$(extract_prompt || true)"

if [ -z "${PROMPT:-}" ] && [ "${GITHUB_EVENT_NAME:-}" = "workflow_dispatch" ]; then
  PROMPT="$(read_dispatch_prompt || true)"
fi

if [ -z "${PROMPT:-}" ] && [ "${GITHUB_EVENT_NAME:-}" != "workflow_dispatch" ]; then
  # Mention without any prompt text; do not spam.
  exit 0
fi

post_reply() {
  local msg="$1"
  post_notice "$msg"
}

memory_fetch_tail() {
  local issue_number="$1"
  local limit="${2:-8}"
  local raw
  raw="$(gh_api_json "repos/${GITHUB_REPOSITORY}/issues/${issue_number}/comments" -F per_page=100 || true)"
  if [ -z "$raw" ]; then
    echo ""
    return 0
  fi
  node - <<'NODE' "$raw" "$limit"
const raw = process.argv[1] ?? "[]";
const limit = Number(process.argv[2] ?? "8");
let arr: any[] = [];
try { arr = JSON.parse(raw); } catch {}
if (!Array.isArray(arr) || !arr.length) process.exit(0);
// Sort by created_at (oldest->newest) then take tail.
arr.sort((a,b) => String(a?.created_at ?? "").localeCompare(String(b?.created_at ?? "")));
const tail = arr.slice(Math.max(0, arr.length - Math.max(1, limit)));
const out = tail
  .map((c) => String(c?.body ?? "").trim())
  .filter(Boolean)
  .join("\n\n---\n\n");
process.stdout.write(out);
NODE
}

memory_append() {
  local issue_number="$1"
  local body="$2"
  gh api -X POST "repos/${GITHUB_REPOSITORY}/issues/${issue_number}/comments" -f body="$body" >/dev/null || true
}

gh_search_total_count() {
  # Prints a single integer total_count on success, otherwise prints nothing.
  local query="$1"
  local out status
  set +e
  out="$(gh api -X GET "search/issues" -f q="$query" 2>&1)"
  status=$?
  set -e
  if [ $status -ne 0 ]; then
    echo "WARN: gh search failed (exit=$status) for query: $query" >&2
    echo "$out" | head -c 2000 >&2 || true
    echo >&2
    return 1
  fi
  node - <<'NODE' "$out"
try {
  const j = JSON.parse(process.argv[1] ?? "{}");
  const n = Number(j?.total_count);
  if (Number.isFinite(n) && n >= 0) process.stdout.write(String(n));
} catch {}
NODE
}

cursor_api_create_agent() {
  local prompt_text="$1"
  local repo_url="https://github.com/${GITHUB_REPOSITORY}"
  local payload
  payload="$(node - <<'NODE' "$prompt_text" "$repo_url"
const promptText = process.argv[1] ?? "";
const repoUrl = process.argv[2] ?? "";
const out = {
  prompt: { text: promptText },
  source: { repository: repoUrl },
  target: { autoCreatePr: false },
};
process.stdout.write(JSON.stringify(out));
NODE
)"
  cursor_api_request POST "https://api.cursor.com/v0/agents" "$payload"
}

cursor_api_get_conversation() {
  local agent_id="$1"
  cursor_api_request GET "https://api.cursor.com/v0/agents/${agent_id}/conversation" ""
}

CURSOR_LAST_HTTP_CODE=""
CURSOR_LAST_CURL_EXIT=0

cursor_api_request() {
  local method="$1"
  local url="$2"
  local data="${3:-}"

  local tmp_body tmp_headers
  tmp_body="$(mktemp)"
  tmp_headers="$(mktemp)"

  local curl_args=(
    -sS
    -X "$method"
    "$url"
    -H "Authorization: Bearer ${CURSOR_API_KEY}"
    -H "Content-Type: application/json"
    -D "$tmp_headers"
    -o "$tmp_body"
  )
  if [ -n "${data:-}" ]; then
    curl_args+=(--data "$data")
  fi

  set +e
  curl "${curl_args[@]}"
  CURSOR_LAST_CURL_EXIT=$?
  set -e

  CURSOR_LAST_HTTP_CODE="$(awk 'BEGIN{code=""} /^HTTP\//{code=$2} END{print code}' "$tmp_headers" 2>/dev/null || true)"
  local body
  body="$(cat "$tmp_body" 2>/dev/null || true)"

  rm -f "$tmp_body" "$tmp_headers" 2>/dev/null || true

  # Success: HTTP 2xx and curl exit 0.
  if [ "${CURSOR_LAST_CURL_EXIT:-1}" -eq 0 ] && [[ "${CURSOR_LAST_HTTP_CODE:-}" =~ ^2[0-9][0-9]$ ]]; then
    printf "%s" "$body"
    return 0
  fi

  local redacted
  redacted="$(redact_secrets "$body")"
  redacted="$(printf "%s" "$redacted" | head -c 4000)"

  echo "ERROR: Cursor API request failed: ${method} ${url}" >&2
  echo "  curl_exit : ${CURSOR_LAST_CURL_EXIT:-unknown}" >&2
  echo "  http_code : ${CURSOR_LAST_HTTP_CODE:-unknown}" >&2
  if [ -n "${redacted:-}" ]; then
    echo "  body (truncated):" >&2
    printf "%s\n" "$redacted" >&2
  fi
  return 1
}

cursor_extract_first_assistant_message() {
  node - <<'NODE'
import fs from "node:fs";
const raw = fs.readFileSync(0, "utf8");
let j: any = {};
try { j = JSON.parse(raw); } catch { process.exit(0); }
const msgs = Array.isArray(j?.messages) ? j.messages : [];
const first = msgs.find((m: any) => m?.type === "assistant_message" && typeof m?.text === "string" && m.text.trim());
if (first?.text) process.stdout.write(String(first.text).trim());
NODE
}

cursor_extract_agent_meta() {
  node - <<'NODE'
import fs from "node:fs";
const raw = fs.readFileSync(0, "utf8");
let j: any = {};
try { j = JSON.parse(raw); } catch { process.exit(0); }
const id = typeof j?.id === "string" ? j.id : "";
const url = typeof j?.target?.url === "string" ? j.target.url : "";
process.stdout.write(JSON.stringify({ id, url }));
NODE
}

echo
echo "== Self-checks (Cursor CLI, GH, MCP OpenAPI) =="

if [ "${BIGBOSS_RUN_SELF_CHECK:-0}" = "1" ]; then
  export AGNET_SELF_CHECK_REQUIRE_GITHUB="1"
  export AGNET_SELF_CHECK_REQUIRE_CURSOR_CLI="1"
  export AGNET_SELF_CHECK_REQUIRE_CURSOR_API="0"

  set +e
  selfcheck_out="$(node scripts/agnet.ts --json selfcheck)"
  selfcheck_status=$?
  set -e

  if [ $selfcheck_status -ne 0 ] || [ -z "${selfcheck_out:-}" ]; then
    post_notice "$(cat <<'EOF'
### BigBoss self-check failed

The workflow could not complete its environment checks (Cursor CLI / MCP / GitHub).

Please open the workflow logs and fix the failing step; BigBoss will not proceed.
EOF
)"
    exit 1
  fi

  echo "$selfcheck_out"

  # If Cursor key is missing, selfcheck will mark cursor.api.models as skipped; explicitly report it.
  cursor_api_skipped="$(node - <<'NODE' "$selfcheck_out"
try {
  const j = JSON.parse(process.argv[1] ?? "{}");
  const checks = Array.isArray(j?.checks) ? j.checks : [];
  const c = checks.find((x) => x?.name === "cursor.api.models");
  if (c && c.ok === false && c.skipped === true) process.stdout.write("1");
} catch {}
NODE
)"

  if [ "$cursor_api_skipped" = "1" ]; then
    post_notice "$(cat <<'EOF'
### BigBoss: Cursor Cloud API key missing

OpenAPI MCP schema checks are OK, but real Cursor Cloud API calls are skipped because no API key was provided.

- **Fix**: set repo secret `CURSOR_CLOUD_API_KEY` (preferred) or `CURSOR_API_KEY`
EOF
)"
  fi
else
  echo "Self-checks: skipped (set BIGBOSS_RUN_SELF_CHECK=1 to enable)."
fi

if [ -n "${PROMPT:-}" ]; then
  # Ensure the single reserved BigBoss issue exists (for memory + state).
  memory_error=""
  mem_number="$(ensure_memory_issue_number)"
  if ! [[ "${mem_number:-}" =~ ^[0-9]+$ ]]; then
    mem_number="$(create_memory_issue "BigBoss bot thread (auto-created). This stores a lightweight memory log between runs." )"
  fi

  if ! [[ "${mem_number:-}" =~ ^[0-9]+$ ]]; then
    memory_error="I could not create/find the memory issue (label \`$(bigboss_label)\`)."
    mem_tail=""
  else
    mem_tail="$(memory_fetch_tail "$mem_number" 8)"
  fi

  # Optional: if the user asks about issue counts, fetch them via GH API so BigBoss can answer accurately.
  repo_stats=""
  if echo "${PROMPT:-}" | grep -Eqi '\bhow many issues\b|\bissues do you see\b'; then
    total_issues="$(gh_search_total_count "repo:${GITHUB_REPOSITORY} type:issue" || true)"
    open_issues="$(gh_search_total_count "repo:${GITHUB_REPOSITORY} type:issue state:open" || true)"
    if [[ "${total_issues:-}" =~ ^[0-9]+$ ]]; then
      repo_stats="Repo issue counts (via GitHub API): total=${total_issues}"
      if [[ "${open_issues:-}" =~ ^[0-9]+$ ]]; then
        repo_stats+=", open=${open_issues}"
      fi
    else
      repo_stats="Repo issue counts: unavailable (GitHub API query failed; see workflow logs)."
    fi
  fi

  full_prompt="$(cat <<EOF
You are BigBoss, an AI assistant for the GitHub repo https://github.com/${GITHUB_REPOSITORY}.

Constraints:
- Reply directly and concisely.
- Do not merge/approve PRs unless explicitly asked.

${repo_stats:+${repo_stats}

}
Persistent memory (latest entries):
${mem_tail:-"(none)"}

User message:
${PROMPT}
EOF
)"

  post_reply "Acknowledged — thinking…"

  if [ -z "${CURSOR_API_KEY:-}" ]; then
    post_reply "Missing \`CURSOR_CLOUD_API_KEY\` (or \`CURSOR_API_KEY\`). I can’t answer via Cursor Cloud Agents until it’s set."
    exit 1
  fi

  if ! created_json="$(cursor_api_create_agent "$full_prompt")"; then
    post_reply "$(cat <<EOF
Failed to create Cursor Cloud Agent.

- Cursor API HTTP: ${CURSOR_LAST_HTTP_CODE:-unknown}
- curl exit       : ${CURSOR_LAST_CURL_EXIT:-unknown}

(See workflow logs for the API error response.)
EOF
)"
    exit 1
  fi

  agent_meta="$(printf "%s" "$created_json" | cursor_extract_agent_meta)"
  agent_id="$(node -p 'JSON.parse(process.argv[1]).id' "$agent_meta" 2>/dev/null || true)"
  agent_url="$(node -p 'JSON.parse(process.argv[1]).url' "$agent_meta" 2>/dev/null || true)"

  if [ -z "${agent_id:-}" ]; then
    post_reply "Cursor agent was created, but I couldn’t read its id from the response."
    exit 1
  fi

  # Poll for an assistant message.
  reply_text=""
  for i in $(seq 1 24); do
    if conv_json="$(cursor_api_get_conversation "$agent_id")"; then
      reply_text="$(printf "%s" "$conv_json" | cursor_extract_first_assistant_message)"
      if [ -n "${reply_text:-}" ]; then
        break
      fi
    else
      echo "WARN: failed to poll Cursor agent conversation (attempt $i/24)." >&2
    fi
    sleep 5
  done

  if [ -z "${reply_text:-}" ]; then
    if [ -n "${memory_error:-}" ]; then
      post_reply "$(cat <<EOF
I started a Cursor Cloud Agent, but it hasn’t produced a message yet.

- Agent: ${agent_url:-"(no url provided)"}

---

Memory error: ${memory_error}
EOF
)"
    else
      post_reply "$(cat <<EOF
I started a Cursor Cloud Agent, but it hasn’t produced a message yet.

- Agent: ${agent_url:-"(no url provided)"}
EOF
)"
    fi
  else
    if [ -n "${memory_error:-}" ]; then
      post_reply "$(cat <<EOF
${reply_text}

---

Memory error: ${memory_error}
EOF
)"
    else
      post_reply "$reply_text"
    fi

    if [[ "${mem_number:-}" =~ ^[0-9]+$ ]]; then
      memory_append "$mem_number" "$(cat <<EOF
**${GITHUB_ACTOR}**: ${PROMPT}

**bigboss**: ${reply_text}
EOF
)"
    fi
  fi
fi

echo
echo "== BigBoss done (minimal) =="

