import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.medscope.one",
  appName: "MedscopeOne",
  webDir: "dist",
  // FAST ITERATION: the APK is a thin shell that loads the deployed site.
  // Ship web changes by redeploying the site — no APK rebuild. Uncomment and
  // point at your deployment (or your dev machine IP for live dev testing),
  // then rebuild the APK once. Comment out to ship a fully-offline bundled UI.
  // server: {
  //   url: "https://medscope.yourdomain.com",
  //   cleartext: true, // only for local http dev servers
  // },
  android: {
    allowMixedContent: false,
  },
};

export default config;
