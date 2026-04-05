// ✦ cli.ts — main CLI entrypoint; registers all commands with commander

import { Command } from 'commander';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// WHAT: reads package.json to get the current version for --version flag
// WHY:  single source of truth for version; avoids hardcoding in two places
// EDGE: uses import.meta.url to find package.json relative to this file
function readVersion(): string {
  const require = createRequire(import.meta.url);
  const pkgPath = path.resolve(fileURLToPath(import.meta.url), '../../package.json');
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const program = new Command();

program
  .name('repoctl')
  .description('Multi-repo dev environment orchestrator')
  .version(readVersion());

// ─── init ────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Create a .repoctl.yaml config file interactively')
  .action(async () => {
    const { initProject } = await import('./commands/init.js');
    await initProject();
  });

// ─── validate ────────────────────────────────────────────────────────────────

program
  .command('validate')
  .description('Validate the .repoctl.yaml config and check that all repo paths exist')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (opts) => {
    const chalk = (await import('chalk')).default;
    try {
      const { loadConfig } = await import('./core/config.js');
      const { config, rootDir } = loadConfig(opts.config);
      console.log(chalk.green(`\n  ✓ Config valid: ${config.name} (${config.services.length} services)\n`));
    } catch (err: unknown) {
      console.error(chalk.red(`\n  ✗ ${(err as Error).message}\n`));
      process.exit(1);
    }
  });

// ─── env ─────────────────────────────────────────────────────────────────────

const envCmd = program.command('env').description('Manage environments');

envCmd
  .command('create <name>')
  .description('Create a new isolated environment')
  .option('-b, --branch <branch>', 'Check out this branch in all repos')
  .option('--no-db', 'Skip database copy')
  .option('--seed', 'Run seed command after DB copy')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (name, opts) => {
    const { createEnv } = await import('./commands/env/create.js');
    await createEnv(name, {
      branch: opts.branch,
      noDb: !opts.db,
      seed: opts.seed,
      configPath: opts.config,
    });
  });

envCmd
  .command('list')
  .description('List all environments')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (opts) => {
    const { listEnvs } = await import('./commands/env/list.js');
    await listEnvs({ configPath: opts.config });
  });

envCmd
  .command('status <name>')
  .description('Show detailed status for an environment')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (name, opts) => {
    const { statusEnv } = await import('./commands/env/status.js');
    await statusEnv(name, { configPath: opts.config });
  });

envCmd
  .command('start <name>')
  .description('Start services for an environment')
  .option('-s, --service <name>', 'Start only this service')
  .option('-f, --force', 'Force re-run pre-run scripts')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (name, opts) => {
    const { startEnv } = await import('./commands/env/start.js');
    await startEnv(name, { service: opts.service, configPath: opts.config, force: opts.force });
  });

envCmd
  .command('stop <name>')
  .description('Stop services for an environment')
  .option('-s, --service <name>', 'Stop only this service')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (name, opts) => {
    const { stopEnv } = await import('./commands/env/stop.js');
    await stopEnv(name, { service: opts.service, configPath: opts.config });
  });

envCmd
  .command('restart <name>')
  .description('Restart services for an environment')
  .option('-s, --service <name>', 'Restart only this service')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (name, opts) => {
    const { restartEnv } = await import('./commands/env/stop.js');
    await restartEnv(name, { service: opts.service, configPath: opts.config });
  });

envCmd
  .command('destroy <name>')
  .description('Destroy an environment (removes worktrees and DB copy)')
  .option('--keep-db', 'Keep the database copy')
  .option('--stop', 'Stop services before destroying')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (name, opts) => {
    const { destroyEnv } = await import('./commands/env/destroy.js');
    await destroyEnv(name, { keepDb: opts.keepDb, yes: opts.yes, stop: opts.stop, configPath: opts.config });
  });

envCmd
  .command('bind <name>')
  .description('Bind to a feature-env, writing .repoctl/active.yaml for agent binding')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (name, opts) => {
    const { bindEnv } = await import('./commands/env/bind.js');
    bindEnv(name, { configPath: opts.config });
  });

envCmd
  .command('info <name>')
  .description('Show detailed info about a feature-env')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (name, opts) => {
    const { infoEnv } = await import('./commands/env/info.js');
    infoEnv(name, { configPath: opts.config });
  });

envCmd
  .command('active')
  .description('Show currently bound feature-env')
  .option('-j, --json', 'Output as JSON')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (opts) => {
    const { showActive } = await import('./commands/env/active.js');
    showActive({ configPath: opts.config, json: opts.json });
  });

envCmd
  .command('unbind')
  .description('Clear the active feature-env binding')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (opts) => {
    const { clearActive } = await import('./commands/env/active.js');
    clearActive({ configPath: opts.config });
  });

// ─── lock ────────────────────────────────────────────────────────────────────

const lockCmd = program.command('lock').description('Record and restore known-good SHA combos');

lockCmd
  .command('record <combo-name> <env-name>')
  .description('Record current SHAs of all repos in an environment as a known-good combo')
  .option('--tested', 'Mark this combo as verified/tested')
  .option('-n, --notes <text>', 'Optional notes about this combo')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (comboName, envName, opts) => {
    const { lockEnv } = await import('./commands/lock.js');
    await lockEnv(comboName, envName, {
      tested: opts.tested,
      notes: opts.notes,
      configPath: opts.config,
    });
  });

lockCmd
  .command('list')
  .description('List all known-good combos')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (opts) => {
    const { listLocks } = await import('./commands/lock.js');
    await listLocks({ configPath: opts.config });
  });

lockCmd
  .command('restore <combo-name> <env-name>')
  .description('Check out all repos in an env to the SHAs from a known-good combo')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (comboName, envName, opts) => {
    const { restoreLock } = await import('./commands/lock.js');
    await restoreLock(comboName, envName, { configPath: opts.config });
  });

lockCmd
  .command('delete <combo-name>')
  .description('Delete a known-good combo')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (comboName, opts) => {
    const { deleteLock } = await import('./commands/lock.js');
    await deleteLock(comboName, { configPath: opts.config });
  });

// ─── open ─────────────────────────────────────────────────────────────────────

program
  .command('open <name>')
  .description('Print the worktree paths for an environment (use with $EDITOR)')
  .option('-s, --service <name>', 'Show path for one service only')
  .option('-c, --config <path>', 'Path to .repoctl.yaml')
  .action(async (name, opts) => {
    const chalk = (await import('chalk')).default;
    const { loadConfig } = await import('./core/config.js');
    const { readManifest } = await import('./core/manifest.js');
    const { rootDir } = loadConfig(opts.config);
    const manifest = readManifest(rootDir, name);
    if (!manifest) {
      console.error(chalk.red(`✗ Environment '${name}' not found.`));
      process.exit(1);
    }
    if (opts.service) {
      const svc = manifest.services[opts.service];
      if (!svc) {
        console.error(chalk.red(`✗ Service '${opts.service}' not found in env '${name}'.`));
        process.exit(1);
      }
      console.log(svc.worktree_path);
    } else {
      for (const [svcName, svc] of Object.entries(manifest.services)) {
        console.log(`${svcName}: ${svc.worktree_path}`);
      }
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});

// ✦ END cli.ts
