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

### Run the Android app

Use Android Studio with SDK 36 and Java 21. From the project root, run `npm run android:sync`. Build the debug APK from the `android` directory with `.\gradlew.bat :app:assembleDebug` on Windows, or open that directory in Android Studio and build the `app` module. The output is `android/app/build/outputs/apk/debug/app-debug.apk` for `app.limitless.mobile`.

Run `npm run android:setup-file` to generate the private setup file from your local Telegram configuration. Transfer the APK and setup file to your phone. Install Limitless, choose the setup file once, and sign in with your phone number and code. The setup file contains the app's Telegram API credentials and should be transferred privately. The Android app encrypts its saved session with Android Keystore and offers **Resume saved sign-in** when relaunched.

Pick files with the Android file picker. After downloading a file inside Limitless, use **Save to Downloads** or **Share**. Android 10 and later save to `Downloads/Limitless`. Android 7–9 ask you to choose a save location. To transfer existing subgroup links and organization from the web app, restore your organization backup on Android with the same Telegram account. See the [Android device checklist](TELEGRAM_TEST.md#phase-5-android-app).

### Use Saved Messages in Limitless

For a local checkout, configure the Telegram application once in an untracked `.env.local` file in the project root. Set `LIMITLESS_TELEGRAM_API_ID` and `LIMITLESS_TELEGRAM_API_HASH` using [Telegram API development tools](https://my.telegram.org/apps), then start or restart the local server. The server provides the configuration to its local browser for the direct Telegram connection. A static deployment needs its own sign-in configuration.

Open the main app, choose your country code, and enter your Telegram phone number. Submit the code Telegram sends. If your account has two-step verification, enter your Telegram password when prompted. Limitless opens Saved Messages after sign-in. Select **Local library** to browse your device imports and albums.

**Choose file** stages a file for review, and **Send to Saved Messages** performs the upload. You can cancel a send or retry the same transfer while the tab is open. Use **Load older messages** to browse additional pages.

Album and favorite changes are saved in this browser for the connected account. The file stays in its original Telegram chat. To download a file, open it, choose **Download**, then **Save file**. Browser downloads are capped at 100 MiB and previews at 16 MiB. Use **Sign out** to end the Telegram session. Closing the tab clears local access.

### Use private Telegram chats for subgroups

While signed in to Telegram in Limitless, open **Telegram subgroups**, select an existing album, and enter a subgroup name. **Add subgroup** saves the setup in this browser, creates a private group under your Telegram account, and moves it to **Archived Chats**. Its Telegram title uses `Album · Subgroup`. Repeat for as many subgroups as you need, subject to Telegram’s group and rate limits.

Use the **Telegram chat** menu to browse or upload to a subgroup. In Telegram, open **Archived Chats** and find the group by title to manage its files. If you change the group’s files in Telegram, refresh the subgroup in Limitless. You can also use **Open in Telegram** in a subgroup file’s details. The album-to-chat links are stored in the current browser profile for your Telegram account.

If setup stops partway through, use the action next to the subgroup. **Set up chat** retries a rejected creation or completes an older draft. **Find created chat** checks the original title and description when Telegram’s confirmation was interrupted. **Archive chat** retries archiving a chat already created.

See the [connected workspace checklist](TELEGRAM_TEST.md#phase-3-connected-workspace) for live verification.

### Organize and back up your Telegram library

In **Local library → Albums**, open an album and use **New child album** to build a nested structure. In the connected workspace, open a file to assign an album or edit its tags. Use the album, favorite, and tag filters to narrow the files currently loaded from the selected chat. **Select files** lets you apply an album, favorite, or tags to several files at once.

When you stage an upload, Limitless flags a possible duplicate if a loaded file in the selected chat has the same name and size. To look for older matches, load more messages first.

Use **Organization backup → Export backup** to save a versioned JSON file containing the connected account’s album assignments, their parent albums, favorites, tags, and subgroup links. Sign in with the same Telegram account to choose and restore it. Restore adds missing records and keeps existing organization. The backup covers organization metadata. Telegram holds the files, and device-only imports need their own copies. Use **Check indexed files in this chat** to see whether any linked attachments are unavailable in Telegram.

New libraries include [sample photos](public/demo/CREDITS.md).
