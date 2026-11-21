# MedscopeOne

A voice-first medicine companion for elderly people in Bengal. The elder only
hears and taps; the family sets it up once by photographing medicine strips.
Missed doses escalate to the family automatically — WhatsApp first, then a
spoken phone call. Free for the elder: funded by the panchayat and the state
health department.

**Reminders only.** The app never diagnoses, never suggests or changes a dose,
and never gives medical advice.

---

## How it works

```
┌────────────────────────────────┐         ┌───────────────────────────────────┐
│  PWA — Vite + React + TS +     │  sync   │  Appwrite (self-hosted)           │
│  Tailwind v4, Capacitor shell  │◄───────►│  tables: medicines, taken_logs,   │
│                                │  best-  │    devices, contacts, alerts,     │
│  IndexedDB = source of truth   │  effort │    backups                        │
│  Web Speech (TTS + STT)        │         │  Functions:                       │
│  photo → ai-proxy (vision)     │         │   • checker  (cron every 10 min)  │
└───────────────┬────────────────┘         │   • ai-proxy (HTTP, vision)       │
                │ vision POST              └──────────────┬────────────────────┘
                ▼ (guest execute)                         │
     ┌──────────────────┐                                ├─► WhatsApp Cloud API v23
     │  ai-proxy func   │──── OpenAI-compatible ────────►└─► Sarvam voice call
     └──────────────────┘      endpoint + key (server-side only)
```

Local-first: everything the elder needs lives in IndexedDB. Reminders, speech,
logging, and the dose flow work with zero internet. Appwrite is a background
sync target — the UI never waits on the network.

## The two surfaces

### Elder mode (hear and tap)
- One screen. Giant Bengali text: household nickname, time in Bengali digits,
  dose instruction. Tap anything to hear it spoken.
- At each dose time the phone speaks and re-speaks every 3 minutes until
  answered, raises a sticky notification, and holds a WakeLock.
- Big green **খেয়েছি** (Taken) with a 5-minute Undo window; big yellow
  **১০ মিনিট পরে** (Remind in 10 min). Voice input: "আমি খেয়েছি" works too.
- Always-on red Help button — one tap calls the family member. No contacts yet?
  It opens the elder's own contact manager instead.
- Gear screen (the elder's control center): add medicines by photo (the vision
  model reads the strip and auto-fills the form — no on-device OCR), manage emergency
  contacts, see the family code, pause reminders 3 days, switch language.
- Fractional doses: ¼ / ½ / 1 / 2 tablets per dose; stock counts in units.

### Family mode (configure and monitor)
- Setup: photograph a strip → AI reads it → confirm name, times, dose units,
  tablets in strip → done. Manual add as fallback.
- Medicine list grouped per elder (households support multiple elders and
  multiple family members), stock countdown ("৪ দিন বাকি"), 3-day low warning
  with one-tap 1mg reorder (no fake checkout — we hand off and stop).
- History: today / this week, taken-time or Missed per dose, "Took late"
  correction, elder names when there are several.
- Family & alerts: contacts with WhatsApp numbers; the escalation ladder shown
  as reality — 1) WhatsApp at 30 min missed, 2) Sarvam voice call at 60 min.
- Settings: language, phone-for switch, **optional** Backup & restore.

### Escalation (automatic, the elder does nothing)
`checker` runs on a 10-minute schedule. For each household: any dose 30+ min
past due with no taken log is marked missed, the family is WhatsApp'd a
personalized text (works when the recipient has messaged the test number within
24h), falling back to a template message when the customer-service window is
closed. 30 minutes after that, Sarvam places a voice call speaking the alert in
Bengali.

### Data transfer between phones (optional, hidden from onboarding)
Family Settings → Backup & restore: sign in with phone (SMS OTP) or
email/password. "Save backup" snapshots device identity + household + medicines
+ contacts into a user-owned row (row-level permissions). On a new phone, sign
in and restore — the new phone *becomes* the old device, elder identity included.

## Languages
Bengali (default), Hindi, English — chosen at first launch, switchable later in
both elder gear and family settings. i18n is language-agnostic; more languages
are a dictionary entry away.

## Stack
- **Frontend**: Vite + React + TypeScript + Tailwind v4, PWA
  (`vite-plugin-pwa`), Capacitor Android shell
