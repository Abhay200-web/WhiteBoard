import path from 'node:path';

import { HOST_PORT } from '@whiteboard/core';

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
}

/** Reads dev/runtime settings from the environment (see `.env.example`). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.WB_PORT ?? HOST_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`WB_PORT must be a port number, got "${env.WB_PORT}"`);
  }
  return {
    // Listen on the LAN so other office PCs can reach the Host.
    host: env.WB_HOST ?? '0.0.0.0',
    port,
    dataDir: path.resolve(env.WB_DATA_DIR ?? '.data'),
  };
}
