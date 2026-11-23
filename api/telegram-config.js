import { readTelegramConfig } from '../server/telegram-config.mjs'

const cachePolicy = { 'Cache-Control': 'private, no-store' }

export default {
  fetch(request) {
    const url = new URL(request.url)
    const { VERCEL_ENV, VERCEL_URL, VERCEL_BRANCH_URL } = process.env
    // The generated preview URLs are behind project-level Vercel Authentication.
    if (VERCEL_ENV !== 'preview' || url.protocol !== 'https:' || !url.host.endsWith('.vercel.app')
      || (url.host !== VERCEL_URL && url.host !== VERCEL_BRANCH_URL)) {
      return new Response(null, { status: 404, headers: cachePolicy })
    }

    const origin = request.headers.get('Origin')
    const fetchSite = request.headers.get('Sec-Fetch-Site')
    if ((origin && origin !== url.origin) || (fetchSite && fetchSite !== 'same-origin')) {
      return new Response(null, { status: 403, headers: cachePolicy })
    }
    if (request.method !== 'GET') {
      return new Response(null, { status: 405, headers: { ...cachePolicy, Allow: 'GET' } })
    }

    const config = readTelegramConfig(process.env)
    if (!config) return new Response(null, { status: 503, headers: cachePolicy })
    return Response.json(config, { headers: cachePolicy })
  },
}
