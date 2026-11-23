import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'
import { readTelegramConfig } from './server/telegram-config.mjs'

function localTelegramConfig(env: Record<string, string>): Plugin {
  const config = readTelegramConfig(env)

  const serveConfig: Connect.NextHandleFunction = (request, response) => {
    const { host, origin, 'sec-fetch-site': fetchSite } = request.headers
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
    const localHost = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host ?? '')
    response.setHeader('Cache-Control', 'no-store')

    // The browser needs the application credentials to open a direct Telegram connection.
    if (!loopback || !localHost || (origin && origin !== `http://${host}` && origin !== `https://${host}`)
      || (fetchSite && fetchSite !== 'same-origin')) {
      response.writeHead(403).end()
      return
    }
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end()
      return
    }
    if (!config) {
      response.writeHead(503).end()
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(config))
  }

  return {
    name: 'limitless-local-telegram-config',
    configureServer(server) {
      server.middlewares.use('/__limitless/telegram-config', serveConfig)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/__limitless/telegram-config', serveConfig)
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), localTelegramConfig(loadEnv(mode, process.cwd(), 'LIMITLESS_TELEGRAM_'))],
  server: {
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.qa.local/**'] },
  },
  optimizeDeps: {
    entries: ['index.html', 'telegram-lab.html', 'telegram-pilot.html'],
    exclude: ['@mtcute/wasm'],
  },
}))
