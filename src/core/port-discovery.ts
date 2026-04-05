// ✦ port-discovery.ts — auto-detect how each service reads its port configuration

import fs from 'fs';
import path from 'path';
import type { PortInterface } from './types.js';

export interface DiscoveredPortConfig {
  interface: PortInterface;
  portFlag?: string;
  envVar?: string;
  framework?: string;
  confidence: number;
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const KNOWN_FRAMEWORKS: Record<string, { interface: PortInterface; envVar: string; cliFlag?: string }> = {
  next: { interface: 'cli', envVar: 'PORT', cliFlag: '-p' },
  '@langchain/langgraph-cli': { interface: 'cli', envVar: 'PORT', cliFlag: '--port' },
  express: { interface: 'env', envVar: 'PORT' },
  fastify: { interface: 'env', envVar: 'PORT' },
  nest: { interface: 'env', envVar: 'PORT' },
  nuxt: { interface: 'env', envVar: 'NUXT_PORT' },
  vite: { interface: 'env', envVar: 'PORT' },
  webpack: { interface: 'env', envVar: 'PORT' },
  python: { interface: 'cli', envVar: 'PORT', cliFlag: '--port' },
  flask: { interface: 'env', envVar: 'PORT' },
  django: { interface: 'env', envVar: 'PORT' },
};

function detectFramework(pkg: PackageJson): { framework: string; config: (typeof KNOWN_FRAMEWORKS)[string] } | null {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  
  for (const [key, config] of Object.entries(KNOWN_FRAMEWORKS)) {
    if (deps[key]) {
      return { framework: key, config };
    }
  }
  
  if (deps.next) return { framework: 'next', config: KNOWN_FRAMEWORKS.next };
  
  return null;
}

function extractPortFromScript(script: string): { flag: string; port: number } | null {
  const patterns = [
    /--port[=\s]+(\d+)/,
    /-p\s*(\d+)/,
    /PORT[=\s]+(\d+)/,
    /"port"\s*:\s*"?(\d+)"?/,
  ];
  
  for (const pattern of patterns) {
    const match = script.match(pattern);
    if (match) {
      const port = parseInt(match[1], 10);
      if (port > 0 && port < 65536) {
        const flag = pattern.source.startsWith('--port') ? '--port' : '-p';
        return { flag, port };
      }
    }
  }
  return null;
}

function detectCliFlag(script: string): string | null {
  if (script.includes('--port')) return '--port';
  if (script.includes('-p ')) return '-p';
  return null;
}

function scanEnvFile(envPath: string): { envVar: string; hasPort: boolean }[] {
  if (!fs.existsSync(envPath)) return [];
  
  const content = fs.readFileSync(envPath, 'utf8');
  const results: { envVar: string; hasPort: boolean }[] = [];
  
  const portVars = ['PORT', 'NODE_PORT', 'SERVER_PORT', 'APP_PORT'];
  const urlVars = ['_URL', '_HOST', 'API_URL', 'BACKEND_URL'];
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    
    if (portVars.includes(key)) {
      results.push({ envVar: key, hasPort: /^\d+$/.test(value) });
    }
    
    if (urlVars.some((v) => key.includes(v))) {
      const portMatch = value.match(/:(\d+)/);
      if (portMatch) {
        results.push({ envVar: key, hasPort: true });
      }
    }
  }
  
  return results;
}

export function discoverPortConfig(repoPath: string): DiscoveredPortConfig {
  const pkgPath = path.join(repoPath, 'package.json');
  const envPath = path.join(repoPath, '.env');
  const envLocalPath = path.join(repoPath, '.env.local');
  
  let pkg: PackageJson = {};
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
      // ignore parse errors
    }
  }
  
  const framework = detectFramework(pkg);
  const envResults = [
    ...scanEnvFile(envPath),
    ...scanEnvFile(envLocalPath),
  ];
  
  const devScript = pkg.scripts?.dev || pkg.scripts?.start;
  const cliFlag = devScript ? detectCliFlag(devScript) : null;
  const portInScript = devScript ? extractPortFromScript(devScript) : null;
  
  if (framework) {
    const { config } = framework;
    
    const hasCliFlag = cliFlag && devScript?.includes(cliFlag);
    const envHasPort = envResults.some((r) => r.hasPort && r.envVar === config.envVar);
    
    let interface_: PortInterface = config.interface;
    let confidence = 0.8;
    
    if (hasCliFlag) {
      interface_ = 'cli';
      confidence = 0.95;
    } else if (envHasPort) {
      interface_ = 'env_file';
      confidence = 0.85;
    }
    
    return {
      interface: interface_,
      portFlag: cliFlag || config.cliFlag,
      envVar: config.envVar,
      framework: framework.framework,
      confidence,
    };
  }
  
  if (cliFlag) {
    return {
      interface: 'cli',
      portFlag: cliFlag,
      envVar: 'PORT',
      confidence: 0.7,
    };
  }
  
  if (envResults.length > 0) {
    return {
      interface: 'env_file',
      envVar: envResults[0].envVar,
      confidence: 0.6,
    };
  }
  
  return {
    interface: 'unknown',
    envVar: 'PORT',
    confidence: 0.3,
  };
}

export function generatePortRewrites(
  repoPath: string,
  serviceName: string,
  services: { name: string; port: number }[]
): { env_var: string; template: string }[] {
  const rewrites: { env_var: string; template: string }[] = [];
  const envPath = path.join(repoPath, '.env');
  
  if (!fs.existsSync(envPath)) return rewrites;
  
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
        const referencedPort = parseInt(urlMatch[1], 10);
        
        const targetService = services.find((s) => s.port === referencedPort);
        if (targetService && targetService.name !== serviceName) {
          rewrites.push({
            env_var: key,
            template: `http://localhost:{${targetService.name}.port}`,
          });
        }
      }
    }
    
    if (key.includes('API_URL') || key.includes('BACKEND_URL')) {
      for (const svc of services) {
        if (svc.name !== serviceName && value.includes(String(svc.port))) {
          rewrites.push({
            env_var: key,
            template: `http://localhost:{${svc.name}.port}`,
          });
        }
      }
    }
  }
  
  return rewrites;
}
