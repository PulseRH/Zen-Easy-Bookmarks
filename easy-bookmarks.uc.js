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
