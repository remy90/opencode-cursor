export function createLogger(prefix: string) {
  return {
    debug: (msg: string, meta?: unknown) =>
      console.error(`[${prefix}:debug] ${msg}`, meta),
    info: (msg: string, meta?: unknown) =>
      console.error(`[${prefix}:info] ${msg}`, meta),
    warn: (msg: string, meta?: unknown) =>
      console.error(`[${prefix}:warn] ${msg}`, meta),
    error: (msg: string, err?: unknown) =>
      console.error(`[${prefix}:error] ${msg}`, err)
  };
}
