import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.limitless.telegramtest',
  appName: 'Limitless Test Lab',
  webDir: 'dist-telegram-lab',
  android: { path: 'mobile-lab/android' },
  ios: { path: 'mobile-lab/ios' },
  server: {
    hostname: 'localhost',
    androidScheme: 'https',
  },
}

export default config
