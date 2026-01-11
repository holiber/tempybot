import fs from "node:fs/promises";
import path from "node:path";

import yaml from "yaml";

export type AgentSpec = {
  id: string;
  model: { openai: string; vercel: string };
  policies: string[];
  tools: string[];
  system: string;
};

function parseFrontmatter(md: string): { front: any; body: string } {
  const raw = String(md ?? "");
  if (!raw.startsWith("---\n")) return { front: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { front: {}, body: raw };
  const fm = raw.slice(4, end).trim();
  const body = raw.slice(end + "\n---".length).trimStart();
  const front = yaml.parse(fm) as any;
  return { front: front && typeof front === "object" ? front : {}, body };
}

async function readText(p: string): Promise<string> {
  return await fs.readFile(p, "utf8");
}

export async function loadAgent(agentId: string, opts?: { cwd?: string }): Promise<AgentSpec> {
  const cwd = opts?.cwd ?? process.cwd();
  const agentPath = path.join(cwd, "agents", "templates", `${agentId}.agent.md`);
  const md = await readText(agentPath);
  const { front, body } = parseFrontmatter(md);

  const id = String(front?.id ?? agentId).trim() || agentId;
  const modelOpenAi = String(front?.model?.openai ?? "").trim();
  const modelVercel = String(front?.model?.vercel ?? "").trim();
  const policies = Array.isArray(front?.policies) ? front.policies.map((p: any) => String(p).trim()).filter(Boolean) : [];
  const tools = Array.isArray(front?.tools) ? front.tools.map((t: any) => String(t).trim()).filter(Boolean) : [];

  const policiesText: string[] = [];
  for (const p of policies) {
    const policyPath = path.join(cwd, "policies", `${p}.md`);
    const txt = await readText(policyPath);
    policiesText.push(`\n\n# Policy: ${p}\n\n${txt.trim()}\n`);
  }

  const system = `${body.trim()}\n${policiesText.join("\n")}`.trim();
  return {
    id,
    model: { openai: modelOpenAi || "gpt-4o-mini", vercel: modelVercel || "openai/gpt-4o-mini" },
    policies,
    tools,
    system,
  };
}

