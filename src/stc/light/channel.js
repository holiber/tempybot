// Runtime shim for executing `.ts` entrypoints directly under Node.
// TypeScript typecheck/build should resolve `./channel.js` -> `./channel.ts`.
export * from "./channel.ts";

