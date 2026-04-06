// ✦ env-files.ts — copy and patch .env files for isolated environments

import fs from 'fs';
import path from 'path';
import type { RepoctlConfig, PortRewrite, ServiceConfig } from './types.js';

function autoDetectPortRewrites(
  rootDir: string,
  services: ServiceConfig[]
): PortRewrite[] {
  const rewrites: PortRewrite[] = [];
  
  for (const svc of services) {
    const envPath = path.join(rootDir, svc.repo, svc.env_file ?? '.env');
    
    if (!fs.existsSync(envPath)) continue;
    
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      
      if (key.startsWith('NEXT_PUBLIC_') && (key.includes('URL') || key.includes('HOST'))) {
        const urlMatch = value.match(/localhost:(\d+)/);
        if (urlMatch) {
          const refPort = parseInt(urlMatch[1], 10);
          
          const targetSvc = services.find((s) => s.port === refPort);
          if (targetSvc && targetSvc.name !== svc.name) {
            rewrites.push({
              service: svc.name,
              env_var: key,
              template: `http://localhost:{${targetSvc.name}.port}`,
            });
          }
        }
      }
      
      if ((key.includes('API_URL') || key.includes('BACKEND_URL') || key.includes('FRONTEND_URL')) && value.includes('localhost')) {
        for (const targetSvc of services) {
          if (targetSvc.name !== svc.name && value.includes(String(targetSvc.port))) {
            rewrites.push({
              service: svc.name,
              env_var: key,
              template: `http://localhost:{${targetSvc.name}.port}`,
            });
            break;
          }
        }
      }
    }
  }
  
  return rewrites;
}

// WHAT: reads an .env file into a key-value map
// WHY:  patching individual vars requires parsing the file first
// EDGE: skips blank lines and comment lines; does not support multi-line values
export function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const result: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    result[key] = value;
  }
  return result;
}

// WHAT: serializes a key-value map back to .env file format
// WHY:  after patching env vars, we need to write the file back
// EDGE: does not preserve comments or ordering from the original file
export function serializeEnvFile(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

// WHAT: resolves a port_rewrite template to a concrete URL/value
// WHY:  cross-service URLs reference each other by port; templates encode that relationship
// EDGE: only supports {service-name.port} tokens; unknown tokens are left as-is
export function resolveTemplate(
  template: string,
  portMap: Record<string, number>
): string {
  return template.replace(/\{([\w-]+)\.port\}/g, (_, svcName) => {
    const port = portMap[svcName];
    return port != null ? String(port) : `{${svcName}.port}`;
  });
}

// WHAT: copies the base .env file for a service and patches port-related vars
// WHY:  each env needs its own .env with correct ports so services don't cross-talk
// EDGE: if the source .env doesn't exist, an empty file is created — service may fail to start
export function setupEnvFile(opts: {
  sourceEnvPath: string;
  targetDir: string;
  envFileName: string;
  portMap: Record<string, number>;
  servicePort: number;
  portRewrites: PortRewrite[];
  targetServiceName: string;
  dbEnvVar?: string;
  dbFileName?: string;
}): void {
  const {
    sourceEnvPath,
    targetDir,
    envFileName,
    portMap,
    servicePort,
    portRewrites,
    targetServiceName,
    dbEnvVar,
    dbFileName,
  } = opts;

  const vars = parseEnvFile(sourceEnvPath);

  // patch the service's own port
  vars['PORT'] = String(servicePort);

  // apply cross-service URL rewrites for this service
  const rewrites = portRewrites.filter((r) => r.service === targetServiceName);
  console.log(`[DEBUG setupEnvFile] ${targetServiceName}: rewrites=`, JSON.stringify(rewrites));
  for (const rewrite of rewrites) {
    const resolved = resolveTemplate(rewrite.template, portMap);
    console.log(`[DEBUG setupEnvFile] ${targetServiceName}: setting ${rewrite.env_var} = ${resolved}`);
    vars[rewrite.env_var] = resolved;
  }

  // patch database file if this service owns it
  if (dbEnvVar && dbFileName) {
    vars[dbEnvVar] = dbFileName;
  }

  const targetPath = path.join(targetDir, envFileName);
  fs.writeFileSync(targetPath, serializeEnvFile(vars), 'utf8');
}

// WHAT: copies all files listed in worktree_copy from base repo into the worktree
// WHY:  gitignored files like .env.local aren't checked in but services need them
// EDGE: if the source file doesn't exist, the copy is skipped (not an error); .gitignore is always included
export function copyWorktreeFiles(
  baseRepoDir: string,
  worktreeDir: string,
  filesToCopy: string[]
): void {
  // Always copy .gitignore so worktree inherits parent repo's ignores (e.g., dist/)
  const gitignoreSrc = path.join(baseRepoDir, '.gitignore');
  const gitignoreDst = path.join(worktreeDir, '.gitignore');
  if (fs.existsSync(gitignoreSrc)) {
    fs.copyFileSync(gitignoreSrc, gitignoreDst);
  }

  for (const relPath of filesToCopy) {
    const src = path.join(baseRepoDir, relPath);
    const dst = path.join(worktreeDir, relPath);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

// WHAT: sets up all .env files for every service in an environment
// WHY:  env create needs to configure all services in one pass
// EDGE: each service's .env_file defaults to '.env' if not set in config
export function setupAllEnvFiles(opts: {
  rootDir: string;
  config: RepoctlConfig;
  envName: string;
  portMap: Record<string, number>;
  worktreePaths: Record<string, string>;
  dbFileName?: string;
}): void {
  const { rootDir, config, envName, portMap, worktreePaths, dbFileName } = opts;

  const explicitRewrites = config.port_rewrites ?? [];
  const autoRewrites = autoDetectPortRewrites(rootDir, config.services);
  
  console.log('[DEBUG] Auto-detected rewrites:', JSON.stringify(autoRewrites, null, 2));
  console.log('[DEBUG] portMap:', JSON.stringify(portMap));
  
  const mergedRewrites: PortRewrite[] = [...explicitRewrites];
  for (const auto of autoRewrites) {
    const exists = mergedRewrites.some(
      (r) => r.service === auto.service && r.env_var === auto.env_var
    );
    if (!exists) {
      mergedRewrites.push(auto);
    }
  }

  for (const svc of config.services) {
    const wtDir = worktreePaths[svc.name];
    const envFileName = svc.env_file ?? '.env';
    const sourceEnvPath = path.join(rootDir, svc.repo, envFileName);

    const isDbService = config.database?.service === svc.name;

    const svcRewrites = mergedRewrites.filter((r) => r.service === svc.name);
    console.log(`[DEBUG] ${svc.name} rewrites:`, JSON.stringify(svcRewrites));

    setupEnvFile({
      sourceEnvPath,
      targetDir: wtDir,
      envFileName,
      portMap,
      servicePort: portMap[svc.name],
      portRewrites: mergedRewrites,
      targetServiceName: svc.name,
      dbEnvVar: isDbService ? config.database?.env_var : undefined,
      dbFileName: isDbService ? dbFileName : undefined,
    });

    // copy any extra gitignored files
    if (config.worktree_copy && config.worktree_copy.length > 0) {
      const baseRepoDir = path.join(rootDir, svc.repo);
      copyWorktreeFiles(baseRepoDir, wtDir, config.worktree_copy);
    }
  }
}

// ✦ END env-files.ts
