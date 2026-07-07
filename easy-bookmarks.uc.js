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
      DragDrop.attach(el, row, node, isFolder);
      return el;
    },
  };

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
    LiveUpdate.start();
    DragDrop.attachRoot(Rail.root);
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
  window.EasyBookmarks = { log, ZenSpaces, SpaceFolders, Rail, Launcher, ContextMenu, DragDrop };
})();
