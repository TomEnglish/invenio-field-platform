# QR Asset Scanner — Setup Guide

## Prerequisites

- Node.js 18+ installed
- iPhone or Android phone
- Install **Expo Go** from the App Store / Play Store

## Getting Started

1. **Clone the repo**
   ```bash
   git clone <repo-url>
   cd <repo-folder>
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and fill in the three settings (ask the project lead for these). Use the **dev** environment's values for everyday work, never a production's. See "Environments" below.

4. **Start the dev server**
   ```bash
   npx expo start --tunnel
   ```
   This will show a QR code in your terminal.

5. **Open on your phone**
   - Open **Expo Go** on your phone
   - Scan the QR code from step 4
   - The app will download and open

## Login

Use the credentials provided to you. Your account role determines which screens you see:

- **Everyone** — four tabs along the bottom: Scan, Count, Loads, Inventory. The menu button at the top left lists every screen for your role.
- **Field Worker** — the menu adds Activity (your own work).
- **Office Staff and Administrators** — the app opens on the Dashboard, and the menu adds Dashboard, Reports, Activity, Locations and QR Codes. Exceptions and the Data Browser are on the office site; the menu opens them in the browser.

## Troubleshooting

- **"Network request failed"** — Make sure your `.env` file has the correct Supabase URL and key. Force-close Expo Go and restart.
- **App not updating** — Stop the dev server, run `npx expo start --tunnel --clear` to clear the cache.
- **Camera not working** — QR scanning requires a real device (not simulator). Make sure you granted camera permission.

## Notes

- QR scanning requires a physical device with a camera
- The app works offline — actions are queued and sync when you reconnect
- When offline, a yellow banner appears at the top of the screen

## Environments

The app is built for one environment at a time: dev, the demo production, or a customer's production. Each has its own database and its own office site (the MSR repository's `docs/ENVIRONMENTS.md` lists them). Three settings name the environment, and nothing else in the code does:

| Setting | Meaning |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | That environment's database |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | That database's public key |
| `EXPO_PUBLIC_OFFICE_SITE_URL` | That environment's office site, used for password reset and the administrator's "Manage projects and users" link |

A build for a **dev** environment has a fourth, and a production build must not have it:

| Setting | Meaning |
| --- | --- |
| `EXPO_PUBLIC_ENVIRONMENT_LABEL` | That dev environment's label, the same one its office site shows on every page (`Dev`) |

Locally they come from `.env`. For builds and published updates they come from the build service's environment variables. Each profile in `eas.json` (`development`, `preview`, `production`) names the environment of the same name, so a build never takes another profile's settings. Store the label as plain text, not as a secret: the build reads it to name the app before anything is uploaded, and a secret cannot be read then.

Before publishing an update or starting a build, check that they belong together. The check asks the office site which database it connects to and which kind of environment it is. It refuses if the database is not the one the app would use, if a build for a dev environment lacks that environment's label, or if a production build has a label. Its last line names the app the settings build:

```bash
npx eas-cli env:exec production "node scripts/check-release-env.cjs"
npx eas-cli env:exec preview "node scripts/check-release-env.cjs"
```

Nothing runs this check automatically yet, so run it by hand for the profile you are about to build or publish.

### The dev app

The label makes a dev build a different app from the production one (`app.config.js`, `scripts/environment-identity.cjs`):

| | Production build | Build labeled `Dev` |
| --- | --- | --- |
| Name on the phone | Invenio Field | Invenio Field Dev |
| App ID (iPhone and Android) | `com.qrassetscanner.app` | `com.qrassetscanner.app.dev` |
| Link scheme | `qrassetscanner` | `qrassetscanner-dev` |
| On screen | Nothing extra | A "Dev" tag on the sign-in, access-pending and Sync & recovery screens, and a "Dev" bar above every signed-in tab |

So both can be installed on one phone, and neither is mistaken for the other. Same project, version and update channels otherwise.

- **Accounts.** A dev environment has its own users. Invite testers from that environment's office site; production sign-ins do not work in the dev app.
- **Two ways to reach testers.** The dev app is a separate app in the stores' eyes, so it has its own of each:

  | | Installed directly (`preview`) | Through the store's test channel (`dev-store`) |
  | --- | --- | --- |
  | Command | `eas build --profile preview --platform ios` | `eas build --profile dev-store --platform ios --auto-submit` |
  | Who can install | iPhones registered as test devices before the build is made | Anyone invited to the dev app's testers, by their store account |
  | Adding a person later | Register the phone, then build again | Invite them; no new build |
  | Ready | When the build finishes | After the store has processed the build; testers outside the developer team also wait for the first build's review |

  Both are the same app: the same name, app ID, settings (`preview`) and update channel, so a published `preview` update reaches both.
- **First build.** The dev app ID is new to the app stores' developer accounts. The first build of either kind asks to sign in and register it, and to create its signing profile. The first `dev-store` build also creates the dev app's record in the store ("Invenio Field Dev"), which is separate from the production app's: testers of one are not testers of the other, so invite them to the new app. The store may first ask the account holder to accept an updated agreement, on the developer site or under Business on the store's site; the build tool prints which. Once the record exists, its ID can be added to `submit.dev-store` in `eas.json` as `ascAppId`, as the production profile has, so later builds are sent without looking the record up.
- **Sending a finished build.** If the build finished but the hand-off to the store failed, do not build again: send the same build with `eas submit --profile dev-store --platform ios --id <build ID>`. A send run by itself is not given the build service's settings, so from `app.json` alone it would work out the production app's ID. `submit.dev-store` therefore states the dev app's ID (`bundleIdentifier`), and the build tool uses that first. If the label is ever renamed, change it there too.
- **Build numbers.** The store accepts a build only with a higher build number than the last one it has for that app and version. Raise `ios.buildNumber` in `app.json` before a build that goes to the test channel. Both apps read it from there, and skipped numbers do no harm.
- **Phones that already have a `preview` or `development` build** have it under the production app ID. A published update never changes an app's name or ID, so those phones need the new build installed; the old one can then be removed.
- **Updates.** Always publish with `--environment`, and the same one as the channel: `eas update --channel preview --environment preview`. Then the label and the database address come from the same place. Without `--environment`, an update is made from the local `.env` file instead of the build service's settings. The label an update carries is what the screen shows.

What the label does not guarantee. The name and app ID are fixed when an app is built. The label on screen and the database address come with each bundle, so a published update brings its own. An update published to a channel with another environment's settings (`--channel production --environment preview`, or the reverse) would therefore run in the wrong app: the production app would connect to dev and show the Dev label, or the dev app would connect to a production and show none. Nothing stops that today. The check above cannot, because it is not told which channel the update is for.

The label must also be one the app stores accept as the end of an app ID: one short word of letters and digits, starting with a letter, and not a reserved word such as `class` or `new`. A build with any other label stops before it starts.

A build with no office site set still runs: password reset tells the person to ask their administrator, and the administrator link is left out.
