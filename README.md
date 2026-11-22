# Limitless

Limitless is a planned file manager for Telegram Saved Messages, with a web app and installable Android and iOS apps. The web app is the first milestone. The mobile apps will share the file manager's core and add device file picking, saving, and sharing.

The local file manager includes a date-grouped photo and video gallery, albums, a file list, favorites, search, multi-file import, previews, and downloads. Files and appearance preferences are saved in IndexedDB for the browser profile and address you use.

Run the app from this directory with Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Use the same address each time to open the same library. Run `npm run build` to type-check and bundle the app.

See the [phased project plan](PROJECT_PLAN.md) for Telegram integration, Android and iOS builds, and distribution.

The local development server provides a [Telegram test lab](TELEGRAM_TEST.md) and a [one-file production pilot](TELEGRAM_TEST.md#run-the-production-account-pilot) for Phase 2.

### Use Saved Messages in Limitless

Open the main app and choose **Telegram**. Sign in with your own Telegram account. **Choose file** stages a file for review, and **Send to Saved Messages** performs the upload. You can cancel a send or retry the same transfer while the tab is open. Use **Load older messages** to browse additional pages.

Album and favorite changes are saved in this browser for the connected account. Choosing **No album** leaves the Telegram message in Saved Messages. To download a file, open it, choose **Download**, then **Save file**. Browser downloads are capped at 100 MiB and previews at 16 MiB. Use **Sign out** to end the Telegram session. Closing the tab clears local access.

See the [connected workspace checklist](TELEGRAM_TEST.md#phase-3-connected-workspace) for live verification.

New libraries include [sample photos](public/demo/CREDITS.md).
