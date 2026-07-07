# Zen Easy Bookmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Sine mod for Zen Browser that replaces the per-space pinned-tab area with a launcher rail backed by real Places bookmarks (click = fresh tab in the space's container, unloaded by nature, right-click to delete, drag tab up to bookmark-and-close).

**Architecture:** One userChrome script (`easy-bookmarks.uc.js`) injected into `browser.xhtml` chrome context via Sine's `scripts` mechanism, plus `style.css` applied via Sine's `style.chrome`. Internally namespaced modules: `ZenSpaces` (ONLY module touching Zen internals), `SpaceFolders` (Places folder mapping keyed by space id), `Rail` (renderer), `Launcher`, `ContextMenu`, `DragDrop`, `LiveUpdate` (Places observer). Source of truth is the Places bookmark store under `Bookmarks Toolbar/Easy Bookmarks/<SpaceName>`.

**Tech Stack:** Firefox chrome JS (`PlacesUtils`, `Services`, `gBrowser`), XUL menupopup, HTML DOM in the sidebar, Sine mod packaging (`theme.json`), PowerShell dev-install script.

**Testing reality:** userChrome scripts run inside browser chrome — there is no automated unit-test harness. TDD's red/green loop is replaced by **manual verification with exact Browser Console commands and expected output** at the end of every task. Open the Browser Console with `Ctrl+Shift+J`. After editing files, re-run `dev-install.ps1` and restart Zen to reload.

**Spec:** `docs/superpowers/specs/2026-07-06-zen-easy-bookmarks-design.md`

---

## Reference: verified external facts

- **Sine mod format** (verified against a published mod): repo root has `theme.json` with `id`, `name`, `description`, `style: {"chrome": "style.css"}`, `scripts: {"<file>.uc.js": {"include": ["chrome://browser/content/browser.xhtml"]}}`, `author`, `version`, `tags`, `fork: ["zen"]`.
- **Dev loop without Sine:** fx-autoconfig (which Sine installs) loads `.uc.js` files from `<profile>/chrome/JS/`. Find the profile dir via `about:profiles` → "Root Directory" of the profile in use.
- **Zen internals are NOT stable.** `gZenWorkspaces` is undocumented; property names below (`activeWorkspace`, `getActiveWorkspaceFromCache()`, `.uuid`, `.name`, `.containerTabId`) must be verified at runtime in Task 2 and adjusted if Zen has renamed them. The active-workspace pref `zen.workspaces.active` is the fallback change signal.
- **Places APIs used:** `PlacesUtils.bookmarks.insert/fetch/update/remove`, `PlacesUtils.promiseBookmarksTree(guid)` (folder nodes have `type === "text/x-moz-place-container"`), `PlacesUtils.observers.addListener([...events], handler)`.

## File Structure

```
Zen Easy Bookmarks/
├── theme.json              # Sine mod metadata (JS + CSS entry points)
├── style.css               # hides native pinned area; styles the rail
├── easy-bookmarks.uc.js    # the whole mod (namespaced internal modules)
├── dev-install.ps1         # copies files into <profile>/chrome/JS for dev
├── README.md               # usage, migration note, compatibility risk
└── docs/superpowers/...    # spec + this plan
```

Single JS file is deliberate: Sine injects each script independently with no shared module system, and the mod is ~500 lines. Internal boundaries are enforced by the namespace objects instead of files.

---

### Task 1: Scaffold repo, Sine metadata, dev-install loop

**Files:**
- Create: `theme.json`
- Create: `style.css`
- Create: `easy-bookmarks.uc.js`
- Create: `dev-install.ps1`
- Create: `.gitignore`

- [ ] **Step 1: Initialize git**

```bash
cd "C:/Code Projects/Zen mods/Zen Easy Bookmarks"
git init
git add docs/
git commit -m "docs: add design spec"
```

- [ ] **Step 2: Create `theme.json`**

```json
{
  "id": "zen-easy-bookmarks",
  "name": "Zen Easy Bookmarks",
  "description": "Replaces the per-space pinned tab area with a launcher rail backed by real bookmarks. Click opens a fresh tab in the space's container; items are unloaded URLs with no close button.",
  "homepage": "https://github.com/CHANGEME/Zen-Easy-Bookmarks",
  "style": {
    "chrome": "style.css"
  },
  "scripts": {
    "easy-bookmarks.uc.js": {
      "include": ["chrome://browser/content/browser.xhtml"]
    }
  },
  "author": "Loz",
  "version": "0.1.0",
  "tags": ["bookmarks", "pinned tabs", "sidebar", "workspaces", "zen browser"],
  "fork": ["zen"]
}
```

