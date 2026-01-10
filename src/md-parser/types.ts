export type AgentStatus = "active" | "deprecated" | "disabled";

export type AgentAbilities = {
  /**
   * Allowed abilities. Values are case-insensitive and normalized to lowercase.
   *
   * Supported base abilities: fs, network, sh, tool, mcp, browser, env
   * Supported scoped abilities: sh:<command>
   */
  allow?: string[];
  /**
   * Denied abilities. Values are case-insensitive and normalized to lowercase.
   *
   * If both allow and deny are present, any overlap is an error and deny wins at runtime.
   */
  deny?: string[];
  [k: string]: unknown;
};

export type AgentRecommended = {
  models?: string[];
  capabilities?: string[];
  [k: string]: unknown;
};

export type AgentRequired = {
  env?: string[];
  startup?: string;
  [k: string]: unknown;
};

export type AgentInlineCommand = {
  name: string;
  description: string;
  body: string;
  "argument-hint"?: string | string[];
  [k: string]: unknown;
};

export type AgentCommand = string | AgentInlineCommand;

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type McpServersConfig = Record<string, McpServerConfig>;

/**
 * Deterministic parse output for `.agent.md` files.
 *
 * Notes:
 * - The loader performs strict validation / conflict detection for known fields.
 * - `toolsSource` is raw Markdown content under the `## Tools` heading (execution is runtime responsibility).
 */
export type AgentDefinition = {
  version: string;
  icon: string;
  title: string;
  description: string;
  /**
   * Optional avatar image URL/path. May be derived from a `# Avatar` section (first image)
   * or from YAML metadata (avatar).
   */
  avatar?: string;
  status: AgentStatus;
  templateEngine: string;
  input: string;
  /**
   * Optional runtime extension. When present, it is validated by the loader.
   */
  abilities?: AgentAbilities;
  recommended: AgentRecommended;
  required: AgentRequired;
  commands: AgentCommand[];
  /**
   * Optional MCP server configuration extracted from YAML frontmatter.
   * Server keys and environment variable keys are preserved as provided.
   */
  mcpServers?: McpServersConfig;
  system: string;
  rules: string;
  toolsSource: string;
};

export const AGENT_DEFINITION_DEFAULTS: Pick<
  AgentDefinition,
  | "version"
  | "icon"
  | "status"
  | "templateEngine"
  | "input"
  | "abilities"
  | "recommended"
  | "required"
  | "commands"
  | "rules"
  | "toolsSource"
> = {
  version: "0.1.0",
  icon: "🤖",
  status: "active",
  templateEngine: "hbs",
  input: "",
  abilities: undefined,
  recommended: {},
  required: {},
  commands: [],
  rules: "",
  toolsSource: "",
};
