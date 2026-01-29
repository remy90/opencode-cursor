export interface ProxyConfig {
  port?: number;
  host?: string;
  healthCheckPath?: string;
  requestTimeout?: number;
}

export interface ProxyServer {
  start(): Promise<string>;  // Returns baseURL
  stop(): Promise<void>;
  getBaseURL(): string;
}
