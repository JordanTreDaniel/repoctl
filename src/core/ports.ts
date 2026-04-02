// ✦ ports.ts — port assignment and conflict detection for repoctl environments

import { execSync } from 'child_process';
import type { RepoctlConfig, ServiceConfig } from './types.js';
import { listManifests } from './manifest.js';

// WHAT: returns the next available env_index by checking existing manifests
// WHY:  each env needs a unique port block; indexes must not collide
// EDGE: gaps in indexes are not reused — new envs always take the next highest + 1
export function nextEnvIndex(rootDir: string): number {
  const existing = listManifests(rootDir);
  if (existing.length === 0) return 0;
  const max = Math.max(...existing.map((m) => m.env_index));
  return max + 1;
}

// WHAT: computes the port for a service given its config and env index
// WHY:  port assignment is base + (index * stride) + offset, deterministic from config
// EDGE: if stride is too small, services from different envs may collide — validate on init
export function computePort(config: RepoctlConfig, svc: ServiceConfig, envIndex: number): number {
  return config.port_strategy.base + envIndex * config.port_strategy.stride + svc.port_offset;
}

// WHAT: builds a map of service name to port for a given env index
// WHY:  callers need all ports at once for .env patching and display
// EDGE: returns all services, including ones that may share the same port_offset (misconfiguration)
export function computePortMap(
  config: RepoctlConfig,
  envIndex: number
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const svc of config.services) {
    result[svc.name] = computePort(config, svc, envIndex);
  }
  return result;
}

// WHAT: checks whether a TCP port is currently in use on localhost
// WHY:  fail-fast before creating an env whose ports are already bound
// EDGE: uses lsof which is macOS/Linux only; Windows not supported
export function isPortInUse(port: number): boolean {
  try {
    const out = execSync(`lsof -i TCP:${port} -sTCP:LISTEN -t 2>/dev/null`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

// WHAT: validates that none of the ports in a port map are already in use
// WHY:  prevent confusing errors when a service fails to start because the port is taken
// EDGE: only checks the OS port state; another repoctl env could be assigned the same port in its manifest
export function checkPortConflicts(portMap: Record<string, number>): string[] {
  const conflicts: string[] = [];
  for (const [svcName, port] of Object.entries(portMap)) {
    if (isPortInUse(port)) {
      conflicts.push(`${svcName} → port ${port} is already in use`);
    }
  }
  return conflicts;
}

// WHAT: checks manifest collisions — same env_index used by two different envs
// WHY:  if two envs share an index they share ports, causing runtime conflicts
// EDGE: this should never happen in normal usage but guards against manual manifest edits
export function checkIndexCollision(rootDir: string, newIndex: number, newName: string): boolean {
  const existing = listManifests(rootDir);
  return existing.some((m) => m.env_index === newIndex && m.name !== newName);
}

// ✦ END ports.ts
