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
    // verified at runtime by the human in Task 2 Step 1).
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
      } else {
        row.addEventListener("click", (event) => {
          if (event.button !== 0) return;
          const space = ZenSpaces.getActive();
          Launcher.open(node.uri, space?.containerId ?? 0);
        });
      }
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        ContextMenu.openFor(node, isFolder, event);
      });
      // NOTE: rule #3 — deliberately NO close/× button on any row.
      return el;
    },
  };

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
    if (!Rail.mount()) return;
    ZenSpaces.onChange(() => Rail.refresh());
    Rail.refresh();
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
  window.EasyBookmarks = { log, ZenSpaces, SpaceFolders, Rail, Launcher, ContextMenu };
})();