(`homepage` stays CHANGEME until the repo is published — Task 10 flags it.)

- [ ] **Step 3: Create placeholder `style.css`**

```css
/* Zen Easy Bookmarks — styles land in Task 4 */
```

- [ ] **Step 4: Create `easy-bookmarks.uc.js` skeleton**

```js
// ==UserScript==
// @name           Zen Easy Bookmarks
// @description    Bookmark launcher rail replacing per-space pinned tabs
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

(function () {
  "use strict";
  if (location.href !== "chrome://browser/content/browser.xhtml") return;

  const { PlacesUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PlacesUtils.sys.mjs"
  );

  const PREF_MAPPING = "extensions.easy-bookmarks.space-folders";
  const PARENT_TITLE = "Easy Bookmarks";
  const log = (...args) => console.log("[EasyBookmarks]", ...args);

  // Dev-mode styles: when installed via dev-install.ps1 the CSS sits next to
  // the script in <profile>/chrome/JS. Under Sine, Sine applies style.css
  // itself and this is a harmless no-op.
  function loadDevStyles() {
    try {
      const cssFile = Services.dirsvc.get("UChrm", Ci.nsIFile); // <profile>/chrome
      cssFile.append("JS");
      cssFile.append("easy-bookmarks.css");
      if (!cssFile.exists()) return;
      const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(
        Ci.nsIStyleSheetService
      );
      const uri = Services.io.newFileURI(cssFile);
      if (!sss.sheetRegistered(uri, sss.USER_SHEET)) {
        sss.loadAndRegisterSheet(uri, sss.USER_SHEET);
      }
    } catch (e) {
      log("dev styles failed", e);
    }
  }

  function init() {
    loadDevStyles();
    log("initialized");
  }

  if (window.gBrowserInit?.delayedStartupFinished) {
    init();
  } else {
    const obs = (subject) => {
      if (subject === window) {
        Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
        init();
      }
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  }

  // Expose for Browser Console verification during development.
  window.EasyBookmarks = { log };
})();
```

- [ ] **Step 5: Create `dev-install.ps1`**

```powershell
# Copies the mod into a Zen profile for development (fx-autoconfig loads
# .uc.js from <profile>/chrome/JS). Find the profile dir via about:profiles.
param([Parameter(Mandatory = $true)][string]$ProfileDir)

$dest = Join-Path $ProfileDir "chrome\JS"
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $PSScriptRoot "easy-bookmarks.uc.js") $dest -Force
Copy-Item (Join-Path $PSScriptRoot "style.css") (Join-Path $dest "easy-bookmarks.css") -Force
Write-Host "Installed to $dest. Restart Zen to reload."
```

- [ ] **Step 6: Create `.gitignore`**

```
*.log
```

- [ ] **Step 7: Verify the dev loop works**

1. In Zen, open `about:profiles`, copy the in-use profile's Root Directory.
2. Run: `powershell -File dev-install.ps1 -ProfileDir "<that path>"`
3. Restart Zen. Open Browser Console (`Ctrl+Shift+J`).
4. Expected: a `[EasyBookmarks] initialized` line. If missing, confirm fx-autoconfig is installed (it is if Sine is installed) and that the file landed in `<profile>/chrome/JS/`.

- [ ] **Step 8: Commit**

```bash
git add theme.json style.css easy-bookmarks.uc.js dev-install.ps1 .gitignore
git commit -m "feat: scaffold Sine mod with dev-install loop"
```

---

### Task 2: ZenSpaces wrapper — the only module touching Zen internals

**Files:**
- Modify: `easy-bookmarks.uc.js` (insert after the `log` const)

- [ ] **Step 1: Discover the real API surface at runtime**

In the Browser Console of a running Zen with 2+ spaces, run each line and note output:

