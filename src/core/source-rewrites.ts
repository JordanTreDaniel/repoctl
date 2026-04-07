// ✦ source-rewrites.ts — patch hardcoded ports in source files during env create

import fs from 'fs';
import path from 'path';
import { glob } from 'tinyglobby';
import type { RepoctlConfig, SourceRewrite } from './types.js';

export interface RewriteStats {
  filesScanned: number;
  filesModified: number;
  replacements: number;
}

function shouldExclude(filePath: string, excludes: string[]): boolean {
  for (const exclude of excludes) {
    if (exclude.endsWith('/**')) {
      const base = exclude.slice(0, -3);
      if (filePath.includes(base)) return true;
    } else if (filePath.endsWith(exclude) || filePath.includes(exclude)) {
      return true;
    }
  }
  return false;
}

function replacePortsInContent(
  content: string,
  baseToNewPort: Map<number, number>
): { content: string; count: number } {
  let count = 0;
  let result = content;

  const sortedPorts = Array.from(baseToNewPort.entries()).sort(
    (a, b) => b[0] - a[0]
  );

  for (const [basePort, newPort] of sortedPorts) {
    const baseStr = String(basePort);
    const newStr = String(newPort);

    const regex = new RegExp(`\\b${baseStr}\\b`, 'g');
    const matches = result.match(regex);
    if (matches) {
      count += matches.length;
      result = result.replace(regex, newStr);
    }
  }

  return { content: result, count };
}

export async function rewriteSourcePorts(opts: {
  config: RepoctlConfig;
  portMap: Record<string, number>;
  worktreePaths: Record<string, string>;
}): Promise<RewriteStats> {
  const { config, portMap, worktreePaths } = opts;
  const rewrites = config.source_rewrites ?? [];

  const stats: RewriteStats = {
    filesScanned: 0,
    filesModified: 0,
    replacements: 0,
  };

  if (rewrites.length === 0) {
    return stats;
  }

  for (const rewrite of rewrites) {
    const serviceName = rewrite.service;
    const worktreePath = worktreePaths[serviceName];
    if (!worktreePath) continue;

    const baseToNewPort = new Map<number, number>();
    for (const svc of config.services) {
      if (svc.name === serviceName) continue;
      const basePort = svc.port;
      const newPort = portMap[svc.name];
      if (basePort !== newPort) {
        baseToNewPort.set(basePort, newPort);
      }
    }

    if (baseToNewPort.size === 0) continue;

    const excludes = rewrite.exclude ?? [];
    const defaultExcludes = ['**/node_modules/**', '**/dist/**', '**/build/**'];
    const allExcludes = [...new Set([...defaultExcludes, ...excludes])];

    const patterns = rewrite.globs.map((g) => path.join(worktreePath, g));
    const files = await glob(patterns, {
      onlyFiles: true,
      ignore: allExcludes,
    });

    for (const filePath of files) {
      stats.filesScanned++;

      const content = fs.readFileSync(filePath, 'utf8');
      const { content: newContent, count } = replacePortsInContent(
        content,
        baseToNewPort
      );

      if (count > 0) {
        fs.writeFileSync(filePath, newContent, 'utf8');
        stats.filesModified++;
        stats.replacements += count;
        console.log(
          `    [rewrite] ${path.relative(worktreePath, filePath)}: ${count} port${count > 1 ? 's' : ''}`
        );
      }
    }
  }

  return stats;
}

// ✦ END source-rewrites.ts
