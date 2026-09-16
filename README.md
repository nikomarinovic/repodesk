# RepoDesk

Your projects, tasks and GitHub activity in one calm workspace.

No build step, no backend, no database. It's plain HTML/CSS/JS that runs
directly in the browser and saves everything to `localStorage`.

## What's new in this version

- **Landing page + local account** — the first time you open RepoDesk you
  create a small on-device profile (name, email, password). After that,
  it opens straight into the app every time. Log out from
  Settings → Profile if you ever want a password screen again.
- **Liquid Glass, Apple-style design** — frosted glass panels, blue accent
  (no purple), spring animations, and a proper **Light / Dark / System**
  theme switch in Settings → Appearance.
- **New app icon** — a simple glass-morphic checkmark mark, not a
  git/branch icon, used consistently everywhere (browser tab, Home Screen,
  in-app sidebar).
- **Full Settings** — Profile, General, GitHub, Appearance, Install App
  (detects if you're already running as an installed app), Data, Data &
  Privacy, and Legal (full Terms of Service, Privacy Policy, Acceptable
  Use Policy and Open-Source Notices).

## Deploy to Netlify

**Option A — drag and drop**
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag the `repodesk` folder onto the page
3. Done — you get a live URL immediately

**Option B — connect a git repo**
1. Push this folder to a GitHub repo
2. In Netlify: *Add new site → Import an existing project*
3. Leave the build command empty and set the publish directory to `.` (the repo root)

## Add it to your Home Screen

Open the deployed URL on your phone, then either follow the on-screen
steps in Settings → Install App, or manually:
- **iOS Safari**: Share → Add to Home Screen
- **Android Chrome**: menu (⋮) → Add to Home screen / Install app
- **Desktop Chrome/Edge**: install icon in the address bar

It opens full-screen, without browser chrome, using the icon in `icons/`.
Settings → Install App automatically shows "Installed as an app on this
device" once it detects you're running the installed copy.

## Connecting GitHub

Settings → GitHub → follow the three steps to generate a personal access
token at `github.com/settings/tokens/new` with the `repo`, `read:user` and
`notifications` scopes, then paste it in. The token is stored only in your
browser's `localStorage` — it's never sent anywhere except directly to
`api.github.com`.

The News tab only ever shows things *other people* do on your repos: stars,
forks, opened pull requests, and new followers. Your own commits and pushes
never show up there — that's what the Home tab and each project's health
card are for.

## File structure

```
repodesk/
  index.html      the app shell — auth screens, sidebar, bottom nav, view containers
  styles.css      the entire Liquid Glass theme (light + dark), all in CSS variables at the top
  app.js          all logic: auth, theme, storage, GitHub API calls, render functions, settings
  manifest.json   PWA manifest used for "add to home screen"
  icons/          app icon (icon.svg is the source, PNGs are generated from it)
```

Everything is plain JavaScript — no framework, no bundler. To change a
color, edit the variables at the top of `styles.css` (`--c1` … `--c5` and
`--accent`). `app.js` is organized top to bottom as: storage → auth → theme
→ helpers → icons → GitHub API calls → render functions per view →
settings pages → handlers → boot.

## Data

Everything lives in your browser's `localStorage`, under these keys:
`repodesk.account`, `repodesk.session`, `repodesk.theme`, `repodesk.prefs`,
`repodesk.projects`, `repodesk.settings`, `repodesk.news`,
`repodesk.newsMeta`. Use Settings → Data → Export data to back up your
projects as a JSON file, or Import to restore them. Settings → Data &
Privacy → Delete account removes everything, including your local profile.
