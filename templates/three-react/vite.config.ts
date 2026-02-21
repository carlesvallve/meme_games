import { createViteConfig } from '@sttg/game-base/vite';
import react from '@vitejs/plugin-react';

const base = createViteConfig({ port: 3000 });

export default {
  ...base,
  plugins: [react()],
};