```js
gZenWorkspaces
gZenWorkspaces.activeWorkspace                      // expect: a uuid string
gZenWorkspaces.getActiveWorkspaceFromCache?.()      // expect: object with uuid/name/containerTabId
Object.keys(gZenWorkspaces.getActiveWorkspaceFromCache?.() ?? {})
Services.prefs.getStringPref("zen.workspaces.active", "MISSING")
```

If property names differ from the code below, **adapt the code below to the real names** — that is expected, not a deviation. Everything else in the mod only consumes `ZenSpaces`, so changes stay contained here.

- [ ] **Step 2: Add the `ZenSpaces` module**

```js
  // --- Zen integration ------------------------------------------------
  // The ONLY module allowed to touch Zen internals (gZenWorkspaces, zen.*
  // prefs). Zen updates may break these names; fix them here only.
  const ZenSpaces = {
    getActive() {
      const ws = window.gZenWorkspaces;
      if (!ws) return null;
      try {
        const space =
          ws.getActiveWorkspaceFromCache?.() ??
          ws.workspaceCache?.find?.((w) => w.uuid === ws.activeWorkspace);
        if (!space) return null;
        return {
          id: space.uuid,
          name: space.name,
          containerId: space.containerTabId ?? 0,
        };
      } catch (e) {
        log("ZenSpaces.getActive failed", e);
        return null;
      }
    },

    // Fires callback after the active space changes. Uses the
    // zen.workspaces.active pref as the change signal (stable fallback,
    // verified in Task 2 Step 1).
    onChange(callback) {
      const observer = { observe: () => callback() };
      Services.prefs.addObserver("zen.workspaces.active", observer);
      window.addEventListener(
        "unload",
        () => Services.prefs.removeObserver("zen.workspaces.active", observer),
        { once: true }
      );
    },
  };
```

- [ ] **Step 3: Expose it and wire a change log for verification**

Replace the `window.EasyBookmarks = { log };` line with:

```js
  window.EasyBookmarks = { log, ZenSpaces };
```

And inside `init()`, before `log("initialized")`, add:

```js
    ZenSpaces.onChange(() => log("space changed →", ZenSpaces.getActive()));
```

- [ ] **Step 4: Verify**

Re-run `dev-install.ps1`, restart Zen, then in Browser Console:

```js
EasyBookmarks.ZenSpaces.getActive()
```

Expected: `{ id: "<uuid>", name: "<current space name>", containerId: <number> }`.
Switch spaces in the sidebar → expected console line: `[EasyBookmarks] space changed → {…next space…}`.

- [ ] **Step 5: Commit**

```bash
git add easy-bookmarks.uc.js
git commit -m "feat: ZenSpaces wrapper isolating Zen workspace internals"
```

---

### Task 3: SpaceFolders — per-space bookmark folder mapping

**Files:**
- Modify: `easy-bookmarks.uc.js` (insert after `ZenSpaces`)

- [ ] **Step 1: Add the `SpaceFolders` module**

```js
  // --- Places folder mapping -------------------------------------------
  // Each space maps to a real bookmark folder under
  // "Bookmarks Toolbar/Easy Bookmarks/<SpaceName>". Matched by space id
  // (stored in a JSON pref), titled by space name (retitled on rename).
  const SpaceFolders = {
    _readMap() {
      try {
        return JSON.parse(Services.prefs.getStringPref(PREF_MAPPING, "{}"));
      } catch {
        return {};
      }
    },

    _writeMap(map) {
      Services.prefs.setStringPref(PREF_MAPPING, JSON.stringify(map));
    },

    async ensureParent() {
      const map = this._readMap();
      if (map.__parent && (await PlacesUtils.bookmarks.fetch(map.__parent))) {
        return map.__parent;
      }
      const folder = await PlacesUtils.bookmarks.insert({
        parentGuid: PlacesUtils.bookmarks.toolbarGuid,
        type: PlacesUtils.bookmarks.TYPE_FOLDER,
        title: PARENT_TITLE,
      });
      map.__parent = folder.guid;
      this._writeMap(map);
      return folder.guid;
    },

    // Returns the folder guid for a space ({id, name}), creating it on
    // first use and syncing the title if the space was renamed.
    async ensureSpaceFolder(space) {
      const map = this._readMap();
      const guid = map[space.id];
      if (guid) {
        const existing = await PlacesUtils.bookmarks.fetch(guid);
        if (existing) {
          if (existing.title !== space.name) {
            await PlacesUtils.bookmarks.update({ guid, title: space.name });
          }
          return guid;
        }
        // Folder was deleted externally — fall through and recreate.
      }
      const parentGuid = await this.ensureParent();
      const folder = await PlacesUtils.bookmarks.insert({
        parentGuid,
        type: PlacesUtils.bookmarks.TYPE_FOLDER,
        title: space.name,
      });
      map[space.id] = folder.guid;
      this._writeMap(map);
      return folder.guid;
    },
  };
```

