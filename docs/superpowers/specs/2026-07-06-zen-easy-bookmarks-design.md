# Zen Easy Bookmarks — Design

**Date:** 2026-07-06
**Type:** Sine mod for Zen Browser
**Status:** Approved design

## Concept

Replace Zen's **per-space pinned-tab area** in the sidebar with a **launcher rail
backed by real bookmarks**. Each Zen space renders its own bookmark folder as a
navigable tree in the sidebar. Items are unloaded URLs that **launch fresh tabs**
on click — they are not live parked tabs.

**Essentials are left untouched.** They remain Zen's native cross-space row; this
mod replaces only the per-space pinned section (consistent with scoping out a
global rail).

The whole point is the distinction between a **pinned tab** (a live tab + session
held in memory) and a **bookmark** (a saved URL that costs nothing until opened).
This mod makes the sidebar's top area behave like bookmarks, not pinned tabs.

## The Three Rules

1. **Click = fresh tab, always.** Clicking a launcher item opens its URL in a
   **new** tab (like right-click → Duplicate Tab), tagged with the space's
   container. Even if the URL is already open elsewhere, a new tab opens. The item
   itself never changes state (no "active"/"switch-to" behavior).
2. **Unloaded by nature.** Every rail item is just a URL — it consumes no memory
   until clicked. There is no bulk "open all" action; folders simply live in the
   rail and their items sit unloaded until individually launched.
3. **No accidental removal.** Items have **no `×` close button**. Removal is
   **right-click → Delete Bookmark**, which deletes the real bookmark from Places.

## Architecture

Packaged as a **Sine mod** (loaded via Sine, Zen's mod manager) — ships with
Sine's config/JS-injection structure, not a raw userChrome drop-in.

Components:

- **Rail renderer (JS + CSS):** draws the rail in the sidebar where Zen's
  pinned/essentials UI lives; hides/replaces the native pinned area. Renders the
  active space's bookmark folder as a tree (folders + launcher items).
- **Bookmark store binding:** uses Zen's Places bookmarks API as the source of
  truth. Each space maps to an ordinary bookmark subfolder one level under an
  `Easy Bookmarks` parent, e.g. `Bookmarks Toolbar/Easy Bookmarks/<SpaceName>`.
  Folders are **matched by the space's stable id, titled by the space name** — so
  renaming a space in Zen never orphans its rail; on space rename, the folder
  title is updated to match. The `spaceId → folder GUID` mapping is stored as a
  JSON pref in the profile. The folder is auto-created on first use. A Places
  observer keeps the rail live when bookmarks change (including edits made in the
  native Library).
- **Space watcher:** listens for space switches and re-renders the rail from that
  space's folder. Per-space scope mirrors Zen's existing per-space pinned tabs.
- **Launch handler:** click → open URL in a new tab in the space's assigned
  **container** (contextual identity), so cookie jars / profiles stay correct.

## Scope Model

- **Per-space folders.** Space "Work" → its folder, space "Personal" → its own.
  Switching spaces swaps the rail to that space's folder. (Chosen over a global
  rail or a two-tier global+per-space model.) Folders are keyed to the **space**,
  not the container — a container may be shared by several spaces, but each space
  gets its own rail. The container matters only at launch time.
- **Container-aware launch.** A bookmark is just a URL, so each launch is tagged
  with the current space's container id. Space with no container → default context.

## Drag Behavior (the pin replacement)

Dragging follows **native Zen / Places semantics**. The rail is custom UI, so the
mod implements its own drop targets — but it uses the standard drag data formats
(tab/URL flavors) and the native Places move/reorder backend, so behavior stays
consistent with the rest of the browser rather than inventing a new model:

- **Drag a tab up onto the rail** → creates a bookmark (title + URL + favicon) in
  the current space's folder, **then closes the original tab**. This is the
  redirected "drag to pin" gesture: filing the page away frees its memory, which
  is the point of the mod.
- **Drag an item into a folder** → files it there.
- **Drag to reorder** → reorders the underlying bookmarks in the folder.
- **Drag out** → moves it out.

## Migration & Compatibility

- **Existing pinned tabs on first run:** no migration. The mod hides the native
  pinned area; existing pins stay alive but hidden. Users who want them can
  disable the mod or unpin via native UI first. Documented in the README.
- **Zen internals risk:** space integration relies on Zen's internal APIs
  (`gZenWorkspaces` etc.), which are not stable across Zen updates. Treat each
  Zen major update as a potential breakage point; keep the integration surface
  small and isolated in one module.

## Edge Cases

- **Space with no container** → launch in default context.
- **Renaming a space** → handled: folders are matched by space id, and the folder
  title is updated to the new name.
- **Deleting a space** → the folder is kept (orphaned) rather than destroyed, to
  avoid losing bookmarks. Revisit later if it becomes a problem.
- **Bookmark edited externally** (native Library) → rail reflects it live via the
  Places observer.
- **Duplicate URL dragged in** → allowed. It's a launcher; dupes are fine and
  consistent with rule #1.

## Out of Scope (YAGNI)

- Global / shared rail across spaces.
- Sync.
- Custom icons beyond favicons.
- Bulk "open all (unloaded)" action — obsolete once folders live in the rail.
