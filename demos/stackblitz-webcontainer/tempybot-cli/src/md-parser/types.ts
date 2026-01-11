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
 */
export type AgentDefinition = {
  version: string;
  icon: string;
  title: string;
  description: string;
  avatar?: string;
  status: AgentStatus;
  templateEngine: string;
  input: string;
  abilities?: AgentAbilities;
  recommended: AgentRecommended;
  required: AgentRequired;
  commands: AgentCommand[];
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

