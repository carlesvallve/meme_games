import { createViteConfig } from '@sttg/game-base/vite';

// Strudel's supradough uses `?audioworklet` imports for its AudioWorklet processor.
// Vite doesn't handle this suffix natively, so we add a plugin that treats it
// like `?url` — returns a URL to the worklet file that can be passed to addModule().
function strudelAudioWorkletPlugin() {
  return {
    name: 'strudel-audioworklet',
    enforce: 'pre',
    resolveId(id) {
      if (id.endsWith('?audioworklet')) {
        // Rewrite to ?url so Vite serves it as a static asset URL
        return id.replace('?audioworklet', '?url');
      }
      return null;
    },
  };
}

const base = createViteConfig({ port: 3000 });

export default {
  ...base,
  plugins: [...(base.plugins || []), strudelAudioWorkletPlugin()],
};
