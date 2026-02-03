// src/auth.ts

import { spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createLogger } from "./utils/logger";
import { stripAnsi } from "./utils/errors";

const log = createLogger("auth");

export interface AuthResult {
  type: "success" | "failed";
  provider?: string;
  key?: string;
  error?: string;
}

export async function startCursorOAuth(): Promise<{
  url: string;
  instructions: string;
  callback: () => Promise<AuthResult>;
}> {
  return new Promise((resolve, reject) => {
    log.info("Starting cursor-cli login process");

    const proc = spawn("cursor-agent", ["login"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const extractUrl = () => {
      // Step 1: Strip ANSI codes
      let cleanOutput = stripAnsi(stdout);
      // Step 2: Remove ALL whitespace (newlines, spaces, tabs)
      // The URL is split across lines with continuation spaces
      cleanOutput = cleanOutput.replace(/\s/g, "");
      // Step 3: Now extract the continuous URL
      const urlMatch = cleanOutput.match(/https:\/\/cursor\.com\/loginDeepControl[^\s]*/);
      if (urlMatch) {
        return urlMatch[0];
      }
      return null;
    };

    // Give cursor-cli time to output the URL
    setTimeout(() => {
      const url = extractUrl();

      log.debug("Captured stdout", { length: stdout.length });
      log.debug("Extracted URL", { url: url?.substring(0, 50) + "..." });

      if (!url) {
        proc.kill();
        const errorMsg = stderr ? stripAnsi(stderr) : "No login URL received";
        log.error("Failed to extract login URL", { error: errorMsg });
        reject(new Error(`Failed to get login URL: ${errorMsg}`));
        return;
      }

      log.info("Got login URL, waiting for browser auth");

      resolve({
        url,
        instructions: "Click 'Continue with Cursor' in your browser to authenticate",
        callback: async () => {
          // Wait for process to complete
          return new Promise((resolve) => {
            proc.on("close", (code) => {
              log.debug("Login process closed", { code });
              const isAuthenticated = verifyCursorAuth();

              if (code === 0 && isAuthenticated) {
                log.info("Authentication successful");
                resolve({
                  type: "success",
                  provider: "cursor-acp",
                  key: "cursor-auth",
                });
              } else {
                log.warn("Authentication failed or incomplete", { code, isAuthenticated });
                resolve({
                  type: "failed",
                  error: stderr ? stripAnsi(stderr) : "Authentication was not completed",
                });
              }
            });

            // Timeout after 5 minutes
            setTimeout(() => {
              log.warn("Authentication timed out after 5 minutes");
              proc.kill();
              resolve({
                type: "failed",
                error: "Authentication timed out",
              });
            }, 5 * 60 * 1000);
          });
        },
      });
    }, 1000);
  });
}

export function verifyCursorAuth(): boolean {
  // cursor-agent stores auth in ~/.config/cursor/auth.json (not ~/.cursor/)
  const authFile = join(homedir(), ".config", "cursor", "auth.json");
  const exists = existsSync(authFile);
  log.debug("Checking auth file", { path: authFile, exists });
  return exists;
}

export function getAuthFilePath(): string {
  return join(homedir(), ".config", "cursor", "auth.json");
}
