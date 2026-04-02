// ✦ lock.ts — implements 'repoctl lock', 'repoctl lock list', 'repoctl lock restore <name>'

import { execSync } from 'child_process';
import chalk from 'chalk';
import { table } from 'table';
import { loadConfig } from '../core/config.js';
import { readManifest, listManifests } from '../core/manifest.js';
import { upsertCombo, readKnownGood, writeKnownGood } from '../core/manifest.js';
import { worktreePath } from '../core/worktrees.js';
import { getCurrentSha, checkoutInWorktree } from '../core/worktrees.js';
import type { KnownGoodCombo } from '../core/types.js';

export interface LockOptions {
  tested?: boolean;
  notes?: string;
  configPath?: string;
}

// WHAT: reads current HEAD SHAs from all service worktrees in an environment
// WHY:  lock records the exact state of every repo at a known-good moment
// EDGE: reads from the worktree paths recorded in the manifest, not the main repo
function readCurrentShas(
  rootDir: string,
  envName: string,
  serviceNames: string[]
): Record<string, string> {
  const manifest = readManifest(rootDir, envName);
  if (!manifest) throw new Error(`Environment '${envName}' not found`);

  const shas: Record<string, string> = {};
  for (const name of serviceNames) {
    const svcManifest = manifest.services[name];
    if (!svcManifest) continue;
    shas[name] = getCurrentSha(svcManifest.worktree_path);
  }
  return shas;
}

// WHAT: records the current SHAs of all repos in an environment as a named known-good combo
// WHY:  the killer feature — freeze a working multi-repo state so you can restore it later
// EDGE: requires an existing environment; the combo name is the lock name, not the env name
export async function lockEnv(
  comboName: string,
  envName: string,
  opts: LockOptions
): Promise<void> {
  const { config, rootDir } = loadConfig(opts.configPath);
  const serviceNames = config.services.map((s) => s.name);

  console.log(chalk.bold(`\n  Recording known-good combo: ${chalk.cyan(comboName)}\n`));
  console.log(chalk.dim(`  Reading SHAs from environment '${envName}'...`));

  const shas = readCurrentShas(rootDir, envName, serviceNames);

  for (const [svc, sha] of Object.entries(shas)) {
    console.log(chalk.dim(`    ${svc.padEnd(14)} ${sha.slice(0, 8)}`));
  }

  const combo: KnownGoodCombo = {
    name: comboName,
    recorded: new Date().toISOString(),
    tested: opts.tested ?? false,
    notes: opts.notes,
    shas,
  };

  upsertCombo(rootDir, combo);
  console.log(chalk.green(`\n  ✓ Combo '${comboName}' saved.\n`));
  if (!opts.tested) {
    console.log(chalk.dim(`  Mark as tested with: repoctl lock ${comboName} --tested\n`));
  }
}

// WHAT: prints all known-good combos as a table
// WHY:  gives visibility into what states have been recorded and whether they're verified
// EDGE: shows all combos including untested ones — filter visually using the Tested column
export async function listLocks(opts: { configPath?: string }): Promise<void> {
  const { rootDir } = loadConfig(opts.configPath);
  const data = readKnownGood(rootDir);

  if (data.combos.length === 0) {
    console.log(chalk.dim('\n  No known-good combos recorded yet.\n'));
    console.log(chalk.dim('  Record one with: repoctl lock <name> <env>\n'));
    return;
  }

  const rows = data.combos.map((c) => {
    const tested = c.tested ? chalk.green('✓ yes') : chalk.dim('no');
    const recorded = new Date(c.recorded).toLocaleDateString();
    const notes = c.notes ?? '';
    const svcCount = Object.keys(c.shas).length;
    return [c.name, tested, `${svcCount} repos`, recorded, notes];
  });

  const tableData = [
    [
      chalk.bold('Name'),
      chalk.bold('Tested'),
      chalk.bold('Repos'),
      chalk.bold('Recorded'),
      chalk.bold('Notes'),
    ],
    ...rows,
  ];

  console.log(
    table(tableData, {
      border: {
        topBody: '─', topJoin: '┬', topLeft: '╭', topRight: '╮',
        bottomBody: '─', bottomJoin: '┴', bottomLeft: '╰', bottomRight: '╯',
        bodyLeft: '│', bodyRight: '│', bodyJoin: '│',
        joinBody: '─', joinLeft: '├', joinRight: '┤', joinJoin: '┼',
      },
    })
  );
}

// WHAT: checks out all repos to the SHAs recorded in a known-good combo
// WHY:  restore lets you return to any previously recorded working state across all repos simultaneously
// EDGE: checks out into the current worktrees of the named env — env must exist; creates detached HEADs
export async function restoreLock(
  comboName: string,
  envName: string,
  opts: { configPath?: string }
): Promise<void> {
  const { config, rootDir } = loadConfig(opts.configPath);
  const data = readKnownGood(rootDir);
  const combo = data.combos.find((c) => c.name === comboName);

  if (!combo) {
    console.error(chalk.red(`✗ Known-good combo '${comboName}' not found.`));
    console.error(chalk.dim(`  Run 'repoctl lock list' to see available combos.`));
    process.exit(1);
  }

  const manifest = readManifest(rootDir, envName);
  if (!manifest) {
    console.error(chalk.red(`✗ Environment '${envName}' not found.`));
    process.exit(1);
  }

  console.log(chalk.bold(`\n  Restoring combo '${chalk.cyan(comboName)}' into env '${chalk.cyan(envName)}'\n`));

  for (const svc of config.services) {
    const sha = combo.shas[svc.name];
    if (!sha) {
      console.log(chalk.yellow(`  ⚠ ${svc.name}: no SHA in combo — skipping`));
      continue;
    }
    const svcManifest = manifest.services[svc.name];
    if (!svcManifest) {
      console.log(chalk.yellow(`  ⚠ ${svc.name}: not in env manifest — skipping`));
      continue;
    }
    checkoutInWorktree(svcManifest.worktree_path, sha);
    console.log(chalk.green(`  ✓ ${svc.name}`), chalk.dim(`→ ${sha.slice(0, 8)}`));
  }

  console.log(chalk.green(`\n  ✓ Restore complete.\n`));
  if (combo.notes) console.log(chalk.dim(`  Notes: ${combo.notes}\n`));
}

// WHAT: deletes a known-good combo by name
// WHY:  stale combos from old branches shouldn't clutter the list
// EDGE: no confirmation prompt — this is a soft operation (no code or DB changes)
export async function deleteLock(comboName: string, opts: { configPath?: string }): Promise<void> {
  const { rootDir } = loadConfig(opts.configPath);
  const data = readKnownGood(rootDir);
  const before = data.combos.length;
  data.combos = data.combos.filter((c) => c.name !== comboName);

  if (data.combos.length === before) {
    console.error(chalk.red(`✗ Combo '${comboName}' not found.`));
    process.exit(1);
  }

  writeKnownGood(rootDir, data);
  console.log(chalk.green(`  ✓ Combo '${comboName}' deleted.`));
}

// ✦ END lock.ts
