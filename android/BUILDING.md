# Building the Android APK (Capacitor)

The APK is a thin native shell around the web app. Two update paths:

## Fast path — no APK rebuild (recommended during the hackathon)
Uncomment `server.url` in `capacitor.config.ts` and point it at your deployed
site (or your dev machine's LAN IP for live dev), rebuild the APK **once**:
```
npm run build
npx cap sync android
cd android && .\gradlew assembleDebug
```
The APK then loads all app logic from the URL. Pushing web changes is instant —
redeploy the site and the app updates on next open (the PWA service worker
auto-updates). Only native-plugin changes need a new APK.

## Bundled path — fully offline UI inside the APK
Comment `server.url` back out, then for every change:
```
npm run build
npx cap sync android
cd android && .\gradlew assembleDebug
```
APK output: `android/app/build/outputs/apk/debug/app-debug.apk`

## Adding native powers (the reason for Capacitor)
```
npm i @capacitor/local-notifications   # scheduled dose alarms, works offline
npm i @capacitor/push-notifications    # FCM push (family escalation)
npx cap sync android
```
After installing a plugin, one APK rebuild is required; after that, all web
changes still ship via the fast path.