- [ ] **Step 2: Expose for verification**

```js
  window.EasyBookmarks = { log, ZenSpaces, SpaceFolders };
```

- [ ] **Step 3: Verify**

Re-install, restart, then in Browser Console:

```js
await EasyBookmarks.SpaceFolders.ensureSpaceFolder(EasyBookmarks.ZenSpaces.getActive())
```

Expected: a 12-char guid string. Open the Library (`Ctrl+Shift+O`) → Bookmarks Toolbar → expected: folder `Easy Bookmarks` containing a folder named after the current space. Run the same command again → expected: **same guid** (no duplicate folder). Check the pref:

```js
Services.prefs.getStringPref("extensions.easy-bookmarks.space-folders")
```

Expected: JSON with `__parent` and one `<space-uuid>: <guid>` entry.

- [ ] **Step 4: Commit**

```bash
git add easy-bookmarks.uc.js
git commit -m "feat: per-space bookmark folder mapping keyed by space id"
```

---

### Task 4: Rail renderer (read-only) + hide native pinned area

**Files:**
- Modify: `easy-bookmarks.uc.js` (insert after `SpaceFolders`)
- Modify: `style.css` (replace placeholder)

- [ ] **Step 1: Confirm the mount point selector**

In the Browser Toolbox (`Ctrl+Alt+Shift+I` — enable via DevTools settings → "Enable browser chrome… debugging" if needed) inspect the sidebar and confirm the per-space pinned tabs container is `#vertical-pinned-tabs-container`. If Zen renamed it, use the real id in both files below.

- [ ] **Step 2: Add the `Rail` module**

```js
  // --- Rail renderer ----------------------------------------------------
  const Rail = {
    root: null,
    folderGuid: null,
    _expanded: new Set(), // guids of folders the user expanded

    mount() {
      const pinned = document.querySelector("#vertical-pinned-tabs-container");
      if (!pinned?.parentNode) {
        log("mount point #vertical-pinned-tabs-container not found");
        return false;
      }
      this.root = document.createElement("div");
      this.root.id = "easy-bookmarks-rail";
      pinned.parentNode.insertBefore(this.root, pinned);
      return true;
    },

    async refresh() {
      if (!this.root) return;
      const space = ZenSpaces.getActive();
      if (!space) return;
      this.folderGuid = await SpaceFolders.ensureSpaceFolder(space);
      const tree = await PlacesUtils.promiseBookmarksTree(this.folderGuid);
      this.root.replaceChildren();
      this._renderChildren(tree.children ?? [], this.root, 0);
    },

    _renderChildren(children, parentEl, depth) {
      for (const node of children) {
        parentEl.appendChild(this._renderNode(node, depth));
      }
    },

    _renderNode(node, depth) {
      const isFolder = node.type === "text/x-moz-place-container";
      const el = document.createElement("div");
      el.className = isFolder ? "eb-folder" : "eb-item";
      el.dataset.guid = node.guid;

      const row = document.createElement("div");
      row.className = "eb-row";
      row.style.setProperty("--eb-depth", depth);

      const icon = document.createElement("img");
      icon.className = "eb-icon";
      icon.src = isFolder
        ? "chrome://global/skin/icons/folder.svg"
        : "page-icon:" + node.uri;

      const label = document.createElement("span");
      label.className = "eb-label";
      label.textContent = node.title || node.uri || "";

      row.append(icon, label);
      el.appendChild(row);

      if (isFolder) {
        const childBox = document.createElement("div");
        childBox.className = "eb-children";
        childBox.hidden = !this._expanded.has(node.guid);
        this._renderChildren(node.children ?? [], childBox, depth + 1);
        el.appendChild(childBox);
        row.addEventListener("click", () => {
          if (this._expanded.has(node.guid)) this._expanded.delete(node.guid);
          else this._expanded.add(node.guid);
          childBox.hidden = !childBox.hidden;
        });
      }
      // NOTE: rule #3 — deliberately NO close/× button on any row.
      return el;
    },
  };
```

