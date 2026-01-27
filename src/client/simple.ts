import { spawn } from 'child_process';
import { logger } from '../utils/logger.js';

export interface CursorClientConfig {
  timeout?: number;
  maxRetries?: number;
  streamOutput?: boolean;
  cursorAgentPath?: string;
}

export interface CursorResponse {
  content: string;
  done: boolean;
  error?: string;
}

export class SimpleCursorClient {
  private config: Required<CursorClientConfig>;
  private log: ReturnType<typeof logger>;

  constructor(config: CursorClientConfig = {}) {
    this.config = {
      timeout: 30000,
      maxRetries: 3,
      streamOutput: true,
      cursorAgentPath: process.env.CURSOR_AGENT_EXECUTABLE || 'cursor-agent',
      ...config
    };
    
    this.log = logger('cursor-client', 'info');
  }

  async *executePromptStream(prompt: string, options: {
    cwd?: string;
    model?: string;
    mode?: 'default' | 'plan' | 'ask';
    resumeId?: string;
  } = {}): AsyncGenerator<string, void, unknown> {
    const {
      cwd = process.cwd(),
      model = 'auto',
      mode = 'default',
      resumeId
    } = options;

    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--model',
      model
    ];

    if (mode === 'plan') {
      args.push('--plan');
    } else if (mode === 'ask') {
      args.push('--mode', 'ask');
    }

    if (resumeId) {
      args.push('--resume', resumeId);
    }

    this.log.info('Executing prompt stream', { promptLength: prompt.length, mode, model });

    const child = spawn(this.config.cursorAgentPath, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (prompt) {
      child.stdin.write(prompt);
      child.stdin.end();
    }

    const lines: string[] = [];
    let buffer = '';

    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const newLines = buffer.split('\n');
      buffer = newLines.pop() || '';
      
      for (const line of newLines) {
        if (line.trim()) {
          lines.push(line.trim());
        }
      }
    });

    const streamEnded = new Promise<void>((resolve) => {
      child.on('close', (code) => {
        if (buffer.trim()) {
          lines.push(buffer.trim());
        }
        if (code !== 0) {
          this.log.error('cursor-agent exited with non-zero code', { code });
        }
        resolve();
      });
      
      child.on('error', (error) => {
        this.log.error('cursor-agent process error', { error: error.message });
        resolve();
      });
    });

    for (const line of lines) {
      yield line;
    }

    await streamEnded;
  }

  async executePrompt(prompt: string, options: {
    cwd?: string;
    model?: string;
    mode?: 'default' | 'plan' | 'ask';
    resumeId?: string;
  } = {}): Promise<CursorResponse> {
    const {
      cwd = process.cwd(),
      model = 'auto',
      mode = 'default',
      resumeId
    } = options;

    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--model',
      model
    ];

    if (mode === 'plan') {
      args.push('--plan');
    } else if (mode === 'ask') {
      args.push('--mode', 'ask');
    }

    if (resumeId) {
      args.push('--resume', resumeId);
    }

    this.log.info('Executing prompt', { promptLength: prompt.length, mode, model });

    return new Promise((resolve, reject) => {
      const child = spawn(this.config.cursorAgentPath, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdoutBuffer = '';
      let stderrBuffer = '';

      if (prompt) {
        child.stdin.write(prompt);
        child.stdin.end();
      }

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      child.stdout.on('data', (data) => {
        stdoutBuffer += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderrBuffer += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        
        if (code !== 0) {
          reject(new Error(`cursor-agent exited with code ${code}: ${stderrBuffer}`));
          return;
        }

        try {
          const lines = stdoutBuffer.trim().split('\n');
          let content = '';
          
          for (const line of lines) {
            if (line.trim()) {
              const event = JSON.parse(line);
              if (event.type === 'assistant' && event.message?.content?.[0]?.text) {
                content = event.message.content[0].text;
              }
            }
          }

          resolve({
            content,
            done: true
          });
        } catch (error) {
          reject(new Error(`Failed to parse cursor-agent output: ${error}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  async getAvailableModels(): Promise<Array<{ id: string; name: string }>> {
    return [
      { id: 'auto', name: 'Cursor Agent Auto' },
      { id: 'gpt-5.2', name: 'GPT-5.2' },
      { id: 'gemini-3-pro', name: 'Gemini 3 Pro' },
      { id: 'opus-4.5-thinking', name: 'Claude 4.5 Opus Thinking' },
      { id: 'sonnet-4.5', name: 'Claude 4.5 Sonnet' },
      { id: 'deepseek-v3.2', name: 'DeepSeek V3.2' }
    ];
  }

  async validateInstallation(): Promise<boolean> {
    try {
      const testResponse = await this.executePrompt('test', { model: 'auto' });
      return !!testResponse.content;
    } catch (error) {
      this.log.error('Cursor installation validation failed:', error);
      return false;
    }
  }
}

export const createSimpleCursorClient = (config: CursorClientConfig = {}) => {
  return new SimpleCursorClient(config);
};