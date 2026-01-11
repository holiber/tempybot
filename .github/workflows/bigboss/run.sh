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
  } else if (data.discussion?.number) {
    kind = "discussion";
    number = String(data.discussion.number);
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

ensure_memory_discussion_number() {
  local title="${BIGBOSS_MEMORY_DISCUSSION_TITLE:-BigBoss Memory}"
  BIGBOSS_STATE_DISCUSSION_TITLE="$title" ensure_state_discussion_number
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

PROMPT="$(extract_prompt || true)"

if [ -z "${PROMPT:-}" ] && [ "${GITHUB_EVENT_NAME:-}" != "workflow_dispatch" ]; then
  # Mention without any prompt text; do not spam.
  exit 0
fi

post_reply() {
  local msg="$1"
  post_notice "$msg"
}

memory_fetch_tail() {
  local discussion_number="$1"
  local limit="${2:-8}"
  local raw
  raw="$(gh api "repos/${GITHUB_REPOSITORY}/discussions/${discussion_number}/comments" -F per_page=100 2>/dev/null || true)"
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
  local discussion_number="$1"
  local body="$2"
  gh api -X POST "repos/${GITHUB_REPOSITORY}/discussions/${discussion_number}/comments" -f body="$body" >/dev/null || true
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
  curl -fsS "https://api.cursor.com/v0/agents" \
    -H "Authorization: Bearer ${CURSOR_API_KEY}" \
    -H "Content-Type: application/json" \
    --data "$payload"
}

cursor_api_get_conversation() {
  local agent_id="$1"
  curl -fsS "https://api.cursor.com/v0/agents/${agent_id}/conversation" \
    -H "Authorization: Bearer ${CURSOR_API_KEY}" \
    -H "Content-Type: application/json"
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

if [ -n "${PROMPT:-}" ]; then
  # Ensure memory discussion exists (and fail loudly if Discussions are disabled).
  mem_meta="$(ensure_memory_discussion_number)"
  if [[ "$mem_meta" =~ ^[0-9]+$ ]]; then
    mem_number="$mem_meta"
  else
    # `ensure_state_discussion_number` returns JSON when discussion is absent.
    mem_number="$(create_state_discussion "BigBoss memory thread (auto-created). This stores a lightweight memory log between runs." "$mem_meta")"
  fi

  if ! [[ "${mem_number:-}" =~ ^[0-9]+$ ]]; then
    post_reply "$(cat <<'EOF'
### BigBoss setup: Discussions are required

I was summoned, but I cannot persist memory because **GitHub Discussions** are disabled (or not accessible to the workflow token).

- **Fix**: enable Discussions in repository settings
EOF
)"
    exit 1
  fi

  mem_tail="$(memory_fetch_tail "$mem_number" 8)"

  full_prompt="$(cat <<EOF
You are BigBoss, an AI assistant for the GitHub repo https://github.com/${GITHUB_REPOSITORY}.

Constraints:
- Reply directly and concisely.
- Do not merge/approve PRs unless explicitly asked.

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

  set +e
  created_json="$(cursor_api_create_agent "$full_prompt" 2>/dev/null)"
  curl_status=$?
  set -e

  if [ $curl_status -ne 0 ] || [ -z "${created_json:-}" ]; then
    post_reply "Failed to create Cursor Cloud Agent (check that \`CURSOR_CLOUD_API_KEY\` is valid and the API is reachable)."
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
    set +e
    conv_json="$(cursor_api_get_conversation "$agent_id" 2>/dev/null)"
    conv_status=$?
    set -e
    if [ $conv_status -eq 0 ] && [ -n "${conv_json:-}" ]; then
      reply_text="$(printf "%s" "$conv_json" | cursor_extract_first_assistant_message)"
      if [ -n "${reply_text:-}" ]; then
        break
      fi
    fi
    sleep 5
  done

  if [ -z "${reply_text:-}" ]; then
    post_reply "$(cat <<EOF
I started a Cursor Cloud Agent, but it hasn’t produced a message yet.

- Agent: ${agent_url:-"(no url provided)"}
EOF
)"
  else
    post_reply "$reply_text"
    memory_append "$mem_number" "$(cat <<EOF
**${GITHUB_ACTOR}**: ${PROMPT}

**bigboss**: ${reply_text}
EOF
)"
  fi
fi

echo
echo "== BigBoss done (minimal) =="

