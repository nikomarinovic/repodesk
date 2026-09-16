# RepoDesk — changes in this pass

## Icons
- GitHub icon replaced with an accurate octocat glyph (was a rough approximation)
- Apple icon replaced with a proper apple-with-leaf-and-bite silhouette

## Projects
- Live search bar in the Projects list pane (filters by name/description, with a clear button)
- "Edited X ago" shown on every project card and every project row

## Settings → GitHub
- Full profile stats via the GitHub GraphQL API: followers, following, public repos,
  stars earned (summed across your owned repos), forks, pull requests, issues,
  discussions, starred repos, and repos contributed to
- Followers / Following are clickable stat tiles that open a scrollable list of
  avatars + usernames, linking out to each profile on GitHub
- "Import from GitHub" — a modal listing every repo on your account with checkboxes,
  a search/filter box, select-all/none, and a clear "already added" state for repos
  you've already imported as projects

## Home
- New "Project health" list: every GitHub-linked project with its health dot,
  name, and "Updated X ago" — at a glance across your whole portfolio
- Per-project health card rebuilt as a clean label/value table: Last commit,
  Open issues, Open PRs, Unresolved tasks (local), Last release, Stars
- GitHub issue → task sync: new open issues on your repos surface as a card
  ("New GitHub issue detected" → project → issue → **Add task** / **Ignore**).
  Handled issues (accepted or ignored) are remembered so they don't reappear.

## News
- Redesigned as clickable cards that open the real GitHub page for each event
- Color-coded icon badges per activity type (star / fork / PR / follow)
- Unread indicated with a small dot instead of a background tint
- Filter tabs: All / Stars / Forks / Pull requests / Followers, each with a live count

## Legal
- Reworked from a flat wall of text into numbered section cards with a
  "last updated" pill and clearer visual hierarchy

## Layout & responsiveness
- New breakpoints at 1440px and 1800px so the app uses the extra space on large
  desktop monitors instead of staying narrow and centered
- Projects list pane, stat grid, and health grid all widen sensibly at those sizes

## Animation
- Staggered reveal on project cards/rows, news items, health rows, and
  "needs attention" items
- Subtle press feedback on buttons
- Respects `prefers-reduced-motion`

## Reliability fix (found via testing, not requested — but important)
- Any background GitHub fetch (project health, profile stats) that fails (bad
  token, rate limit, offline) now backs off for 5 minutes instead of retrying on
  every single re-render. Before this fix, a single failed request could turn
  into a tight retry loop that hammered the GitHub API and could freeze the tab.

## Testing
This pass was verified with a headless (jsdom) smoke test that boots the real
app.js against seeded data and a mocked GitHub API, then drives it through real
DOM clicks — not just a syntax check. Confirmed working:
- All four tabs (Home, Projects, News, Settings) render without errors
- GitHub Settings page loads profile stats and doesn't loop on failure
- The GitHub issue → task suggestion card renders, "Add task" creates the task
  and dismisses the card, "already imported" detection works correctly
- The import modal opens, lists repos, and marks already-added ones

Not yet covered by this pass: real-browser/visual QA (the smoke test checks
DOM structure and app logic, not actual pixel rendering), and the "automatic
sync" polling frequency/UX beyond what already existed (5-minute News poll).
