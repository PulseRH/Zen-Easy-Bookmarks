# Zen Easy Bookmarks

A [Sine](https://github.com/CosmoCreeper/Sine) mod for [Zen Browser](https://zen-browser.app/)
that replaces the per-space pinned tab area with a **launcher rail backed by
real bookmarks**.

Pinned tabs are live tabs — they hold a session and cost memory while parked.
This rail holds **bookmarks**: saved URLs that cost nothing until you open them.

## Behavior

- **Click an item → opens a fresh tab, always** (in the space's container).
  It never switches to an existing tab.
- **Items are unloaded by nature** — just URLs, zero memory until clicked.
- **No × button.** Removing an item is right-click → Delete Bookmark, which
  deletes the real bookmark.
- **Drag a tab onto the rail** → bookmarks it and **closes the tab** (files
  the page away, frees its memory).
- **Folders**: drag items into folders, reorder by drag, create via
  right-click → New Folder.
- **Per-space**: each Zen space has its own rail, stored at
  `Bookmarks Toolbar/Easy Bookmarks/<Space Name>`. Edits in the native
  Library appear in the rail live. Essentials are untouched.

## Installation

Install via Sine: add this repo in Sine's mod search / install-from-repo.

## Notes & caveats

- **Existing pinned tabs are hidden, not migrated.** The mod hides the native
  per-space pinned area; pins still exist underneath. Unpin them first (or
  disable the mod) if you need them back.
- **Zen updates can break this.** The mod reads Zen's internal workspace API
  (`gZenWorkspaces`), which is undocumented and changes between versions. All
  Zen-specific code is isolated in the `ZenSpaces` module of
  `easy-bookmarks.uc.js` — that's the place to fix after an update.
- Deleting a space keeps its bookmark folder (your bookmarks are never
  destroyed by space changes).

## Debugging

Runtime logs appear in the Browser Console (`Ctrl+Shift+J`), prefixed
`[EasyBookmarks]`. You should see `[EasyBookmarks] initialized` after startup.