- [ ] **Step 3: Wire into `init()` and exports**

Inside `init()`, replace the body with:

```js
    loadDevStyles();
    if (!Rail.mount()) return;
    ZenSpaces.onChange(() => Rail.refresh());
    Rail.refresh();
    log("initialized");
```

Exports:

```js
  window.EasyBookmarks = { log, ZenSpaces, SpaceFolders, Rail };
```

- [ ] **Step 4: Replace `style.css`**

```css
/* Zen Easy Bookmarks
   Replaces the per-space pinned tab area with a bookmark launcher rail.
   Essentials are deliberately untouched. */

/* Hide Zen's native per-space pinned tabs (rule: rail replaces pins).
   Existing pins stay alive but hidden — documented in README. */
#vertical-pinned-tabs-container {
  display: none !important;
}

#easy-bookmarks-rail {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px 6px;
  min-height: 24px;
}

.eb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  padding-inline-start: calc(6px + var(--eb-depth, 0) * 14px);
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
}

.eb-row:hover {
  background: color-mix(in srgb, currentColor 10%, transparent);
}

.eb-icon {
  width: 16px;
  height: 16px;
  flex: none;
  border-radius: 3px;
}

.eb-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.eb-drop-target > .eb-row,
.eb-row.eb-drop-target {
  outline: 1px dashed currentColor;
  outline-offset: -1px;
}
```

- [ ] **Step 5: Verify**

Seed test data in the Browser Console:

```js
const g = EasyBookmarks.Rail.folderGuid ?? await EasyBookmarks.SpaceFolders.ensureSpaceFolder(EasyBookmarks.ZenSpaces.getActive());
await PlacesUtils.bookmarks.insert({ parentGuid: g, title: "Example", url: "https://example.com/" });
const f = await PlacesUtils.bookmarks.insert({ parentGuid: g, type: PlacesUtils.bookmarks.TYPE_FOLDER, title: "Work Tools" });
await PlacesUtils.bookmarks.insert({ parentGuid: f.guid, title: "GitHub", url: "https://github.com/" });
await EasyBookmarks.Rail.refresh();
```

Expected: sidebar shows the rail with "Example" (favicon + label, **no × button**) and folder "Work Tools"; clicking the folder expands/collapses "GitHub" (indented); native pinned tab area is gone. Restart Zen → rail renders on startup by itself.

- [ ] **Step 6: Commit**

```bash
git add easy-bookmarks.uc.js style.css
git commit -m "feat: render bookmark rail replacing native pinned area"
```

---

### Task 5: Launcher — click always opens a fresh container-aware tab

**Files:**
- Modify: `easy-bookmarks.uc.js`

- [ ] **Step 1: Add the `Launcher` module (after `SpaceFolders`)**

```js
  // --- Launcher ----------------------------------------------------------
  // Rule #1: click = fresh tab, ALWAYS. Never switch-to, never reuse.
  const Launcher = {
    open(url, containerId) {
      const tab = gBrowser.addTab(url, {
        userContextId: containerId || 0,
        triggeringPrincipal:
          Services.scriptSecurityManager.getSystemPrincipal(),
      });
      gBrowser.selectedTab = tab;
    },
  };
```

- [ ] **Step 2: Wire clicks in `Rail._renderNode`**

In the non-folder branch (add an `else` after the `if (isFolder) {...}` block):

```js
      } else {
        row.addEventListener("click", (event) => {
          if (event.button !== 0) return;
          const space = ZenSpaces.getActive();
          Launcher.open(node.uri, space?.containerId ?? 0);
        });
      }
```

Add `Launcher` to exports:

```js
  window.EasyBookmarks = { log, ZenSpaces, SpaceFolders, Rail, Launcher };
```

- [ ] **Step 3: Verify**

