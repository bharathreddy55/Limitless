export function readTelegramConfig(env) {
  const apiId = Number(env.LIMITLESS_TELEGRAM_API_ID)
  const apiHash = env.LIMITLESS_TELEGRAM_API_HASH?.trim() ?? ''
  if (!Number.isInteger(apiId) || apiId <= 0 || apiId > 2_147_483_647 || !/^[a-f\d]{32}$/i.test(apiHash)) return null
  return { apiId, apiHash }
}
