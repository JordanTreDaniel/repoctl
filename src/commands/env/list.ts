// ✦ list.ts — implements 'repoctl env list'

import chalk from 'chalk';
import { table } from 'table';
import { loadConfig } from '../../core/config.js';
import { listManifests, readPid } from '../../core/manifest.js';
import { isPortInUse } from '../../core/ports.js';

export interface ListOptions {
  configPath?: string;
}

// WHAT: creates clickable hyperlink for terminal supporting OSC 8 (iTerm2, VS Code, etc.)
function clickableLink(text: string, url: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

// WHAT: detects if terminal supports OSC 8 hyperlinks
function supportsHyperlinks(): boolean {
  const term = process.env.TERM_PROGRAM || '';
  const termProgramVersion = process.env.TERM_PROGRAM_VERSION || '';
  return term.includes('iTerm') || 
         term.includes('VSCode') || 
         term.includes('Hyper') ||
         term.includes('Apple_Terminal');
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

  const terminalWidth = process.stdout.columns ?? 200;
  const isNarrowScreen = terminalWidth < 80;

  // WHAT: render compact vertical layout for narrow screens
  if (isNarrowScreen) {
    const useHyperlinks = supportsHyperlinks();
    manifests.forEach((m) => {
      const running = isEnvRunning(m.services);
      const status = running ? chalk.green('● running') : chalk.dim('○ stopped');
      const created = new Date(m.created).toLocaleDateString();
      console.log(`${chalk.bold(m.name)}: ${status} (created: ${created})`);
      Object.entries(m.services).forEach(([name, s]) => {
        const serviceDisplay = useHyperlinks 
          ? clickableLink(`${name}:${s.port}`, `http://localhost:${s.port}`) 
          : `${name}:${s.port}`;
        console.log(`  ${serviceDisplay}`);
      });
      console.log();
    });
    return;
  }

  // WHAT: render responsive table for wide screens
  // WHY:  each row is env+service so no cell overflow; clickable links to localhost:<port>
  const useHyperlinks = supportsHyperlinks();
  const rows: string[][] = [];
  
  manifests.forEach((m) => {
    const envCreated = new Date(m.created).toLocaleDateString();
    Object.entries(m.services).forEach(([serviceName, service]) => {
      const running = isEnvRunning(m.services);
      const status = running ? chalk.green('● running') : chalk.dim('○ stopped');
      const serviceDisplay = useHyperlinks 
        ? clickableLink(serviceName, `http://localhost:${service.port}`) 
        : serviceName;
      rows.push([m.name, serviceDisplay, String(service.port), status, envCreated]);
    });
  });

  const data = [
    [chalk.bold('Name'), chalk.bold('Service'), chalk.bold('Port'), chalk.bold('Status'), chalk.bold('Created')],
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
