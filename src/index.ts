import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import type { Plugin, Hooks } from "@opencode-ai/plugin";
import { CursorAcpHybridAgent } from "./acp/agent.js";
import { CursorNativeWrapper } from "./acp/cursor.js";

export function runAcp() {
  const input = process.stdin as any;
  const output = process.stdout as any;
  const stream = ndJsonStream(input, output);
  new AgentSideConnection((client: any) => CursorAcpHybridAgent(client), stream);

  process.stdin.resume();
}

// OpenCode plugin format
// Based on working plugins like opencode-notifier and opencode-gemini-auth
// Plugins export both named and default exports
export const CursorAcpPlugin: Plugin = async (input) => {
  // This plugin runs ACP via stdin/stdout, so we don't need traditional OpenCode hooks
  // But we must return a hooks object to satisfy the plugin interface
  // Always return hooks object - opencode expects this to never be undefined
  const hooks: Hooks = {
    // Optional config hook - called when config is loaded/updated
    config: async (config) => {
      // No-op for now, but can be extended if needed
      // This hook is called by opencode to allow plugins to modify config
    }
  };
  
  return hooks;
};

// Also export as default for compatibility (like opencode-notifier does)
export default CursorAcpPlugin;

export { CursorAcpHybridAgent, CursorNativeWrapper };