Re-install, restart. Click "Example" in the rail → expected: a **new focused tab** at example.com. Click it again → expected: a **second** tab (rule #1: no switch-to-existing). In a space that has an assigned container, click an item and confirm the new tab shows that container's name/underline color. In a space with no container → normal tab.

- [ ] **Step 4: Commit**

```bash
git add easy-bookmarks.uc.js
git commit -m "feat: click launches fresh container-aware tab"
```

---

### Task 6: Context menu — Delete Bookmark / Delete Folder / New Folder

**Files:**
- Modify: `easy-bookmarks.uc.js`

- [ ] **Step 1: Add the `ContextMenu` module (after `Launcher`)**

```js
  // --- Context menu -------------------------------------------------------
  // Rule #3: removal only happens here (no × buttons anywhere).
  const ContextMenu = {
    _popup: null,
    _targetGuid: null,

    _ensure() {
      if (this._popup) return this._popup;
      const popup = document.createXULElement("menupopup");
      popup.id = "easy-bookmarks-context";

      const del = document.createXULElement("menuitem");
      del.id = "eb-ctx-delete";
      del.addEventListener("command", async () => {
        // remove() deletes folders recursively — real Places deletion.
        await PlacesUtils.bookmarks.remove(this._targetGuid);
        Rail.refresh();
      });

      const sep = document.createXULElement("menuseparator");

      const newFolder = document.createXULElement("menuitem");
      newFolder.setAttribute("label", "New Folder");
      newFolder.addEventListener("command", async () => {
        await PlacesUtils.bookmarks.insert({
          parentGuid: Rail.folderGuid,
          type: PlacesUtils.bookmarks.TYPE_FOLDER,
          title: "New Folder",
        });
        Rail.refresh();
      });

      popup.append(del, sep, newFolder);
      document.getElementById("mainPopupSet").appendChild(popup);
      this._popup = popup;
      return popup;
    },

    openFor(node, isFolder, event) {
      const popup = this._ensure();
      this._targetGuid = node.guid;
      popup
        .querySelector("#eb-ctx-delete")
        .setAttribute("label", isFolder ? "Delete Folder" : "Delete Bookmark");
      popup.openPopupAtScreen(event.screenX, event.screenY, true);
    },
  };
```

- [ ] **Step 2: Wire into `Rail._renderNode`** (after the folder/item click wiring, before `return el;`):

```js
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        ContextMenu.openFor(node, isFolder, event);
      });
```

- [ ] **Step 3: Verify**

Re-install, restart. Right-click "Example" → menu shows **Delete Bookmark** + **New Folder**. Right-click "Work Tools" → shows **Delete Folder**. Delete "Example" → it vanishes from the rail AND from the Library (`Ctrl+Shift+O`). "New Folder" → a folder appears in rail and Library. Left-click behavior unchanged.

- [ ] **Step 4: Commit**

```bash
git add easy-bookmarks.uc.js
git commit -m "feat: right-click context menu for delete and new folder"
```

---

### Task 7: LiveUpdate — Places observer keeps the rail in sync

**Files:**
- Modify: `easy-bookmarks.uc.js`

- [ ] **Step 1: Add the `LiveUpdate` module (after `ContextMenu`)**

```js
  // --- Live updates --------------------------------------------------------
  // Places is the source of truth; edits made anywhere (native Library,
  // sync, this mod) re-render the rail. Debounced full refresh — the tree
  // is small, correctness beats cleverness.
  const LiveUpdate = {
    _events: [
      "bookmark-added",
      "bookmark-removed",
      "bookmark-moved",
      "bookmark-title-changed",
      "bookmark-url-changed",
    ],
    _timer: null,

    start() {
      this._handler = () => {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => Rail.refresh(), 150);
      };
      PlacesUtils.observers.addListener(this._events, this._handler);
      window.addEventListener(
        "unload",
        () => PlacesUtils.observers.removeListener(this._events, this._handler),
        { once: true }
      );
    },
  };
```

- [ ] **Step 2: Wire into `init()`** (after `Rail.mount()` succeeds):

```js
    LiveUpdate.start();
```

Also remove the now-redundant `Rail.refresh()` calls inside `ContextMenu` (the observer covers them) — delete both `Rail.refresh();` lines added in Task 6.

- [ ] **Step 3: Verify**

Re-install, restart. Open the Library, add a bookmark manually inside `Easy Bookmarks/<current space>` → expected: it appears in the rail within ~1s without any interaction. Rename it in the Library → label updates. Delete it → row disappears. Context-menu delete from Task 6 still works (now via the observer).

- [ ] **Step 4: Commit**

```bash
git add easy-bookmarks.uc.js
git commit -m "feat: live rail updates via Places observer"
```

---

### Task 8: Space switching — rail follows the active space

**Files:**
- Modify: `easy-bookmarks.uc.js` (verification-focused; wiring exists since Task 4)

- [ ] **Step 1: Guard against refresh races**

Space switches and Places events can overlap; make `refresh()` last-write-wins. In `Rail`, replace `refresh()` with:

```js
    _refreshSeq: 0,
    async refresh() {
      if (!this.root) return;
      const space = ZenSpaces.getActive();
      if (!space) return;
      const seq = ++this._refreshSeq;
      const folderGuid = await SpaceFolders.ensureSpaceFolder(space);
      const tree = await PlacesUtils.promiseBookmarksTree(folderGuid);
      if (seq !== this._refreshSeq) return; // superseded by a newer refresh
      this.folderGuid = folderGuid;
      this.root.replaceChildren();
      this._renderChildren(tree.children ?? [], this.root, 0);
    },
```

- [ ] **Step 2: Verify the full space matrix**

1. In space A, add a bookmark to the rail (via Library or Task 4's console snippet).
2. Switch to space B → rail empties (B's folder auto-created, check Library) — A's items gone from view.
3. Add a different bookmark in B, switch back to A → A's items return, B's don't.
4. Rename space B in Zen's UI, switch to B → expected: Library folder title updates to the new name, same folder (bookmarks intact).
5. Delete a space → its folder remains in the Library (orphan-by-design, per spec).

- [ ] **Step 3: Commit**

```bash
git add easy-bookmarks.uc.js
git commit -m "feat: race-safe rail refresh across space switches"
```

---

### Task 9: DragDrop — tab→bookmark(+close), reorder, file into folder

**Files:**
- Modify: `easy-bookmarks.uc.js`

- [ ] **Step 1: Add the `DragDrop` module (after `LiveUpdate`)**

```js
  // --- Drag & drop ----------------------------------------------------------
  // Custom drop targets, native data: consumes the browser's standard drag
  // flavors (tab drags, text/x-moz-url) and writes through the Places
  // backend, so behavior matches the rest of the browser.
  const FLAVOR_ITEM = "application/x-easy-bookmark-guid";

  const DragDrop = {
    attach(el, row, node, isFolder) {
      row.draggable = true;
      row.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData(FLAVOR_ITEM, node.guid);
        event.dataTransfer.effectAllowed = "move";
        event.stopPropagation();
      });

      if (isFolder) {
        // Dropping ONTO a folder row files the payload inside it.
        row.addEventListener("dragover", (event) => {
          event.preventDefault();
          event.stopPropagation();
          row.classList.add("eb-drop-target");
        });
        row.addEventListener("dragleave", () =>
          row.classList.remove("eb-drop-target")
        );
        row.addEventListener("drop", (event) => {
          event.preventDefault();
          event.stopPropagation();
          row.classList.remove("eb-drop-target");
          this.handleDrop(event, node.guid, undefined);
        });
      }
    },

    attachRoot(root) {
      root.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      });
      root.addEventListener("drop", (event) => {
        event.preventDefault();
        this.handleDrop(event, Rail.folderGuid, this._indexFromPoint(event));
      });
    },

    // Insertion index among the rail's top-level nodes, from drop Y.
    _indexFromPoint(event) {
      const rows = [...Rail.root.children];
      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) return i;
      }
      return rows.length;
    },

    async handleDrop(event, parentGuid, index) {
      const dt = event.dataTransfer;
      const targetIndex = index ?? PlacesUtils.bookmarks.DEFAULT_INDEX;

      // 1. Internal rail item → move / reorder within Places.
      const guid = dt.getData(FLAVOR_ITEM);
      if (guid) {
        await PlacesUtils.bookmarks.update({
          guid,
          parentGuid,
          index: targetIndex,
        });
        return;
      }

      // 2. A browser tab → the redirected "drag to pin" gesture:
      //    bookmark it, then CLOSE the tab (files it away, frees memory).
      const tab = dt.mozGetDataAt?.("application/x-moz-tabbrowser-tab", 0);
      if (tab?.linkedBrowser) {
        await PlacesUtils.bookmarks.insert({
          parentGuid,
          index: targetIndex,
          title: tab.label,
          url: tab.linkedBrowser.currentURI.spec,
        });
        gBrowser.removeTab(tab);
        return;
      }

      // 3. Plain URL drop (links, address bar). Duplicates allowed by spec.
      const urlData = dt.getData("text/x-moz-url");
      if (urlData) {
        const [url, title] = urlData.split("\n");
        await PlacesUtils.bookmarks.insert({
          parentGuid,
          index: targetIndex,
          title: title || url,
          url,
        });
      }
    },
  };
```

- [ ] **Step 2: Wire it up**

In `Rail._renderNode`, before `return el;`:

```js
      DragDrop.attach(el, row, node, isFolder);
```

In `init()`, after `LiveUpdate.start();`:

```js
    DragDrop.attachRoot(Rail.root);
```

Final exports line:

```js
  window.EasyBookmarks = { log, ZenSpaces, SpaceFolders, Rail, Launcher, ContextMenu, DragDrop };
```

- [ ] **Step 3: Verify each gesture**

1. **Tab → rail:** open a page, drag its tab from the tab strip onto the rail → expected: bookmark appears at the drop position (title + favicon) **and the tab closes**. Check the Library — the bookmark is real.
2. **Reorder:** with 3+ items, drag one above another → order changes in rail AND Library.
3. **Into folder:** drag an item onto "Work Tools" (folder highlights with dashed outline) → item moves inside; expand to confirm.
4. **Out of folder:** expand the folder, drag a child onto the rail background → moves to top level.
5. **URL drop:** drag a link from a webpage onto the rail → bookmark created. Drag the same link again → duplicate created (allowed by spec).
6. If `mozGetDataAt` yields nothing for tab drags (flavor name drifted), inspect available flavors in the drop handler via `console.log([...event.dataTransfer.types])` and adapt flavor names — contained to this module.

- [ ] **Step 4: Commit**

```bash
git add easy-bookmarks.uc.js
git commit -m "feat: drag & drop — tab files away as bookmark, reorder, folders"
```

---

### Task 10: README, metadata polish, final review

**Files:**
- Create: `README.md`
- Modify: `theme.json` (only if publishing URL is known)

- [ ] **Step 1: Write `README.md`**

```markdown
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

## Development

`powershell -File dev-install.ps1 -ProfileDir "<profile root from about:profiles>"`
then restart Zen. Logs appear in the Browser Console (`Ctrl+Shift+J`)
prefixed `[EasyBookmarks]`.
```

- [ ] **Step 2: Update `theme.json` `homepage`** if the GitHub repo now exists; otherwise leave CHANGEME and note it for publish time.

- [ ] **Step 3: Full manual regression pass**

Run through: click-launch (rule 1) → no × / right-click delete (rule 3) → folder expand/collapse → tab-drag files away and closes → reorder → space switch → Library edit live-updates → restart persistence. All behaviors from the spec's "Three Rules" and "Drag Behavior" sections must pass.

- [ ] **Step 4: Commit**

```bash
git add README.md theme.json
git commit -m "docs: README with behavior, caveats, and dev workflow"
```

---

## Plan Self-Review (done at write time)

- **Spec coverage:** Rule 1 → Task 5; Rule 2 (unloaded by nature) → inherent to rendering bookmarks, no bulk-open implemented anywhere; Rule 3 → Task 4 (no ×) + Task 6 (right-click delete); per-space folders by id + rename sync → Task 3/8; container-aware launch → Task 5; drag behaviors incl. tab-close → Task 9; Essentials untouched → CSS only hides `#vertical-pinned-tabs-container` (Task 4); no-migration + internals risk → README (Task 10); mapping in JSON pref → Task 3; Places observer → Task 7; orphan folder on space delete → no code deletes folders except user action (verified Task 8).
- **Known-unknowns are explicit:** Zen property names (Task 2 Step 1), pinned-container selector (Task 4 Step 1), tab drag flavor (Task 9 Step 3.6) each have a discovery step and are contained to one module.
- **Type consistency:** `ZenSpaces.getActive() → {id, name, containerId}` consumed by Tasks 3/5/8 with those exact keys; `SpaceFolders.ensureSpaceFolder(space) → guid string`; `Rail.folderGuid` set in `refresh()` before `ContextMenu`/`DragDrop` read it.
