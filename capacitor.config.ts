import type { CapacitorConfig } from '@capacitor/cli'

const androidApp = process.env.LIMITLESS_ANDROID_APP === '1'

const config: CapacitorConfig = {
  appId: androidApp ? 'app.limitless.mobile' : 'app.limitless.telegramtest',
  appName: androidApp ? 'Limitless' : 'Limitless Test Lab',
  webDir: androidApp ? 'dist' : 'dist-telegram-lab',
  android: {
    path: androidApp ? 'android' : 'mobile-lab/android',
    ...(androidApp ? { webContentsDebuggingEnabled: false, loggingBehavior: 'none' } as const : {}),
  },
  ios: { path: 'mobile-lab/ios' },
  server: {
    hostname: 'localhost',
    androidScheme: 'https',
  },
}

export default config
