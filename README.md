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

Album and favorite changes are saved in this browser for the connected account. The file stays in its original Telegram chat. To download a file, open it, choose **Download**, then **Save file**. Browser downloads are capped at 100 MiB and previews at 16 MiB. Use **Sign out** to end the Telegram session. Closing the tab clears local access.

### Use private Telegram chats for subgroups

While signed in to Telegram in Limitless, open **Telegram subgroups**, select an existing album, and enter a subgroup name. **Add subgroup** saves the setup in this browser, creates a private group under your Telegram account, and moves it to **Archived Chats**. Its Telegram title uses `Album · Subgroup`. Repeat for as many subgroups as you need, subject to Telegram’s group and rate limits.

Use the **Telegram chat** menu to browse or upload to a subgroup. In Telegram, open **Archived Chats** and find the group by title to manage its files. If you change the group’s files in Telegram, refresh the subgroup in Limitless. You can also use **Open in Telegram** in a subgroup file’s details. The album-to-chat links are stored in the current browser profile for your Telegram account.

If setup stops partway through, use the action next to the subgroup. **Set up chat** retries a rejected creation or completes an older draft. **Find created chat** checks the original title and description when Telegram’s confirmation was interrupted. **Archive chat** retries archiving a chat already created.

See the [connected workspace checklist](TELEGRAM_TEST.md#phase-3-connected-workspace) for live verification.

New libraries include [sample photos](public/demo/CREDITS.md).
