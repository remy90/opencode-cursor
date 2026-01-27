import type { Plugin } from "@opencode-ai/plugin";
import { createCursorProvider } from "./core/provider.js";

const CursorAcpPlugin: Plugin = async (input) => {
  const provider = createCursorProvider();
  
  try {
    const hooks = await provider.getHooks();
    return hooks;
  } catch (error) {
    console.error("[cursor-acp] Failed to create provider:", error);
    throw error;
  }
};

export { CursorAcpPlugin };
export default CursorAcpPlugin;