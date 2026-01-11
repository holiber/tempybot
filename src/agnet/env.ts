import process from "node:process";

export function readEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function readEnvAny(names: string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const name of names) {
    const v = readEnv(name, env);
    if (v) return v;
  }
  return undefined;
}

export function getCursorApiKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return readEnvAny(["CURSOR_API_KEY", "CURSOR_CLOUD_API_KEY", "CURSORCLOUDAPIKEY"], env);
}

export function getOpenAiApiKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return readEnvAny(["OPENAI_API_KEY", "OPENAI_KEY"], env);
}

