import fs from "node:fs/promises";
import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import { toString } from "mdast-util-to-string";
import YAML from "yaml";
import type { Root, Content, Heading, Paragraph } from "mdast";
import type { AgentAbilities, AgentCommand, AgentDefinition, AgentStatus, McpServersConfig } from "./types.ts";
import { AGENT_DEFINITION_DEFAULTS } from "./types.ts";

type Frontmatter = Record<string, unknown>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getTopLevelKeyCaseInsensitive(obj: Record<string, unknown>, key: string): unknown {
  const keyLc = key.toLowerCase();
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === keyLc) return v;
  }
  return undefined;
}

function normalizeComparableText(s: string): string {
  return s.trim().toLowerCase();
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalPathRef(s: string): boolean {
  // Policy examples use explicit relative paths (./...) and may also reference absolute paths.
  return s.startsWith("./") || s.startsWith("../") || s.startsWith("/");
}

function findMatchingClosingBrace(js: string, openBraceIdx: number): number | undefined {
  if (openBraceIdx < 0 || openBraceIdx >= js.length) return undefined;
  if (js[openBraceIdx] !== "{") return undefined;

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;

  for (let i = openBraceIdx; i < js.length; i++) {
    const ch = js[i]!;
    const next = js[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inSingle) {
      if (!escape && ch === "'") inSingle = false;
      escape = !escape && ch === "\\";
      continue;
    }
    if (inDouble) {
      if (!escape && ch === '"') inDouble = false;
      escape = !escape && ch === "\\";
      continue;
    }
    if (inTemplate) {
      if (!escape && ch === "`") inTemplate = false;
      escape = !escape && ch === "\\";
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return undefined;
}

function extractFirstJsonObjectFromJs(text: string): unknown {
  const open = text.indexOf("{");
  if (open === -1) return null;
  const close = findMatchingClosingBrace(text, open);
  if (close === undefined) return null;
  const snippet = text.slice(open, close + 1);
  try {
    return JSON.parse(snippet) as unknown;
  } catch {
    // Not strict JSON (could be JS object literal). Treat as raw string.
    return snippet;
  }
}

function getStringStrict(opts: { key: string; v: unknown; allowEmpty?: boolean }): string | undefined {
  const { key, v, allowEmpty = false } = opts;
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`Invalid frontmatter '${key}': expected string.`);
  if (!allowEmpty && v.trim().length === 0) {
    throw new Error(`Invalid frontmatter '${key}': must be a non-empty string.`);
  }
  return v;
}

function getStringArrayStrict(key: string, v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new Error(`Invalid frontmatter '${key}': expected string[].`);
  const out: string[] = [];
  for (let i = 0; i < v.length; i++) {
    const item = v[i];
    if (typeof item !== "string") throw new Error(`Invalid frontmatter '${key}[${i}]': expected string.`);
    if (item.trim().length === 0) throw new Error(`Invalid frontmatter '${key}[${i}]': string must be non-empty.`);
    out.push(item);
  }
  return out;
}

function normalizeAbilityList(input: string[] | undefined): string[] | undefined {
  if (!input) return undefined;
  const out = input.map((s) => s.trim()).filter(Boolean).map((s) => s.toLowerCase());
  return out.length ? out : undefined;
}

function parseAbilities(v: unknown): AgentAbilities | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isPlainObject(v)) throw new Error(`Invalid frontmatter 'abilities': expected object.`);

  const allowRaw = getTopLevelKeyCaseInsensitive(v, "allow");
  const denyRaw = getTopLevelKeyCaseInsensitive(v, "deny");
  const allow = normalizeAbilityList(getStringArrayStrict("abilities.allow", allowRaw));
  const deny = normalizeAbilityList(getStringArrayStrict("abilities.deny", denyRaw));

  const out: AgentAbilities = { ...v };
  if (allow) out.allow = allow;
  if (deny) out.deny = deny;
  return out;
}

function parseCommands(v: unknown): AgentCommand[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error(`Invalid frontmatter 'commands': expected array.`);
  if (v.length === 0) throw new Error(`Invalid frontmatter 'commands': must not be an empty array (omit it or provide entries).`);
  for (let i = 0; i < v.length; i++) {
    const item = v[i];
    if (typeof item === "string") {
      if (!item.trim()) throw new Error(`Invalid frontmatter 'commands[${i}]': string must be non-empty.`);
      continue;
    }
    if (!isPlainObject(item)) throw new Error(`Invalid frontmatter 'commands[${i}]': expected string or object.`);
    const name = getStringStrict({ key: `commands[${i}].name`, v: (item as any).name });
    const description = getStringStrict({ key: `commands[${i}].description`, v: (item as any).description });
    const body = getStringStrict({ key: `commands[${i}].body`, v: (item as any).body });
    if (!name) throw new Error(`Invalid frontmatter 'commands[${i}].name': expected a non-empty string.`);
    if (!description) throw new Error(`Invalid frontmatter 'commands[${i}].description': expected a non-empty string.`);
    if (!body) throw new Error(`Invalid frontmatter 'commands[${i}].body': expected a non-empty string.`);
  }
  return v as AgentCommand[];
}

