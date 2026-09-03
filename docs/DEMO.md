# Tideline — demo walkthrough

A guided tour of a Tideline instance loaded with the demo data set
(`SEED_DEMO=1`, see the deploy guides). Replace the URL below with the address
of your own instance.

## Access

- **URL:** https://tideline.example.com
- **Login:** the value of `ADMIN_EMAIL` from your environment
- **Password:** the value of `ADMIN_PASSWORD`
- **Role:** owner — everything is available.

Demo team member accounts: `…@demo.local` / `demo-password-123` (viewer role —
handy for showing what read-only access looks like).

## What to look at

- **Timeline** — the "people × days" grid: enter load from the keyboard, add
  absences, watch the overload health colours; weekends are hidden, weeks are
  separated by a gap with the dashed teal tideline marker. Try drag-fill via
  the handle, rectangular selection, undo/redo and **Enough people?** for a
  capacity check.
- **Projects** — cards with health (green / amber / red) and weekly updates:
  only the goal, tasks, links and updates (details live in your wiki).
- **Accuracy** — plan vs. actual for closed weeks.
- **Team** — team members and participants with roles (owner/editor/viewer),
  invite links for colleagues, and a read-only share link to show the timeline
  without logging in.

## What the demo data contains

- 7 team members, 8 projects (6 active + 2 finished);
- load for the past 6 weeks and 2 weeks ahead;
- vacations and other absences;
- closed weeks with plan/actual snapshots;
- one overloaded team member and one "sole expert" on a project.
