// ==UserScript==
// @name         YouTube Thumbnail Viewer
// @namespace    https://tampermonkey.net/
// @version      1.4
// @description  Shows current video thumbnail + title above recommendations and reliably keeps title in sync during SPA navigation.
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // Utility: wait for element (promise)
    function waitFor(selector, timeout = 10000) {
        return new Promise((resolve) => {
            const start = performance.now();
            (function check() {
                const el = document.querySelector(selector);
                if (el) return resolve(el);
                if (performance.now() - start > timeout) return resolve(null);
                requestAnimationFrame(check);
            })();
        });
    }

    // Get current video id from URL
    function currentVideoId() {
        return new URLSearchParams(location.search).get('v');
    }

    // Create or update the panel using provided title and thumbnail URL
    function renderPanel({ title, thumbnailUrl }) {
        const sidebar = document.querySelector('#secondary-inner');
        if (!sidebar) return;

        let panel = document.querySelector('#tm-video-info-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'tm-video-info-panel';
            panel.style.marginBottom = '16px';
            panel.style.padding = '0';
            panel.style.background = 'transparent';
            panel.style.display = 'flex';
            panel.style.flexDirection = 'column';
            panel.style.gap = '10px';
            // Use a stable inner structure we can update later
            panel.innerHTML = `
                <div class="tm-thumb-wrap" style="width:100%; aspect-ratio:16/9; overflow:hidden;">
                    <img class="tm-thumb-img" src="" style="width:100%; height:100%; object-fit:cover; display:block;">
                </div>
                <div class="tm-title" style="font-size:16px; font-weight:bold; color:white; text-align:center;"></div>
            `;
            sidebar.prepend(panel);
        }

        const img = panel.querySelector('.tm-thumb-img');
        const titleDiv = panel.querySelector('.tm-title');

        // Update image only if changed to avoid flicker
        if (thumbnailUrl && img.src !== thumbnailUrl) {
            img.src = thumbnailUrl;
        }

        // Update title if different
        if (typeof title === 'string' && titleDiv.innerText !== title) {
            titleDiv.innerText = title;
        }
    }

    // Remove panel
    function removePanel() {
        const old = document.querySelector('#tm-video-info-panel');
        if (old) old.remove();
    }

    // Build thumbnail URL from video id (try maxres, fallback to hqdefault)
    function thumbUrlForId(vid) {
        if (!vid) return '';
        // Prefer maxres then hq — browser will 404 if not available but it's okay (fallback handled by server)
        return `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`;
    }

    // Try to read title element safely
    function readTitleText() {
        const titleEl = document.querySelector('h1.title') || document.querySelector('h1.ytd-watch-metadata');
        return titleEl ? titleEl.innerText.trim() : '';
    }

    // Observers and binding
    let titleObserver = null;
    let lastSeenVideoId = null;

    // Bind observer to the title element so we react exactly when it changes
    function bindTitleObserver() {
        // Clean up old observer
        if (titleObserver) {
            try { titleObserver.disconnect(); } catch (e) { /* ignore */ }
            titleObserver = null;
        }

        // Find the best title element available
        const titleEl = document.querySelector('h1.title') || document.querySelector('h1.ytd-watch-metadata');

        if (!titleEl) return; // nothing to observe right now

        // Observe text changes in the title element (and subtree in case children update)
        titleObserver = new MutationObserver((mutations) => {
            // When the title text changes, update panel immediately
            const newTitle = readTitleText();
            const vid = currentVideoId();
            renderPanel({ title: newTitle, thumbnailUrl: thumbUrlForId(vid) });
        });

        titleObserver.observe(titleEl, { characterData: true, subtree: true, childList: true });
    }

    // Called whenever we want to refresh panel state (URL change or initial)
    async function refreshPanel() {
        // Skip Shorts
        if (location.pathname.startsWith('/shorts')) {
            removePanel();
            return;
        }

        // Wait for sidebar and title element to appear (reasonable timeout)
        const sidebar = await waitFor('#secondary-inner', 8000);
        if (!sidebar) return;

        // Update thumbnail immediately based on URL
        const vid = currentVideoId();
        lastSeenVideoId = vid;
        const thumb = thumbUrlForId(vid);

        // If title exists, use it; otherwise set empty and rely on title observer to update when it appears
        const titleText = readTitleText();

        renderPanel({ title: titleText || '', thumbnailUrl: thumb });

        // Bind observer to update the title once it's available or changes
        bindTitleObserver();

        // Also watch for the title element being replaced (YouTube may replace the whole node)
        // We'll observe a higher container for childList changes and re-bind when replacement occurs.
        const primary = document.querySelector('#primary') || document.body;
        if (primary) {
            // keep only one primary observer to avoid leaks
            if (primary._tmPrimaryObserver) primary._tmPrimaryObserver.disconnect();

            const primaryObserver = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.type === 'childList' && m.removedNodes.length + m.addedNodes.length > 0) {
                        // Rebind title observer (it will handle no-op if nothing changed)
                        bindTitleObserver();

                        // Also ensure we refresh panel content in case the title element was replaced but text already changed
                        const newTitle = readTitleText();
                        const newVid = currentVideoId();
                        renderPanel({ title: newTitle || '', thumbnailUrl: thumbUrlForId(newVid) });
                        break;
                    }
                }
            });

            primaryObserver.observe(primary, { childList: true, subtree: true });
            // store so we can disconnect later if needed
            primary._tmPrimaryObserver = primaryObserver;
        }
    }

    // SPA navigation detection: watch for URL changes
    let lastUrl = location.href;
    const spaObserver = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            // Debounce a bit because YouTube may do multiple mutations
            setTimeout(refreshPanel, 100);
        }
    });
    spaObserver.observe(document, { subtree: true, childList: true });

    // Initial run
    refreshPanel();

    // Clean up when navigating to Shorts or leaving page
    window.addEventListener('yt-navigate-start', () => {
        // YouTube's own event; remove panel if navigating to shorts
        if (location.pathname.startsWith('/shorts')) removePanel();
    });

})();