function parseMcpServers(v: unknown): McpServersConfig | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isPlainObject(v)) throw new Error(`Invalid frontmatter 'mcpServers': expected object.`);
  const out: McpServersConfig = {};
  for (const [serverName, conf] of Object.entries(v)) {
    if (!serverName.trim()) throw new Error(`Invalid frontmatter 'mcpServers': server name must be non-empty.`);
    if (!isPlainObject(conf)) throw new Error(`Invalid frontmatter 'mcpServers.${serverName}': expected object.`);
    const command = getStringStrict({ key: `mcpServers.${serverName}.command`, v: (conf as any).command });
    if (!command) throw new Error(`Invalid frontmatter 'mcpServers.${serverName}.command': must be a non-empty string.`);
    const args = getStringArrayStrict(`mcpServers.${serverName}.args`, (conf as any).args);
    const envRaw = (conf as any).env;
    let env: Record<string, string> | undefined;
    if (envRaw !== undefined && envRaw !== null) {
      if (!isPlainObject(envRaw)) throw new Error(`Invalid frontmatter 'mcpServers.${serverName}.env': expected object.`);
      env = {};
      for (const [k, vv] of Object.entries(envRaw)) {
        if (!k.trim()) throw new Error(`Invalid frontmatter 'mcpServers.${serverName}.env': keys must be non-empty strings.`);
        if (typeof vv !== "string" || !vv.trim()) {
          throw new Error(`Invalid frontmatter 'mcpServers.${serverName}.env.${k}': expected non-empty string.`);
        }
        env[k] = vv;
      }
    }
    const cwd = getStringStrict({ key: `mcpServers.${serverName}.cwd`, v: (conf as any).cwd, allowEmpty: false });
    out[serverName] = { command, ...(args ? { args } : {}), ...(env ? { env } : {}), ...(cwd ? { cwd } : {}) };
  }
  return out;
}

function isHeading(node: Content): node is Heading {
  return node.type === "heading";
}

function isParagraph(node: Content): node is Paragraph {
  return node.type === "paragraph";
}

function headingText(node: Heading): string {
  return normalizeComparableText(toString(node));
}

function takeSectionText(tree: Root, headingName: string): string {
  const nodes = tree.children;
  const wanted = normalizeComparableText(headingName);
  let startIdx = -1;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (isHeading(n) && headingText(n) === wanted) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return "";
  const out: string[] = [];
  for (let i = startIdx + 1; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (isHeading(n)) break;
    out.push(toString(n as any));
  }
  return out.join("\n").trim();
}

function extractTitleFromH1(tree: Root): string | undefined {
  const first = tree.children.find((n) => isHeading(n) && (n as Heading).depth === 1) as Heading | undefined;
  if (!first) return undefined;
  const t = toString(first).trim();
  return t || undefined;
}

function extractDescriptionFromFirstParagraph(tree: Root): string | undefined {
  for (const node of tree.children) {
    if (isHeading(node)) continue;
    if (isParagraph(node)) {
      const t = toString(node).trim();
      return t || undefined;
    }
  }
  return undefined;
}

function pickAgentStatus(v: unknown): AgentStatus | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`Invalid frontmatter 'status': expected string.`);
  const s = v.trim().toLowerCase();
  if (s === "active" || s === "deprecated" || s === "disabled") return s as AgentStatus;
  throw new Error(`Invalid frontmatter 'status': expected one of active|deprecated|disabled.`);
}

function parseAvatar(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`Invalid frontmatter 'avatar': expected string.`);
  const s = v.trim();
  if (!s) throw new Error(`Invalid frontmatter 'avatar': must be non-empty if provided.`);
  if (!(isHttpUrl(s) || isLocalPathRef(s))) {
    throw new Error(`Invalid frontmatter 'avatar': must be a URL (http/https) or a local path ref (./, ../, /).`);
  }
  return s;
}

function parseIcon(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`Invalid frontmatter 'icon': expected string.`);
  const s = v.trim();
  if (!s) throw new Error(`Invalid frontmatter 'icon': must be non-empty if provided.`);
  return s;
}

