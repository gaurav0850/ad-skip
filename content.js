/*
 * Generic Video Ad Skipper
 * ------------------------------------------------------------
 * Site-agnostic. For every visible <video> it looks for signs that an ad
 * is playing in/over it, then:
 *   1. clicks a "Skip ad" button if one is on top of the video, else
 *   2. if the ad is its own short video  -> jumps to its last moment, else
 *   3. if the ad is stitched into a long stream and a countdown is shown
 *      -> jumps forward by the countdown (never past the seekable end).
 */
(() => {
    "use strict";

    const CONFIG = {
        DEBUG: true,
        TICK_MS: 500,
        MAX_AD_SECONDS: 180,          // a standalone video longer than this is never treated as an ad
        COUNTDOWN_TOLERANCE_S: 3,     // allowed mismatch between on-screen countdown and video time left
        STITCHED_COOLDOWN_MS: 1200,   // min gap between forward jumps in a stitched stream
        CLICK_COOLDOWN_MS: 800,
        MIN_VIDEO_W: 150,
        MIN_VIDEO_H: 80,
        LABEL_CLIMB_LEVELS: 5,        // how far above a video to look for an "Ad 1 of 2" label
        MUTE_DURING_ADS: true,        // mute the video while an ad is detected, restore afterwards
        UNMUTE_DELAY_MS: 700          // wait this long after the ad signal disappears before unmuting
    };

    const log = (...a) => CONFIG.DEBUG && console.log("[AdSkipper]", ...a);

    // ---------- Signal definitions ----------

    // Class fragments meaning "the player is currently in an ad state" (strong)
    const STRONG_CLASS = [
        "ad-showing", "ad-playing", "ad-interrupting", "ima-ad-container",
        "vjs-ad-playing", "jw-flag-ads"
    ];
    // Class fragments for ad UI that may also appear around normal content (weak:
    // never trigger a seek on their own, only help when a countdown is present)
    const WEAK_CLASS = [
        "ad-overlay", "ad-badge", "adbadge", "ad-countdown", "adcountdown",
        "ad-timer", "ad-container", "ads-container", "advertisement"
    ];
    const sel = (list) => list.map((c) => `[class*="${c}" i]`).join(",");
    const STRONG_SEL = sel(STRONG_CLASS);
    const WEAK_SEL = sel(WEAK_CLASS);

    // "Ad", "Ad 1 of 2", "Ad 1 of 1 (00:03)", "Ad · 0:15", "Advertisement 15s"
    const AD_LABEL = new RegExp(
        "^(?:ad|ads|advert(?:isement)?)" +
        "(?:\\s*[:·•|\\-–]?\\s*\\d+\\s*(?:of|/)\\s*\\d+)?" +
        "(?:\\s*[:·•|\\-–]?\\s*\\(?(?:\\d{1,2}:\\d{2}|\\d{1,3}\\s*s(?:ec(?:onds?)?)?)\\)?)?$",
        "i"
    );

    const SKIP_CLASS_SEL = sel(["skip-ad", "skipad", "skip_ad", "ad-skip"]) + ',[aria-label*="skip ad" i]';
    const SKIP_TEXT = /^skip\s*ads?$/i;

    // ---------- Helpers ----------

    const rectOf = (el) => el.getBoundingClientRect();

    function isVisible(el) {
        if (!el || !el.isConnected) return false;
        const r = rectOf(el);
        if (r.width <= 0 || r.height <= 0) return false;
        const s = getComputedStyle(el);
        return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
    }

    function intersects(a, b, pad = 0) {
        return a.left < b.right + pad && a.right > b.left - pad &&
            a.top < b.bottom + pad && a.bottom > b.top - pad;
    }

    // Is `el` an ancestor of the video, or visibly overlapping it?
    function relatedToVideo(el, video) {
        if (el === document.body || el === document.documentElement) return false;
        if (el.contains(video)) return true;
        return isVisible(el) && intersects(rectOf(el), rectOf(video), 10);
    }

    function parseSeconds(text) {
        let m = /(\d{1,2}):(\d{2})/.exec(text);
        if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        m = /(\d{1,3})\s*s/i.exec(text);
        return m ? parseInt(m[1], 10) : null;
    }

    function usableVideo(v) {
        if (!isVisible(v)) return false;
        const r = rectOf(v);
        return r.width >= CONFIG.MIN_VIDEO_W && r.height >= CONFIG.MIN_VIDEO_H;
    }

    // The largest visible, playing video on the page
    function isMainVideo(v) {
        if (v.paused || v.readyState < 2) return false;
        const area = (x) => { const r = rectOf(x); return r.width * r.height; };
        return [...document.querySelectorAll("video")].every(
            (o) => o === v || o.paused || !isVisible(o) || area(o) <= area(v)
        );
    }

    // ---------- Detection ----------

    // Returns { strong, remaining, why } or null
    function detectAdSignal(video) {
        // 1) player-state classes on the video's ancestors or overlapping it
        for (const el of document.querySelectorAll(STRONG_SEL)) {
            if (relatedToVideo(el, video)) {
                return { strong: true, remaining: labelRemaining(video), why: `class:${el.className && el.className.baseVal === undefined ? String(el.className).slice(0, 40) : "svg"}` };
            }
        }

        // 2) on-screen label like "Ad 1 of 2 (00:20)"
        const label = findAdLabel(video);
        if (label) return { strong: true, remaining: parseSeconds(label), why: `label:"${label}"` };

        // 3) weak UI classes (only useful together with a countdown)
        for (const el of document.querySelectorAll(WEAK_SEL)) {
            if (relatedToVideo(el, video)) {
                return { strong: false, remaining: labelRemaining(video), why: "weak-class" };
            }
        }
        return null;
    }

    function labelRemaining(video) {
        const label = findAdLabel(video);
        return label ? parseSeconds(label) : null;
    }

    function findAdLabel(video) {
        let container = video;
        for (let i = 0; i < CONFIG.LABEL_CLIMB_LEVELS && container.parentElement &&
        container.parentElement !== document.body; i++) {
            container = container.parentElement;
        }
        const vr = rectOf(video);
        for (const el of container.querySelectorAll("span,div,p,label,b,strong,i")) {
            if (el.childElementCount > 4) continue;
            const t = (el.textContent || "").replace(/\s+/g, " ").trim();
            if (t.length < 2 || t.length > 40 || !AD_LABEL.test(t)) continue;
            if (isVisible(el) && intersects(rectOf(el), vr, 40)) return t;
        }
        return null;
    }

    // ---------- Actions ----------

    let lastClick = 0;
    let lastStitched = 0;
    let lastEdgeLog = 0;
    let lastDiag = 0;

    // ---- Mute during ads, restore afterwards ----
    const muted = new Map(); // video -> { wasMuted, lastSeen }

    function muteForAd(video) {
        const now = Date.now();
        const entry = muted.get(video);
        if (entry) { entry.lastSeen = now; return; }
        muted.set(video, { wasMuted: video.muted, lastSeen: now });
        video.muted = true;
        log("Muted during ad");
    }

    function restoreSound() {
        const now = Date.now();
        for (const [video, entry] of muted) {
            if (now - entry.lastSeen < CONFIG.UNMUTE_DELAY_MS) continue;
            muted.delete(video);
            if (!video.isConnected) continue;
            // Only restore if it's still muted by us (don't override a manual change)
            if (video.muted) {
                video.muted = entry.wasMuted;
                log("Restored sound after ad");
            }
        }
    }

    function clickSkip(video) {
        if (Date.now() - lastClick < CONFIG.CLICK_COOLDOWN_MS) return false;
        const candidates = [...document.querySelectorAll(SKIP_CLASS_SEL)];
        for (const b of document.querySelectorAll('button,[role="button"]')) {
            if (SKIP_TEXT.test((b.textContent || "").trim())) candidates.push(b);
        }
        for (const el of candidates) {
            if (isVisible(el) && intersects(rectOf(el), rectOf(video), 20)) {
                lastClick = Date.now();
                el.click();
                log("Clicked skip button");
                return true;
            }
        }
        return false;
    }

    function processVideo(video) {
        const sig = detectAdSignal(video);
        if (!sig) return;
        if (CONFIG.MUTE_DURING_ADS && sig.strong) muteForAd(video);

        if (CONFIG.DEBUG && Date.now() - lastDiag > 2000) {
            lastDiag = Date.now();
            log("Ad signal:", sig.why, "| strong:", sig.strong, "| remaining:", sig.remaining,
                "| video:", { dur: video.duration, t: +video.currentTime.toFixed(1), paused: video.paused },
                "| frame:", location.hostname);
        }

        if (clickSkip(video)) return;

        const d = video.duration;
        if (!isFinite(d) || d <= 0) return;
        const t = video.currentTime;
        const left = d - t;
        const rem = sig.remaining;

        // A) The ad is its own short video -> jump to its last moment
        const countdownOk = rem === null ? sig.strong : Math.abs(left - rem) <= CONFIG.COUNTDOWN_TOLERANCE_S;
        if (d <= CONFIG.MAX_AD_SECONDS && countdownOk) {
            if (left < 0.3) return;
            log(`Separate ad video: ${t.toFixed(1)} -> ${d.toFixed(1)}`);
            try { video.currentTime = Math.max(0, d - 0.1); video.play().catch(() => {}); }
            catch (e) { log("Seek failed", e); }
            return;
        }

        // B) The ad is stitched into the stream -> jump forward by the countdown
        if (rem === null || rem < 1 || !isMainVideo(video)) return;
        if (Date.now() - lastStitched < CONFIG.STITCHED_COOLDOWN_MS) return;

        const edge = video.seekable && video.seekable.length
            ? video.seekable.end(video.seekable.length - 1) : d;
        const target = Math.min(t + rem - 0.5, edge - 0.2);

        if (target <= t + 0.3) {
            if (Date.now() - lastEdgeLog > 3000) {
                lastEdgeLog = Date.now();
                log(`At live edge (${t.toFixed(1)} / ${edge.toFixed(1)}); cannot skip further`);
            }
            return;
        }
        lastStitched = Date.now();
        log(`Stitched ad: ${t.toFixed(1)} -> ${target.toFixed(1)} (edge ${edge.toFixed(1)})`);
        try { video.currentTime = target; } catch (e) { log("Seek failed", e); }
    }

    // ---------- Loop ----------

    function tick() {
        if (document.hidden) return;
        document.querySelectorAll("video").forEach((v) => {
            if (usableVideo(v)) processVideo(v);
        });
        restoreSound();
    }

    let pending = null;
    const schedule = () => {
        if (pending) return;
        pending = setTimeout(() => { pending = null; tick(); }, 150);
    };

    new MutationObserver(schedule).observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"]
    });
    setInterval(tick, CONFIG.TICK_MS);
    log("Loaded on", location.href);
})();