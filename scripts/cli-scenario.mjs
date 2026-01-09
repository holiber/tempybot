#!/usr/bin/env node
import readline from "node:readline";

// Scenario CLI demo:
// - Looks like a real terminal (dark background + green text).
// - Asks for a name and replies "Hello <name>!".
//
// This is intentionally small and dependency-free so scenario tests can spawn it
// without requiring a build step.

const ESC = "\u001b[";

function setTerminalStyle() {
  // Reset, then force dark background + bright green foreground.
  // These are standard ANSI SGR sequences and will be captured by asciinema.
  process.stdout.write(`${ESC}0m${ESC}40m${ESC}92m`);
}

function resetStyle() {
  process.stdout.write(`${ESC}0m`);
}

setTerminalStyle();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

rl.question("What's your name ", (answer) => {
  const name = answer.trim();
  process.stdout.write(`Hello ${name}!\n`);
  resetStyle();
  rl.close();
});

