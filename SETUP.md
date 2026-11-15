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

- **Field Worker** — Scan, Inventory, Activity tabs
- **Office Staff** — Dashboard, Materials, Exceptions, Locations, QR Codes, Reports tabs

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

Locally they come from `.env`. For builds and published updates they come from the build service's environment variables for the profile in `eas.json` (`development`, `preview`, `production`).

Before publishing an update or starting a build, check that the three belong together. The check asks the office site which database it connects to and refuses if it is not the one the app would use:

```bash
npx eas-cli env:exec production "node scripts/check-release-env.cjs"
```

Nothing runs this check automatically yet, so run it by hand for the profile you are about to build or publish.

A build with no office site set still runs: password reset tells the person to ask their administrator, and the administrator link is left out.
