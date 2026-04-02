// ✦ list.ts — implements 'repoctl env list'

import chalk from 'chalk';
import { table } from 'table';
import { loadConfig } from '../../core/config.js';
import { listManifests, readPid } from '../../core/manifest.js';
import { isPortInUse } from '../../core/ports.js';

export interface ListOptions {
  configPath?: string;
}

// WHAT: checks whether any service in an env is actively running
// WHY:  list command shows running status; we check ports since PIDs can go stale
// EDGE: a port in use does not guarantee it's repoctl's process — could be another service
function isEnvRunning(services: Record<string, { port: number }>): boolean {
  return Object.values(services).some((s) => isPortInUse(s.port));
}

// WHAT: displays all environments as a formatted table with ports and status
// WHY:  operators need to see at a glance what envs exist, their ports, and if they're running
// EDGE: shows stale envs (manifest exists but worktrees deleted) — use destroy to clean up
export async function listEnvs(opts: ListOptions): Promise<void> {
  const { rootDir } = loadConfig(opts.configPath);
  const manifests = listManifests(rootDir);

  if (manifests.length === 0) {
    console.log(chalk.dim('\n  No environments found. Run `repoctl env create <name>` to start.\n'));
    return;
  }

  const rows = manifests.map((m) => {
    const running = isEnvRunning(m.services);
    const status = running ? chalk.green('● running') : chalk.dim('○ stopped');
    const ports = Object.entries(m.services)
      .map(([name, s]) => `${name}:${s.port}`)
      .join('  ');
    const created = new Date(m.created).toLocaleDateString();
    return [m.name, status, ports, created];
  });

  const data = [
    [chalk.bold('Name'), chalk.bold('Status'), chalk.bold('Ports'), chalk.bold('Created')],
    ...rows,
  ];

  console.log(
    table(data, {
      border: {
        topBody: '─',
        topJoin: '┬',
        topLeft: '╭',
        topRight: '╮',
        bottomBody: '─',
        bottomJoin: '┴',
        bottomLeft: '╰',
        bottomRight: '╯',
        bodyLeft: '│',
        bodyRight: '│',
        bodyJoin: '│',
        joinBody: '─',
        joinLeft: '├',
        joinRight: '┤',
        joinJoin: '┼',
      },
    })
  );
}

// ✦ END list.ts
