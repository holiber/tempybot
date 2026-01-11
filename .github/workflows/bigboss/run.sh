#!/usr/bin/env bash
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-"$(pwd)"}"
cd "$ROOT"

echo "== BigBoss boot =="
echo "Actor: ${GITHUB_ACTOR:-unknown}"
echo "Repo : ${GITHUB_REPOSITORY:-unknown}"
echo "Event: ${GITHUB_EVENT_NAME:-unknown}"
echo "SHA  : ${GITHUB_SHA:-unknown}"

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

should_wake_up() {
  # Minimal gate:
  # - wake if comment body mentions @bigboss or /bigboss or contains /do
  # - also wake on schedule/workflow_dispatch where there may be no comment body
  local event="${GITHUB_EVENT_NAME:-}"
  if [ "$event" = "schedule" ] || [ "$event" = "workflow_dispatch" ]; then
    return 0
  fi
  if echo "${BODY:-}" | grep -Eqi '(^|\s)(/bigboss|@bigboss)\b|/do\b'; then
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
  } else if (data.discussion?.number) {
    kind = "discussion";
    number = String(data.discussion.number);
  } else if (data.review?.pull_request_url) {
    // Not implemented: map review comment to PR number.
  }
}
if (kind && number) {
  process.stdout.write(`BIGBOSS_NOTIFY_KIND=${kind}\nBIGBOSS_NOTIFY_NUMBER=${number}\n`);
}
NODE
}

ensure_state_discussion_number() {
  local title="${BIGBOSS_STATE_DISCUSSION_TITLE:-BigBoss State}"
  local owner repo
  owner="${GITHUB_REPOSITORY%/*}"
  repo="${GITHUB_REPOSITORY#*/}"

  local q out
  q='query($owner:String!,$name:String!){
    repository(owner:$owner,name:$name){
      id
      discussionCategories(first:20){ nodes { id name } }
      discussions(first:50, orderBy:{field:UPDATED_AT,direction:DESC}){ nodes { title number } }
    }
  }'
  out="$(gh api graphql -f query="$q" -f owner="$owner" -f name="$repo" 2>/dev/null || true)"
  if [ -z "$out" ]; then
    echo ""
    return 0
  fi

  node - <<'NODE' "$out" "$title"
const raw = process.argv[1] ?? "";
const wantTitle = process.argv[2] ?? "BigBoss State";
let data;
try { data = JSON.parse(raw); } catch { process.stdout.write(""); process.exit(0); }
const repo = data?.data?.repository;
const discussions = Array.isArray(repo?.discussions?.nodes) ? repo.discussions.nodes : [];
const existing = discussions.find((d) => (d?.title ?? "") === wantTitle);
if (existing?.number) {
  process.stdout.write(String(existing.number));
  process.exit(0);
}
const categories = Array.isArray(repo?.discussionCategories?.nodes) ? repo.discussionCategories.nodes : [];
const cat = categories.find((c) => (c?.name ?? "").toLowerCase() === "general") ?? categories[0];
if (!repo?.id || !cat?.id) {
  process.stdout.write("");
  process.exit(0);
}
process.stdout.write(JSON.stringify({ repositoryId: repo.id, categoryId: cat.id }));
NODE
}

create_state_discussion() {
  local title="${BIGBOSS_STATE_DISCUSSION_TITLE:-BigBoss State}"
  local body="$1"
  local meta="$2" # JSON: { repositoryId, categoryId }

  if [ -z "$meta" ]; then
    echo ""
    return 0
  fi

  local repositoryId categoryId
  repositoryId="$(node -p 'JSON.parse(process.argv[1]).repositoryId' "$meta" 2>/dev/null || true)"
  categoryId="$(node -p 'JSON.parse(process.argv[1]).categoryId' "$meta" 2>/dev/null || true)"
  if [ -z "$repositoryId" ] || [ -z "$categoryId" ]; then
    echo ""
    return 0
  fi

  local m out
  m='mutation($repositoryId:ID!,$categoryId:ID!,$title:String!,$body:String!){
    createDiscussion(input:{repositoryId:$repositoryId,categoryId:$categoryId,title:$title,body:$body}){
      discussion{ number }
    }
  }'
  out="$(gh api graphql -f query="$m" -f repositoryId="$repositoryId" -f categoryId="$categoryId" -f title="$title" -f body="$body" 2>/dev/null || true)"
  node - <<'NODE' "$out"
try {
  const j = JSON.parse(process.argv[1] ?? "");
  const n = j?.data?.createDiscussion?.discussion?.number;
  if (n) process.stdout.write(String(n));
} catch {}
NODE
}

post_notice() {
  local msg="$1"

  local kind="" number=""
  eval "$(detect_notify_target || true)"
  kind="${BIGBOSS_NOTIFY_KIND:-}"
  number="${BIGBOSS_NOTIFY_NUMBER:-}"

  if [ -z "$kind" ] || [ -z "$number" ]; then
    # No thread context (e.g. cron). Post to state discussion.
    local state
    state="$(ensure_state_discussion_number)"
    if [[ "$state" =~ ^[0-9]+$ ]]; then
      kind="discussion"
      number="$state"
    else
      # state contains repo/category ids for creation
      local created
      created="$(create_state_discussion "$msg" "$state")"
      if [[ "$created" =~ ^[0-9]+$ ]]; then
        kind="discussion"
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
    gh api -X POST "repos/${GITHUB_REPOSITORY}/issues/${number}/comments" -f body="$msg" >/dev/null || true
    return 0
  fi
  if [ "$kind" = "discussion" ]; then
    gh api -X POST "repos/${GITHUB_REPOSITORY}/discussions/${number}/comments" -f body="$msg" >/dev/null || true
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

echo
echo "== Self-checks (Cursor CLI, GH, MCP OpenAPI) =="

export AGNET_SELF_CHECK_REQUIRE_GITHUB="1"
export AGNET_SELF_CHECK_REQUIRE_CURSOR_CLI="1"
export AGNET_SELF_CHECK_REQUIRE_CURSOR_API="0"

set +e
selfcheck_out="$(node scripts/agnet.ts --json selfcheck 2>/dev/null)"
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

echo
echo "== BigBoss done (minimal) =="