export function agentTemplateToJson(markdown: string): AgentDefinition {
  const { data, content } = matter(markdown);
  const fm = isPlainObject(data) ? (data as Frontmatter) : ({} as Frontmatter);

  const tree = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).parse(content) as Root;

  const titleFromMd = extractTitleFromH1(tree) ?? "";
  const descFromMd = extractDescriptionFromFirstParagraph(tree) ?? "";

  const fmTitle = getStringStrict({ key: "title", v: getTopLevelKeyCaseInsensitive(fm, "title"), allowEmpty: true });
  const fmDescription = getStringStrict({
    key: "description",
    v: getTopLevelKeyCaseInsensitive(fm, "description"),
    allowEmpty: true,
  });
  const fmSystem = getStringStrict({ key: "system", v: getTopLevelKeyCaseInsensitive(fm, "system"), allowEmpty: true });
  const fmRules = getStringStrict({ key: "rules", v: getTopLevelKeyCaseInsensitive(fm, "rules"), allowEmpty: true });
  const fmTemplateEngine = getStringStrict({
    key: "templateEngine",
    v: getTopLevelKeyCaseInsensitive(fm, "templateEngine"),
    allowEmpty: true,
  });
  const fmInput = getStringStrict({ key: "input", v: getTopLevelKeyCaseInsensitive(fm, "input"), allowEmpty: true });

  const title = (fmTitle ?? titleFromMd).trim();
  if (!title) throw new Error("Missing title. Provide a top-level '# Title' heading or frontmatter 'title'.");

  const description = (fmDescription ?? descFromMd).trim();

  const version = getStringStrict({ key: "version", v: getTopLevelKeyCaseInsensitive(fm, "version") }) ?? AGENT_DEFINITION_DEFAULTS.version;
  const icon = parseIcon(getTopLevelKeyCaseInsensitive(fm, "icon")) ?? AGENT_DEFINITION_DEFAULTS.icon;
  const avatar = parseAvatar(getTopLevelKeyCaseInsensitive(fm, "avatar"));
  const status = pickAgentStatus(getTopLevelKeyCaseInsensitive(fm, "status")) ?? AGENT_DEFINITION_DEFAULTS.status;
  const templateEngine =
    getStringStrict({ key: "templateEngine", v: getTopLevelKeyCaseInsensitive(fm, "templateEngine"), allowEmpty: true }) ??
    AGENT_DEFINITION_DEFAULTS.templateEngine;
  const input =
    getStringStrict({ key: "input", v: getTopLevelKeyCaseInsensitive(fm, "input"), allowEmpty: true }) ??
    AGENT_DEFINITION_DEFAULTS.input;

  const abilities = parseAbilities(getTopLevelKeyCaseInsensitive(fm, "abilities")) ?? AGENT_DEFINITION_DEFAULTS.abilities;
  const commands = parseCommands(getTopLevelKeyCaseInsensitive(fm, "commands"));
  const mcpServers = parseMcpServers(getTopLevelKeyCaseInsensitive(fm, "mcpServers"));

  const system = (fmSystem ?? takeSectionText(tree, "system")).trim();
  const rules = (fmRules ?? takeSectionText(tree, "rules")).trim();
  const toolsSource = takeSectionText(tree, "tools");

  return {
    version,
    icon,
    title,
    description,
    ...(avatar ? { avatar } : {}),
    status,
    templateEngine,
    input,
    ...(abilities ? { abilities } : {}),
    recommended: AGENT_DEFINITION_DEFAULTS.recommended,
    required: AGENT_DEFINITION_DEFAULTS.required,
    commands,
    ...(mcpServers ? { mcpServers } : {}),
    system,
    rules,
    toolsSource,
  };
}

export async function parseAgentMd(filePath: string): Promise<AgentDefinition> {
  const raw = await fs.readFile(filePath, "utf8");

  // Allow YAML-only files as well (rare), but keep behavior aligned with repo parser:
  // frontmatter + markdown sections.
  if (!isNonEmptyString(raw)) throw new Error("Input file is empty.");

  // If the file begins with a YAML object literal (not typical), try to parse it.
  // This is a small convenience for demo usage.
  const maybeJsObject = raw.trimStart().startsWith("{") ? extractFirstJsonObjectFromJs(raw) : null;
  if (maybeJsObject && typeof maybeJsObject === "string") {
    // ignore
  }

  // If file starts with `---`, gray-matter will parse frontmatter.
  // If file starts with YAML directly, try YAML parse and treat as empty content.
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---") && trimmed.includes(":")) {
    try {
      const parsed = YAML.parse(trimmed);
      if (isPlainObject(parsed)) {
        const fallbackMd = "# Agent\n";
        return agentTemplateToJson(`---\n${YAML.stringify(parsed)}---\n\n${fallbackMd}`);
      }
    } catch {
      // ignore
    }
  }

  return agentTemplateToJson(raw);
}

