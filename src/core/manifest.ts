// ✦ manifest.ts — read and write environment manifests and known-good combo files

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { EnvManifest, KnownGoodFile, KnownGoodCombo } from './types.js';
import { getStateDir, ensureStateDir } from './config.js';

// WHAT: writes an environment manifest to .repoctl/envs/<name>.yaml
// WHY:  persists env state so repoctl can resume, list, and destroy envs without re-scanning
// EDGE: overwrites existing manifest — always write the full current state
export function writeManifest(rootDir: string, manifest: EnvManifest): void {
  ensureStateDir(rootDir);
  const envPath = path.join(getStateDir(rootDir), 'envs', `${manifest.name}.yaml`);
  fs.writeFileSync(envPath, yaml.dump(manifest), 'utf8');
}

// WHAT: reads an environment manifest by name
// WHY:  lets commands look up port/sha/path info for an existing env
// EDGE: returns null if env doesn't exist — callers must handle missing env
export function readManifest(rootDir: string, envName: string): EnvManifest | null {
  const envPath = path.join(getStateDir(rootDir), 'envs', `${envName}.yaml`);
  if (!fs.existsSync(envPath)) return null;
  return yaml.load(fs.readFileSync(envPath, 'utf8')) as EnvManifest;
}

// WHAT: deletes an environment manifest file
// WHY:  cleanup after env destroy so list doesn't show destroyed envs
// EDGE: silent no-op if file doesn't exist
export function deleteManifest(rootDir: string, envName: string): void {
  const envPath = path.join(getStateDir(rootDir), 'envs', `${envName}.yaml`);
  if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
}

// WHAT: returns all environment manifests as an array
// WHY:  needed for list command and port conflict detection
// EDGE: returns empty array if state dir doesn't exist yet
export function listManifests(rootDir: string): EnvManifest[] {
  const envsDir = path.join(getStateDir(rootDir), 'envs');
  if (!fs.existsSync(envsDir)) return [];
  return fs
    .readdirSync(envsDir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => yaml.load(fs.readFileSync(path.join(envsDir, f), 'utf8')) as EnvManifest);
}

// WHAT: checks whether an env manifest already exists
// WHY:  create command needs to fail early if the env name is already taken
// EDGE: only checks file existence, not whether the worktrees are intact
export function envExists(rootDir: string, envName: string): boolean {
  return readManifest(rootDir, envName) !== null;
}

// WHAT: reads the known-good combos file
// WHY:  lock and lock restore commands need a persistent list of tested SHA combos
// EDGE: returns empty combos array if the file doesn't exist yet
export function readKnownGood(rootDir: string): KnownGoodFile {
  const filePath = path.join(getStateDir(rootDir), 'known-good.yaml');
  if (!fs.existsSync(filePath)) return { combos: [] };
  return yaml.load(fs.readFileSync(filePath, 'utf8')) as KnownGoodFile;
}

// WHAT: writes the known-good combos file
// WHY:  persists the full combo list after adding or removing entries
// EDGE: overwrites entirely — always pass the full updated list
export function writeKnownGood(rootDir: string, data: KnownGoodFile): void {
  ensureStateDir(rootDir);
  const filePath = path.join(getStateDir(rootDir), 'known-good.yaml');
  fs.writeFileSync(filePath, yaml.dump(data), 'utf8');
}

// WHAT: adds or replaces a combo by name in the known-good file
// WHY:  lock command needs upsert semantics — re-locking same name updates it
// EDGE: matches by name, replaces the entire entry if found
export function upsertCombo(rootDir: string, combo: KnownGoodCombo): void {
  const data = readKnownGood(rootDir);
  const idx = data.combos.findIndex((c) => c.name === combo.name);
  if (idx >= 0) data.combos[idx] = combo;
  else data.combos.push(combo);
  writeKnownGood(rootDir, data);
}

// WHAT: writes a PID file for a running environment
// WHY:  lets stop/status commands know which process group to kill
// EDGE: PIDs are per-service; a single env can have multiple PID files
export function writePid(rootDir: string, envName: string, serviceName: string, pid: number): void {
  ensureStateDir(rootDir);
  const pidPath = path.join(getStateDir(rootDir), 'pids', `${envName}-${serviceName}.pid`);
  fs.writeFileSync(pidPath, String(pid), 'utf8');
}

// WHAT: reads a PID file for a specific service in an environment
// WHY:  stop command needs the PID to kill the correct process
// EDGE: returns null if the PID file doesn't exist (service not started)
export function readPid(rootDir: string, envName: string, serviceName: string): number | null {
  const pidPath = path.join(getStateDir(rootDir), 'pids', `${envName}-${serviceName}.pid`);
  if (!fs.existsSync(pidPath)) return null;
  const raw = fs.readFileSync(pidPath, 'utf8').trim();
  return raw ? parseInt(raw, 10) : null;
}

// WHAT: deletes a PID file for a service
// WHY:  cleanup when a service is stopped so status doesn't report stale pids
// EDGE: silent no-op if file doesn't exist
export function deletePid(rootDir: string, envName: string, serviceName: string): void {
  const pidPath = path.join(getStateDir(rootDir), 'pids', `${envName}-${serviceName}.pid`);
  if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
}

// ✦ END manifest.ts
