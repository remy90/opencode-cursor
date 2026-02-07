import type { StreamJsonEvent } from "./types.js";

export const parseStreamJsonLine = (line: string): StreamJsonEvent | null => {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as StreamJsonEvent;
  } catch {
    return null;
  }
};
