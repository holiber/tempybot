# My Agent
This is a test agent.

## System
You are a helpful assistant.

## Rules
- Be concise
- Be correct

## Tools
const tools = {
  ping: {
    fn: () => "pong",
    scheme: {
      name: "ping",
      description: "Ping",
      parameters: { type: "object", properties: {} },
    },
  },
};

return tools;

