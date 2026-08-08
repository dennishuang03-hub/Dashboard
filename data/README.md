# `data/` — the workbook lives here

Put the daily report (`.xlsx`) in this folder. `/api/report` picks the **newest**
spreadsheet it finds, so publishing a new day is: drop the file in, commit, push.

## Why not `src/Data/` any more

Anything under `src/` is compiled by Vite. When the workbook lived there it was
turned into a static asset with a public URL, which meant the whole regional
report could be downloaded by anyone who opened the site and looked at the
Network tab — no login involved, because there was nothing for a login to stand
in front of.

This folder is outside both `src/` and `public/`, so Vite never sees it and it is
never copied into `dist/`. It reaches the server through `includeFiles` in
`vercel.json`, and the only route that reads it checks the session cookie first.

## Two things this does not protect against

1. **A public GitHub repo.** The file is committed, so if the repository is
   public the workbook is public — from GitHub, not from the dashboard. Check
   that `github.com/<you>/Dashboard` is set to **Private**.
2. **Anyone who can sign in.** The login is one shared team account for now.
   Everyone who has it sees everything.

Excel lock files (`~$something.xlsx`, created while the workbook is open) are
ignored by `.gitignore` and skipped by the server.
