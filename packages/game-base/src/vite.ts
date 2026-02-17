import { defineConfig, type UserConfig } from 'vite';

export interface ViteConfigOptions {
  port?: number;
  base?: string;
  outDir?: string;
}

export function createViteConfig(opts: ViteConfigOptions = {}): UserConfig {
  const { port = 3000, base, outDir } = opts;

  return defineConfig({
    server: {
      port,
      host: true,
      allowedHosts: true,
    },
    base,
    build: {
      target: 'esnext',
      outDir,
    },
  }) as UserConfig;
}
