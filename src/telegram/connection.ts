import { MemoryStorage, MtTimeoutError, MtUnsupportedError, TelegramClient, User, tl, type BaseTelegramClientOptions } from '@mtcute/web'

export type TelegramEnvironment = 'test' | 'production'

export class TelegramError extends Error {}

export function isExpiredTelegramSession(error: unknown) {
  return tl.RpcError.is(error) && (error.code === 401 || ['AUTH_KEY_DUPLICATED', 'SESSION_REVOKED', 'AUTH_KEY_UNREGISTERED', 'SESSION_EXPIRED'].includes(error.text))
}

function normalizePhone(input: string) {
  const phone = input.trim().replace(/[\s().-]/g, '')
  if (!/^\+[1-9]\d{1,14}$/.test(phone)) {
    throw new TelegramError('Enter the complete phone number, starting with + and the country code.')
  }
  return phone
}

export function describeFailure(error: unknown, fallback: string, environment: TelegramEnvironment) {
  const server = environment === 'test' ? 'Telegram’s Test Server' : 'Telegram Production'
  const account = environment === 'test' ? 'Test Server account' : 'Telegram account'
  if (error instanceof TelegramError) return error.message
  if (error instanceof MtTimeoutError || (error instanceof DOMException && error.name === 'TimeoutError')) {
    return `${server} did not respond in time.`
  }
  if (error instanceof MtUnsupportedError && /signup/i.test(error.message)) {
    return `Use a phone number already registered for a ${account}.`
  }
  if (tl.RpcError.is(error)) {
    const wait = /^FLOOD_WAIT_(\d+)$/.exec(error.text)
    if (wait) return `Telegram asks you to wait ${wait[1]} seconds before trying again.`
    if (error.text === 'API_ID_INVALID') return 'Telegram rejected the API ID or API hash. Check them in API development tools.'
    if (['SESSION_REVOKED', 'AUTH_KEY_UNREGISTERED', 'SESSION_EXPIRED'].includes(error.text)) {
      return 'This session is no longer authorized. Sign out and sign in again.'
    }
    if (error.text === 'PHONE_NUMBER_BANNED') return `${server} rejected this phone number.`
    if (error.text === 'PHONE_NUMBER_INVALID') return `Check the country code and the phone number registered for your ${account}.`
    if (error.text === 'PHONE_NUMBER_APP_SIGNUP_FORBIDDEN' || error.text === 'PHONE_NUMBER_UNOCCUPIED') {
      return `Use a phone number already registered for a ${account}.`
    }
    if (error.text === 'SESSION_PASSWORD_NEEDED') return 'This account requires its two-step verification password.'
    if (error.text === 'PHONE_CODE_INVALID') return 'Telegram rejected that sign-in code.'
    if (error.text === 'PHONE_CODE_EXPIRED') return 'That code expired. Start over to request another.'
    if (error.text === 'PASSWORD_HASH_INVALID') return 'Telegram rejected the two-step verification password.'
    if (/^[A-Z]+(?:_[A-Z]+)*$/.test(error.text)) return `${server} returned ${error.text}.`
  }
  return fallback
}

export function createConnection(environment: TelegramEnvironment, apiId: number, apiHash: string, network?: BaseTelegramClientOptions['network']) {
  if (!Number.isInteger(apiId) || apiId <= 0 || apiId > 2_147_483_647 || !/^[a-f\d]{32}$/i.test(apiHash)) {
    throw new TelegramError('Enter the numeric API ID and the 32-character API hash from Telegram.')
  }

  const testMode = environment === 'test'
  const client = new TelegramClient({
    apiId,
    apiHash,
    testMode,
    storage: new MemoryStorage(),
    disableUpdates: true,
    logLevel: 0,
    network,
  })
  let challenge: { phone: string; phoneCodeHash: string } | undefined
  let accountId: number | undefined

  return {
    client,
    async requestCode(phoneInput: string) {
      const phone = normalizePhone(phoneInput)
      const config = await client.call({ _: 'help.getConfig' }, {
        timeout: 15000, floodSleepThreshold: 0, abortSignal: AbortSignal.timeout(15000),
      })
      if (config.testMode !== testMode) throw new TelegramError('Telegram reported an unexpected server environment. Sign-in was stopped.')
      try {
        const sent = await client.sendCode({ phone, abortSignal: AbortSignal.timeout(20000) })
        if (sent instanceof User) {
          accountId = sent.id
          return { kind: 'signed-in' } as const
        }
        if (sent.type !== 'sms' && sent.type !== 'app' && sent.type !== 'call' && sent.type !== 'email') {
          throw new TelegramError('Telegram requested a sign-in method this page does not support.')
        }
        challenge = { phone, phoneCodeHash: sent.phoneCodeHash }
        return { kind: 'code', delivery: sent.type } as const
      } catch (error) {
        if (tl.RpcError.is(error, 'SESSION_PASSWORD_NEEDED')) return { kind: 'password' } as const
        throw error
      }
    },

    async submitCode(phoneCode: string) {
      if (!challenge) throw new TelegramError('Request a sign-in code first.')
      try {
        const user = await client.signIn({ ...challenge, phoneCode, abortSignal: AbortSignal.timeout(20000) })
        accountId = user.id
        challenge = undefined
        return 'signed-in' as const
      } catch (error) {
        if (tl.RpcError.is(error, 'SESSION_PASSWORD_NEEDED')) {
          challenge = undefined
          return 'password' as const
        }
        throw error
      }
    },

    async submitPassword(password: string) {
      const user = await client.checkPassword({ password, abortSignal: AbortSignal.timeout(20000) })
      accountId = user.id
    },

    get accountId() {
      if (accountId === undefined) throw new TelegramError('Sign in to your Telegram account first.')
      return accountId
    },

    async resume(session: string) {
      await client.importSession(session)
      const user = await client.getMe()
      accountId = user.id
    },

    async reconnect() {
      await client.disconnect()
      await client.connect()
      const user = await client.getMe()
      if (user.id !== accountId) throw new TelegramError('Telegram reconnected as a different account.')
    },

    async close(signOut: boolean) {
      try {
        if (signOut) {
          await client.call({ _: 'auth.logOut' }, {
            timeout: 15000, abortSignal: AbortSignal.timeout(15000), floodSleepThreshold: 0,
          })
          await client.notifyLoggedOut()
        }
      } finally {
        await client.destroy()
      }
    },
  }
}
