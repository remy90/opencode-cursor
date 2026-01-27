#!/usr/bin/env node

import { spawn } from 'child_process';

export interface MockCursorAgentOptions {
  responseDelay?: number;
  errorOnNthCall?: number;
  exitWithCode?: number;
  outputFormat?: 'json' | 'stream-json';
}

export class MockCursorAgent {
  private callCount = 0;
  private options: MockCursorAgentOptions;

  constructor(options: MockCursorAgentOptions = {}) {
    this.options = {
      responseDelay: 10,
      outputFormat: 'stream-json',
      ...options
    };
  }

  private createResponse(prompt: string): any[] {
    this.callCount++;
    
    if (this.options.errorOnNthCall === this.callCount) {
      return [
        {
          type: "result",
          subtype: "error",
          timestamp: Date.now(),
          session_id: `test-session-${this.callCount}`,
          error: {
            message: "Mock error for testing",
            code: 500,
            details: "Test error triggered by mock configuration"
          }
        }
      ];
    }

    if (this.options.exitWithCode && this.options.exitWithCode > 0) {
      process.exitCode = this.options.exitWithCode;
      return [];
    }

    const defaultResponses = [
      {
        type: "assistant",
        timestamp: Date.now(),
        session_id: `test-session-${this.callCount}`,
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `Response to: ${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}`
            }
          ]
        }
      },
      {
        type: "result",
        subtype: "success",
        timestamp: Date.now() + 100,
        session_id: `test-session-${this.callCount}`,
        duration_ms: 250
      }
    ];

    return defaultResponses;
  }

  public start(): void {
    process.stdin.setEncoding('utf8');
    
    let stdinBuffer = '';
    process.stdin.on('data', (chunk: Buffer | string) => {
      stdinBuffer += chunk.toString();
      
      const lines = stdinBuffer.split('\n');
      stdinBuffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.trim()) {
          setTimeout(() => {
            try {
              const responses = this.createResponse(line.trim());
              
              responses.forEach(response => {
                if (this.options.outputFormat === 'stream-json') {
                  console.log(JSON.stringify(response));
                }
              });
            } catch (error) {
              console.error(JSON.stringify({
                type: "result",
                subtype: "error",
                timestamp: Date.now(),
                error: {
                  message: `Mock parsing error: ${error}`,
                  code: 400
                }
              }));
            }
          }, this.options.responseDelay);
        }
      }
    });

    process.stdin.on('end', () => {
      process.exit(this.options.exitWithCode || 0);
    });

    process.stdin.resume();
  }

  public static spawn(options: MockCursorAgentOptions = {}): ReturnType<typeof spawn> {
    const agent = new MockCursorAgent(options);
    
    const script = `
const { MockCursorAgent } = require(${JSON.stringify(__filename)});
const agent = new MockCursorAgent(${JSON.stringify(options)});
agent.start();
`;
    
    return spawn(process.execPath, ['-e', script], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
  }
}

if (require.main === module) {
  const agent = new MockCursorAgent();
  agent.start();
}