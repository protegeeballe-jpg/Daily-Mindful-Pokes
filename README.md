# Faith & Focus: Daily Armor

Faith & Focus is a personal daily companion that brings faith-centered reflection, wellness routines, and a little garden into one workspace.

## What’s included

- Daily Health Checklist with progress and reflections
- Personal Diary
- Voice Notes and date-based location check-ins
- Little Garden with a visual record of ongoing progress
- A local-first experience with offline support where the browser allows

## Getting started

Open the application through the project’s published page or a local development server. Use the account screens to create an account or sign in.

Keep your sign-in details private. For the best privacy, use a device and browser profile that only you can access.

## Privacy

The app uses browser storage and may use configured cloud services for backup or synchronization. It also applies a Content Security Policy to restrict browser-loaded resources.

Some Checklist checkboxes and progress information are stored in the browser and are not encrypted at rest by the app. Encrypted vault data protects supported backup and sync copies, but this does not mean every item stored by the browser is encrypted. Use a private device and browser profile, and avoid shared or public computers.

Please review the [Privacy Policy](./privacy.html) and [Terms of Service](./terms.html) before using the app.

## Encrypted JSON export and import

Settings provides an optional encrypted JSON export and import for supported daily data. Keep exported files private, and import a backup only into the account it belongs to.

## Development

The project uses standard browser technologies. To run the automated tests:

```sh
node --test tests/*.test.mjs
```

## Project links

- [Open the application](./home.html)
- [Privacy Policy](./privacy.html)
- [Terms of Service](./terms.html)
