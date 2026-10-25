# ⏱️ Time Tracker — Chrome Extension

A lightweight Chrome extension to track what you work on, see where your day goes, and export your time logs to **Excel** or **email** a summary. Everything is stored locally in your browser. No account, no server, no tracking.

![Time Tracker preview](screenshots/preview.png)

---

## Table of contents

1. [Features](#features)
2. [Installation](#installation)
3. [How to use](#how-to-use)
4. [Exported file format](#exported-file-format)
5. [Project structure](#project-structure)
6. [How it is built](#how-it-is-built)
7. [Data & privacy](#data--privacy)
8. [Troubleshooting](#troubleshooting)
9. [Roadmap](#roadmap)
10. [Contributing](#contributing)
11. [License](#license)

---

## Features

- **Start / pause / resume / stop** a task timer. Paused time is never counted.
- **Task details:** title, category (Work, Study, Development, Meeting, Break, Lunch, Personal, Other), status (In Progress, Not Started, Completed, On Hold) and optional notes.
- **Today's summary:** total tracked time, session count, and a colour bar showing time split by status.
- **Today's time logs:** one card per session. The card's colour comes from its status.
  - Blue = In Progress
  - Green = Completed
  - Amber = On Hold
  - Slate = Not Started
- **Change a log's status** with one click, or **delete** it.
- **Custom confirmation dialog** for destructive actions (no browser `alert` / `confirm`).
- **Toast notifications** for feedback, always visible and auto-dismissing.
- **Export to Excel (.xlsx)** with auto-fitted columns, a styled header, a frozen header row and filters.
- **Email your report:** opens a draft in Gmail or your default mail app with today's summary in the body. Optionally downloads the Excel file at the same time so you can attach it. Your recipient address is remembered.
- **Toolbar badge:** a green dot while tracking, an amber `II` when paused.
- **Survives popup close:** the timer keeps running in the background because it is based on timestamps, not on the popup being open.
- **100% local:** data is kept in `chrome.storage.local`.

---

## Installation

### Option A: Load unpacked (development / personal use)

1. Download or clone this repository.
   ```bash
   git clone https://github.com/<your-username>/time-tracker-extension.git
   ```
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the project folder (the one that contains `manifest.json`).
5. Pin the extension: click the puzzle icon in the toolbar, then the pin next to **Time Tracker**.

It also works in other Chromium browsers (Edge, Brave, Opera) using the same steps on their extensions page.

### Updating after you change the code

Go to `chrome://extensions` and click the reload icon on the Time Tracker card, then reopen the popup.

---

## How to use

1. **Start a task:** type a title, pick a category and status, add optional notes, and press **▶ Start tracking**.
2. **Pause / Resume:** use the **Pause** button in *Current session*. The header badge changes to *Paused*.
3. **Stop:** press **Stop session**. The session is saved to *Today's time logs*.
4. **Manage logs:**
   - **Change status** cycles Not Started → In Progress → Completed → On Hold.
   - **Delete** asks for confirmation, then removes that log.
5. **Export:** press **↓ Excel** in *Today's time logs* to download the report. A running session is included and marked *Running* or *Paused*.
6. **Email:** press **✉ Email**, enter a recipient (optional), and choose **Open in Gmail** or **Mail app**. Keep *Also download the Excel file* ticked, then attach the downloaded file in the draft.
7. **Clear the day:** press **Clear today's logs** at the bottom. You must stop any running session first.

> Only one task can run at a time. Stop the current session before starting another.

---

## Exported file format

The Excel export contains one row per session for today, oldest first.

| Column | Example |
|---|---|
| Task Title | Build my portfolio |
| Category | Development |
| Date | 2026-10-25 |
| Start Time | 10:45:12 AM |
| End Time | 11:30:40 AM |
| Duration (HH:MM:SS) | 00:45:28 |
| Duration (Minutes) | 45.47 |
| Task Status | Completed |
| Session State | Stopped / Running / Paused |
| Notes | Landing page |

**Column widths:** the `.xlsx` export sets proper widths for every column, so dates and times never show as `#####`.

**About email:** browser extensions cannot attach files to an email, and neither Gmail nor a mail app accepts attachments from a link. The email draft therefore contains a plain-text summary of today's sessions (long lists are trimmed to fit link limits), and the Excel file is downloaded separately for you to attach.

Text fields starting with `=`, `+`, `-` or `@` are prefixed with `'` to prevent spreadsheet formula injection.

---

## Project structure

```
time-tracker-extension/
├── manifest.json      # Extension config (Manifest V3), permissions, icons
├── background.js      # Service worker: toolbar badge (running / paused)
├── popup.html         # Popup markup
├── popup.css          # Styling / design system
├── popup.js           # App logic: timer, storage, rendering, export
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   ├── icon128.png
│   └── icon.svg       # Vector version of the logo
├── screenshots/
│   └── preview.png
├── README.md
├── CHANGELOG.md
├── LICENSE
└── .gitignore
```

---

## How it is built

**Stack:** plain HTML, CSS and JavaScript (no frameworks, no build step, no dependencies). **Manifest V3.**

### Architecture

- **`popup.js`** holds all the logic and keeps one state object:
  ```js
  data = { logs: [ ...finishedSessions ], active: currentSession | null }
  ```
- **Timer accuracy:** the active session stores `startAt`, `resumedAt` and `accumulatedMs`. Elapsed time is `accumulatedMs + (now - resumedAt)` while running. This means the time is correct even if the popup is closed and reopened.
- **Persistence:** state is saved to `chrome.storage.local` under the key `timeTrackerData` after every change. A `chrome.storage.onChanged` listener keeps the UI in sync.
- **Rendering:** the popup re-renders every second for the live timer. The logs list is only rebuilt when its data changes, so hover effects and clicks are not interrupted.
- **`background.js`** (service worker) listens to storage changes and sets the toolbar badge.

### Notable implementation details

- **Custom confirm dialog:** a Promise-based `confirmDialog()` replaces `window.confirm`, with Escape and click-outside to cancel.
- **Toast messages:** a single `showMessage(text, isError)` function drives one fixed-position toast, so feedback is visible from any section.
- **Email report:** builds a `mailto:` link or a Gmail compose URL (`mail.google.com/mail/?view=cm`) from today's logs, trimming the body to stay within URL length limits. The last recipient is stored under a separate key, `timeTrackerSettings`.
- **Dependency-free Excel export:** `.xlsx` files are ZIP archives of XML. The extension builds the XML by hand and packs it with a small ZIP writer (stored, no compression) that includes a CRC-32 implementation. This avoids shipping a large library.
- **Status-driven colours:** CSS custom properties (`--s`, `--s-bg`) are set from a `data-status` attribute, so the log card stripe, duration pill and status chip always match.
- **Logo and icons:** the stopwatch logo was drawn programmatically (Python + Pillow) and exported at 16, 32, 48 and 128 px, with an SVG version in `icons/icon.svg`.

### Permissions

| Permission | Why |
|---|---|
| `storage` | Save your logs and active session locally |

No host permissions, no network access, no remote code.

---

## Data & privacy

- All data stays in your browser's local extension storage.
- Nothing is sent to any server. The extension makes no network requests.
- Removing the extension deletes its stored data. Export to Excel first if you want to keep it.
- `chrome.storage.local` is not synced across devices.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Changes don't appear | Reload the extension at `chrome://extensions` and reopen the popup |
| "Load unpacked" fails | Select the folder that directly contains `manifest.json` |
| Email draft has no attachment | Expected: tick *Also download the Excel file*, then attach the downloaded file manually |
| Gmail doesn't open | Use **Mail app**, or check that new tabs aren't blocked |
| Can't start a new task | A session is already running; stop it first |
| Can't clear today's logs | Stop the active session first |
| Badge not showing | Reload the extension; the badge appears only while a session exists |

---

## Roadmap

Ideas for future versions:

- View and export previous days or a date range
- Edit a saved log (title, times, notes)
- Weekly / monthly reports and charts
- Idle detection and reminders
- Dark mode
- Import from a spreadsheet file
- Publish to the Chrome Web Store

---

## Contributing

1. Fork the repository
2. Create a branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

Please keep the project dependency-free and test in Chrome before submitting.

---

## License

Released under the [MIT License](LICENSE).
