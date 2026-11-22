# Phase 2 Telegram test lab

The browser candidate is `@mtcute/web` 0.32.8 (MIT). It supports MTProto over WebSockets and browser cryptography. The test page uses memory-only session storage and connects to Telegram's test network. It checks the server's test-mode flag before signing in. The lab is served by the local development server and is excluded from the production build. [Client documentation](https://mtcute.dev/guide/) · [Telegram test accounts](https://core.telegram.org/api/auth#test-accounts)

## Run the web test

1. Get the project's API ID and hash through [Telegram API development tools](https://my.telegram.org/apps). Enter them directly in the local lab form. Keep the hash out of chat, screenshots, Git, and logs. [Telegram API registration](https://core.telegram.org/api/obtaining_api_id)
2. Run `npm run dev` inside Limitless and open `/telegram-lab.html` on the printed loopback address, typically `http://127.0.0.1:5173/telegram-lab.html`.
3. Use an account already registered on Telegram's Test Server. Enter its full international phone number with + and its country code. Click **Request test sign-in code** and enter the code Telegram delivers directly in the lab. The lab shows the delivery method returned by Telegram and prompts for a password if two-step verification is enabled. [Official Test Server instructions](https://core.telegram.org/bots/webapps#testing-mini-apps)
4. In **Saved Messages**, refresh the latest page. Upload a generated **64 KiB** file and click **Verify download**. The lab retrieves the exact message and compares its downloaded SHA-256 digest against the original. Repeat at **1 KiB** and **256 KiB** if those sizes pass.
5. Refresh after uploading and run **Reconnect and compare**. The test should return the same latest page of file IDs without duplicates. To check pagination, upload at least six test files and use **Load older**. The two pages should show distinct IDs.
6. Click **Sign out**. Confirm the lab reports that Telegram acknowledged sign-out, clears the test state, and requires fresh credentials. For the revoked-session case, terminate the lab session using a separate session for the same disposable test account and then refresh the lab. Telegram should deny access.

Keep a record of the device, browser or WebView version, sample size, checksum result, and reconnect and sign-out outcomes. The selectable sizes are for feasibility testing. Test servers may wipe test accounts and messages.

## Verification record

The project owner reported a **pass** for the core desktop web and Android workflows on Telegram's Test Server. The Android run used a real phone.

| Check | Desktop web | Android |
| --- | --- | --- |
| Sign-in | Signed in with a registered Test Server account. | Signed in on a real phone. |
| Upload | A generated 64 KiB file appeared in Saved Messages. | A 64 KiB file uploaded to Saved Messages. |
| Download integrity | The downloaded file's SHA-256 matched the original. | The downloaded file's SHA-256 matched the original. |
| Reconnect | The same file appeared without duplicates. | The same file appeared without duplicates. |
| Sign-out | Telegram acknowledged sign-out and Limitless cleared the local session. | Sign-out cleared the local session. |

The project owner also reported a **pass** for Android network recovery on Telegram's Test Server. After connectivity was restored, the 256 KiB test file appeared in Saved Messages. The downloaded file's SHA-256 matched the original, and reconnecting showed no duplicates.

iOS testing is deferred. Two-step verification, pagination across multiple pages, remote session revocation, and other file sizes remain unrecorded.

### Production account pilot

**Complete.** The project owner's screenshots show a successful production sign-in and one generated 64 KiB upload to Saved Messages (message #6025). The original and downloaded SHA-256 values matched for all 65,536 bytes. The project owner confirmed that reconnect returned to the same account and found the existing message #6025. Telegram confirmed sign-out, and Limitless returned to the sign-in screen with the local session cleared.

## Platform checks

| Target | What to verify | Current state |
| --- | --- | --- |
| Desktop web | Core sign-in, upload, download, reconnect, and sign-out. Follow-up cases cover two-step verification, pagination, and revocation. | **Core workflow passed** with a 64 KiB test file. Follow-up cases remain unrecorded. |
| Android System WebView | Core sign-in, upload, download, reconnect, sign-out, and network recovery. | **Core workflow passed** on a real phone with a 64 KiB file. **Network recovery passed** with a 256 KiB file. |
| iOS WKWebView | Run the same workflow, then check backgrounding and relaunch behavior on an iPhone. | **Deferred.** |
| Production account | Verify one generated 64 KiB file with the account owner's authorization. | **Complete.** Sign-in, upload, download integrity, reconnect to message #6025, and sign-out passed. |

## Run the production-account pilot

With the Limitless development server running, open [Telegram Production Pilot](http://127.0.0.1:5173/telegram-pilot.html). Check the **Production** badge before signing in. Enter the project's API ID and hash, your Telegram phone number, and the code Telegram delivers in the local form.

1. Click **Upload one 64 KiB file**. The pilot creates random bytes and sends the file to your own Saved Messages.
2. Click **Verify download**. The pilot downloads that exact message and displays the original and downloaded SHA-256 values.
3. Click **Reconnect**. The pilot verifies that the same account can still open the same message.
4. Click **Sign out**. Check for Telegram's sign-out confirmation and that the page returns to the sign-in form.

Use the same address and browser profile throughout. The pilot reserves one upload per browser profile and origin before sending. If delivery is unclear, the page shows the generated filename so you can check Saved Messages. The slot stays reserved after a reload or sign-out. Only the generated file's metadata and a derived account check are kept locally. Login details and the session stay in memory. Both this page and the native Test Server lab stay separate from the regular web build.

A local browser test with mocked Telegram responses verified the checksum, reconnect, sign-out, and the one-upload limit across tabs and reloads. See the [live pilot record](#production-account-pilot) for the checks confirmed against Telegram Production.

## Phase 3 connected workspace

Open the main Limitless app with the [local Telegram application configuration](README.md#use-saved-messages-in-limitless) in place. Sign in with your phone number and Telegram code. Live sign-in and transfer verification for this workspace are separate from the completed one-file pilot.

A mocked browser test passed for opening the workspace from the phone-number screen, retrying an invalid code, completing two-step verification when requested, and returning to the phone-number screen after sign-out.

The mocked browser workflow passed pagination, download-byte comparison, album and favorite persistence, cancelling and retrying with the same upload ID, reconnect without duplicates, missing-file handling, and sign-out.

1. Sign in and confirm the first page displays only your Saved Messages attachments. Load older messages and confirm they appear without duplicates.
2. Choose a small disposable file and click **Send to Saved Messages**. Verify the Telegram confirmation, open the file in the workspace, and save the download. Compare its bytes or SHA-256 to the original.
3. Use a disposable file to test cancellation while the upload is in progress. Restore connectivity, click **Retry same transfer**, and refresh. Confirm one source message in Telegram. The retry reuses the same upload ID for the staged file in that tab. If Telegram reports it has already seen the upload ID, refresh to check for delivery.
4. Add a file to a Limitless album, then choose **No album**. Verify the message stays in Telegram. Delete a disposable file directly in Telegram, then check that Limitless reports it missing and drops it when the relevant page is refreshed.
5. Reconnect, then use **Sign out** and verify the sign-in form returns. Reopen with the same account to check local album and favorite metadata. It is stored separately per Telegram account.

### Telegram subgroup checklist

A mocked browser test passed for one-click creation and archiving across multiple albums and subgroups, duplicate prevention, recovery from interrupted setup, separate upload destinations, matching download bytes, changes loaded on refresh, and reopening a subgroup after a fresh sign-in.

**Live one-click setup passed.** The project owner confirmed that **Add subgroup** in Limitless creates and archives the private chat in Telegram.

**Live subgroup transfer passed.** Telegram Production confirmed the upload to the selected subgroup. The 64 KiB download matched the original file's SHA-256 across all 65,536 bytes. Live checks for a second subgroup, isolation from Saved Messages, the direct Telegram link, refresh after Telegram edits, sign-in again, and interrupted setup are still pending.

1. In **Telegram subgroups**, choose an existing album, enter a name, and click **Add subgroup**. Wait for the archive confirmation in Limitless, then check that the named private group appears in Telegram’s **Archived Chats**.
2. Repeat under a different album. Confirm each click creates one archived chat and both appear as separate destinations in Limitless.
3. Send a small disposable file to the first subgroup. Verify the bytes on download and check that the second chat and Saved Messages show their own files. Open the message directly in Telegram from its details.
4. Add or delete a disposable file in Telegram, then refresh the associated subgroup in Limitless. Sign out, sign back in to the same account, and confirm the subgroup opens again.
5. If setup is interrupted, use **Set up chat**, **Find created chat**, or **Archive chat**, as shown. Verify recovery leaves one Telegram group per subgroup.

## Phase 4 organization and recovery

A mocked browser test passed for nested albums, bulk album and tag changes, favorites, tag filtering, duplicate warnings, checking missing files, rejecting another account’s backup, and restoring a linked subgroup and its organization in a fresh browser profile.

**Live recovery passed.** The project owner exported the organization backup, opened a fresh private browser window, and restored it after signing in with the same Telegram account. The subgroup returned, and the test file retained its album assignment, tag, and favorite status. Restoring the same backup again added no duplicate albums or records.

1. Create a child album under an existing album. In the connected workspace, use **Select files** to apply the album, a favorite, and tags to two files. Verify filters find those files.
2. Stage an upload with the same name and size as a loaded file in the selected chat. Verify the possible-duplicate prompt appears. Dismiss the upload after checking the prompt.
3. Export an **Organization backup**. Use a fresh browser profile at the same app address, sign in with the same Telegram account, and restore the backup. Confirm the nested album path, tags, favorites, and subgroup links are available. Importing the same file again should add no duplicate records.
4. Use **Check indexed files in this chat**. If an indexed attachment was already removed in Telegram, verify it is reported as unavailable and the organization record is kept.
5. Try the backup while signed in with another Telegram account you control. The app should reject it before applying any changes.

## Run the mobile test

Build the dedicated test bundle from the repo. It uses the same lab as desktop and keeps its sessions in memory. Capacitor loads the bundle from its local app origin, and the lab checks for a secure cryptography context before showing credential fields. The regular web build stays separate.

On Android, install the debug APK on a test device or run the Capacitor project on a configured emulator. To regenerate the project from a clean checkout with Android Studio, SDK 36, and Java 21 available for Gradle:

```sh
npm ci
npm run lab:mobile:build
npx cap add android
npx cap run android
```

If the Android project already exists, skip `cap add`. Rerun `npm run lab:mobile:build` before each device run so Capacitor copies the current test bundle. For a build without a connected device, run `npx cap sync android`, then run `.\gradlew.bat :app:assembleDebug` from `mobile-lab/android` on Windows. The APK is generated at `mobile-lab/android/app/build/outputs/apk/debug/app-debug.apk`.

The verified local APK is for package `app.limitless.telegramtest`. It contains the lab's HTML, JavaScript, and WebAssembly assets. Its SHA-256 is `c03e159e9da73da988e6aba56323d9e408e2c3d8be5d9b07f2d19c4ac3f91bdd`.

On macOS with Xcode, run `npm ci` and `npm run lab:mobile:build`. If the generated iOS project is absent, run `npx cap add ios --packagemanager SPM`. Run `npx cap sync ios` after rebuilding and open the project with `npx cap open ios`. Choose a simulator or a signed development build on an iPhone. [Capacitor Android setup](https://capacitorjs.com/docs/android) · [Capacitor iOS setup](https://capacitorjs.com/docs/ios)

On each device, repeat the desktop 64 KiB workflow and record the device, OS, and WebView version. Also lock or background the app once during a transfer, then check which operations recover when returning. Enter credentials and codes on the test device.
