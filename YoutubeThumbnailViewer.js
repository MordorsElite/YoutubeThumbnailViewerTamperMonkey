// ==UserScript==
// @name         YouTube Thumbnail Viewer
// @namespace    https://tampermonkey.net/
// @version      1.6
// @description  Shows current video thumbnail + title above recommendations with reliable fallback detection and no flickering.
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // Global: track if a correct thumbnail has been successfully loaded for the current video
    let tmHasGoodThumbnail = false;

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

    // Build thumbnail URL from video id (try maxres)
    function thumbUrlForId(vid) {
        if (!vid) return '';
        return `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`;
    }

    // Detect YouTube's blank placeholder thumbnail (usually ≤ 90 px tall)
    function isBlankYouTubeThumbnail(img) {
        return img.naturalHeight > 0 && img.naturalHeight <= 90;
    }

    // Read title safely
    function readTitleText() {
        const titleEl =
            document.querySelector('h1.title') ||
            document.querySelector('h1.ytd-watch-metadata');
        return titleEl ? titleEl.innerText.trim() : '';
    }

    // Create or update the panel
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

        // Update the title if changed
        if (typeof title === 'string' && titleDiv.innerText !== title) {
            titleDiv.innerText = title;
        }

        // Update image only if changed AND we haven't already confirmed a good one
        if (thumbnailUrl && img.src !== thumbnailUrl && !tmHasGoodThumbnail) {
            img.onload = () => {
                // Case 1: maxres works
                if (!isBlankYouTubeThumbnail(img)) {
                    tmHasGoodThumbnail = true;
                    return;
                }

                // Case 2: fallback to hqdefault
                const hq = thumbnailUrl.replace("maxresdefault", "hqdefault");
                img.onload = () => {
                    if (!isBlankYouTubeThumbnail(img)) {
                        tmHasGoodThumbnail = true;
                        return;
                    }

                    // Case 3: fallback to default
                    const def = thumbnailUrl.replace("maxresdefault", "default");
                    img.onload = () => {
                        // If this loads, it's always OK
                        tmHasGoodThumbnail = true;
                    };
                    img.src = def;
                };
                img.src = hq;
            };

            img.src = thumbnailUrl;
        }
    }

    // Remove panel entirely
    function removePanel() {
        const old = document.querySelector('#tm-video-info-panel');
        if (old) old.remove();
    }

    // Title observer reference
    let titleObserver = null;

    // Bind title change observer
    function bindTitleObserver() {
        if (titleObserver) {
            try { titleObserver.disconnect(); } catch (e) {}
            titleObserver = null;
        }

        const titleEl =
            document.querySelector('h1.title') ||
            document.querySelector('h1.ytd-watch-metadata');

        if (!titleEl) return;

        titleObserver = new MutationObserver(() => {
            const newTitle = readTitleText();
            const vid = currentVideoId();
            renderPanel({ title: newTitle, thumbnailUrl: thumbUrlForId(vid) });
        });

        titleObserver.observe(titleEl, {
            characterData: true,
            subtree: true,
            childList: true,
        });
    }

    // Refresh panel contents (called on initial load & SPA navigation)
    async function refreshPanel() {
        // Reset thumbnail flag for the new video
        tmHasGoodThumbnail = false;

        // Skip Shorts
        if (location.pathname.startsWith('/shorts')) {
            removePanel();
            return;
        }

        const sidebar = await waitFor('#secondary-inner', 8000);
        if (!sidebar) return;

        const vid = currentVideoId();
        const thumb = thumbUrlForId(vid);
        const titleText = readTitleText();

        renderPanel({ title: titleText, thumbnailUrl: thumb });

        bindTitleObserver();

        // Watch for title node replacement
        const primary = document.querySelector('#primary') || document.body;
        if (primary) {
            if (primary._tmPrimaryObserver) {
                try { primary._tmPrimaryObserver.disconnect(); } catch (e) {}
            }

            const primaryObserver = new MutationObserver(() => {
                bindTitleObserver();
                const newTitle = readTitleText();
                const newVid = currentVideoId();
                renderPanel({
                    title: newTitle,
                    thumbnailUrl: thumbUrlForId(newVid)
                });
            });

            primaryObserver.observe(primary, { childList: true, subtree: true });
            primary._tmPrimaryObserver = primaryObserver;
        }
    }

    // Monitor URL changes (SPA)
    let lastUrl = location.href;
    const spaObserver = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(refreshPanel, 100);
        }
    });
    spaObserver.observe(document, { subtree: true, childList: true });

    // Initial run
    refreshPanel();

    // Clean up on Shorts navigation
    window.addEventListener('yt-navigate-start', () => {
        if (location.pathname.startsWith('/shorts')) removePanel();
    });

})();
