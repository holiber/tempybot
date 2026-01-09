export type AgentStatus = "active" | "deprecated" | "disabled";

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

/**
 * Minimal, deterministic parse output for PR1 (Issue #3).
 *
 * Notes:
 * - Validation/conflict detection is intentionally deferred to PR2/PR3.
 * - `toolsSource` is raw Markdown content under the `## Tools` heading.
 */
export type AgentDefinition = {
  version: string;
  icon: string;
  title: string;
  description: string;
  status: AgentStatus;
  templateEngine: string;
  input: string;
  recommended: AgentRecommended;
  required: AgentRequired;
  commands: AgentCommand[];
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
  recommended: {},
  required: {},
  commands: [],
  rules: "",
  toolsSource: "",
};
