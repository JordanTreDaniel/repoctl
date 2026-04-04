// ✦ stop.ts — implements 'repoctl env stop <name>' and 'repoctl env restart <name>'

import chalk from 'chalk';
import { loadConfig } from '../../core/config.js';
import { readManifest, readPid, deletePid } from '../../core/manifest.js';
import { isPortInUse } from '../../core/ports.js';

export interface StopOptions {
  service?: string;
  configPath?: string;
}

// WHAT: kills a process by PID and removes its PID file
// WHY:  stop command must terminate the spawned service process cleanly
// EDGE: SIGTERM is sent first; if the process has already exited, the kill call throws and is caught
async function killService(
  rootDir: string,
  envName: string,
  svcName: string,
  port: number
): Promise<void> {
  const pid = readPid(rootDir, envName, svcName);

  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(chalk.green(`  ✓ ${svcName}`), chalk.dim(`(pid ${pid} sent SIGTERM)`));
    } catch {
      console.log(chalk.dim(`  ○ ${svcName}: process ${pid} not found (already exited?)`));
    }
    deletePid(rootDir, envName, svcName);
  } else if (isPortInUse(port)) {
    // Fallback: kill by port using lsof
    console.log(chalk.dim(`  ○ ${svcName}: no PID file — killing by port ${port}...`));
    try {
      const { execSync } = await import('child_process');
      const lsofOutput = execSync(`lsof -ti :${port}`, { encoding: 'utf8' });
      const pids = lsofOutput.trim().split('\n');
      for (const p of pids) {
        if (p) {
          try {
            process.kill(parseInt(p), 'SIGTERM');
            console.log(chalk.green(`  ✓ ${svcName}`), chalk.dim(`(killed pid ${p} on port ${port})`));
          } catch {
            console.log(chalk.dim(`  ○ failed to kill pid ${p}`));
          }
        }
      }
    } catch {
      console.log(chalk.yellow(`  ⚠ ${svcName}: port ${port} in use but couldn't kill`));
    }
  } else {
    console.log(chalk.dim(`  ○ ${svcName}: not running`));
  }
}

// WHAT: stops all (or one) service for an environment by sending SIGTERM to tracked PIDs
// WHY:  clean shutdown prevents port-in-use errors on next start
// EDGE: if PIDs are stale (process died but PID file remains), the kill call fails silently and PID file is removed
export async function stopEnv(envName: string, opts: StopOptions): Promise<void> {
  const { config, rootDir } = loadConfig(opts.configPath);
  const manifest = readManifest(rootDir, envName);

  if (!manifest) {
    console.error(chalk.red(`✗ Environment '${envName}' not found.`));
    process.exit(1);
  }

  const services = opts.service
    ? config.services.filter((s) => s.name === opts.service)
    : config.services;

  console.log(chalk.bold(`\n  Stopping environment: ${chalk.cyan(envName)}\n`));

  for (const svc of services) {
    const svcManifest = manifest.services[svc.name];
    if (!svcManifest) continue;
    killService(rootDir, envName, svc.name, svcManifest.port);
  }

  console.log();
}

// WHAT: restarts an environment by stopping then starting all services
// WHY:  convenience command for picking up code changes without manual stop+start
// EDGE: relies on start.ts for the actual spawn logic; same caveats apply
export async function restartEnv(envName: string, opts: StopOptions): Promise<void> {
  await stopEnv(envName, opts);
  const { startEnv } = await import('./start.js');
  await startEnv(envName, opts);
}

// ✦ END stop.ts