- **Backend**: Appwrite (tables + functions), no other server
- **AI**: OpenAI-compatible vision endpoint behind the `ai-proxy` function
- **Auth**: none in daily use (device identity = generated key); optional
  phone/email accounts for backup/restore only

---

## Setup

### 1. Frontend
```bash
npm install
cp .env.example .env    # fill values (see below)
npm run dev
```
`.env` keys:
```
VITE_APPWRITE_ENDPOINT=   # https://appwrite.kabirstudios.com/v1
VITE_APPWRITE_PROJECT=    # medscope
VITE_APPWRITE_DATABASE_ID= # medscope
APPWRITE_API_KEY=         # server-side only, for deploying functions/schema
OPENAI_BASE_URL=          # OpenAI-compatible vision endpoint
OPENAI_API_KEY=
OPENAI_MODEL=             # a vision-capable model
WHATSAPP_TOKEN=           # permanent system-user token (see below)
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_TEMPLATE_NAME=   # optional custom template (recommended)
WHATSAPP_TEMPLATE_LANG=   # e.g. en_US
SARVAM_API_KEY=           # for the voice-call escalation
```

### 2. Appwrite schema + functions
```bash
node functions/create-backups-table.cjs   # plus the medicines/taken_logs/
node functions/deploy-checker.cjs         # devices/contacts/alerts tables —
node functions/deploy-ai-proxy.cjs        # see the idempotent setup scripts
```
Script quirks to know: this Appwrite instance only has the **node-16** function
runtime installed, and node's `fetch` crashes in this shell — the scripts use
`curl` via `execSync` and plain `node:https` inside functions.

After editing `.env`, push function variables:
```bash
node functions/set-checker-vars.cjs     # WhatsApp + Sarvam vars → checker
node functions/deploy-ai-proxy.cjs      # OPENAI_* vars → ai-proxy
node functions/verify-checker.cjs       # execute checker, verify clean run
```

### 3. WhatsApp (Meta Cloud API, test number)
1. Meta app with WhatsApp use case → API Setup → generate a **permanent**
   system-user token with `business_management`, `whatsapp_business_messaging`,
   `whatsapp_business_management`.
2. Copy the test **phone number ID**.
3. Add each family member's number as a test recipient ("To" list, **max 5**);
   they verify via WhatsApp code.
4. Business-initiated messages need a template unless the recipient messaged
   you within 24h. The checker sends personalized text first and falls back to
   a template. Create a Utility template `dose_alert`:
   `MedscopeOne: {{1}} at {{2}} was not taken today. Please check on them.`
5. Ask each family member to reply to one message — it opens the 24h window
   and keeps the personalized text path alive.

### 4. Android APK (no Android Studio)
```bash
npm run apk    # build + cap sync + gradlew assembleDebug
```
Or let CI do it: `.github/workflows/apk.yml` builds a debug APK on every push
to `main` — download `medscope-debug-apk` from the Actions run page.

**Fast iteration**: uncomment `server.url` in `capacitor.config.ts` pointing at
the deployed site, build the APK once, and every web change ships by
redeploying the site — no APK rebuild. Only native-plugin changes need one.

## Known limitations
1. **Reminders need the app open** (PWA constraint). The WhatsApp/call
   escalation is the backstop and works regardless. True background alarms
   need the Capacitor path + `@capacitor/local-notifications` (planned).
2. **Pause needs one schema field** — the phone writes `pauseUntil` onto its
   `devices` row and the checker honors it (no miss, no message, no call while
   paused). Add an integer attribute `pauseUntil` to the `devices` table in
   Appwrite for this to travel to the server; without it pause stays local.
3. **Undo deletes remotely, best-effort** — undoing a synced taken log now
   calls `deleteRow` fire-and-forget. If the phone is offline at that moment
   the row survives on the server until the next pull rewrites it.
4. **Open table permissions** — household codes are the only access control.
   Fine for demo; production wants per-household permissions.
5. **WhatsApp test number** — 5 verified recipients max; real families need a
   registered business number.
6. **No realtime pull** — family devices sync on screen load, not live
   (Appwrite realtime subscription is wired in the SDK, not yet used).
