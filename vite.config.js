import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.PIWAKE_PROXY_TARGET;

  return {
    plugins: [react()],
    server: proxyTarget ? {
      proxy: {
        '/piwake-api': {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: path => path.replace(/^\/piwake-api/, ''),
        },
      },
    } : undefined,
  };
});
