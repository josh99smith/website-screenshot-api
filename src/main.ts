import { setTimeout as sleep } from 'node:timers/promises';

import { PlaywrightCrawler } from '@crawlee/playwright';
import { Actor, log } from 'apify';
import type { Page } from 'playwright';

import {
    categorizeError,
    COOKIE_BANNER_SELECTORS,
    type ErrorType,
    type Input,
    isSameSite,
    normalizeUrl,
    parseSettings,
    recordKey,
    type Settings,
} from './options.js';

const SCREENSHOT_EVENT = 'screenshot';
const PDF_EVENT = 'pdf-rendered';

interface SuccessItem {
    url: string;
    finalUrl: string;
    success: true;
    statusCode: number | null;
    title: string | null;
    screenshotUrl: string;
    screenshotKey: string;
    format: string;
    width: number;
    height: number;
    fullPage: boolean;
    device: string;
    sizeBytes: number;
    pdfUrl?: string;
    pdfKey?: string;
    pdfSizeBytes?: number;
    renderTimeMs: number;
    warnings?: string[];
    fetchedAt: string;
}

interface FailureItem {
    url: string;
    success: false;
    errorType: ErrorType;
    error: string;
    statusCode?: number;
    fetchedAt: string;
}

const MIME: Record<Settings['format'], string> = { png: 'image/png', jpeg: 'image/jpeg' };

async function autoScroll(page: Page, maxSteps = 40): Promise<void> {
    // No named inner functions inside evaluate(): tsx/esbuild would inject a `__name` helper that does not exist in the page.
    // Scrolling is 'instant' because pages with `scroll-behavior: smooth` would otherwise still be animating back to
    // the top when the screenshot is taken, leaving a blank band and misplaced fixed elements.
    await page.evaluate(async (steps) => {
        let last = -1;
        for (let i = 0; i < steps; i++) {
            window.scrollBy({ top: window.innerHeight, behavior: 'instant' });
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 120);
            });
            const h = document.documentElement.scrollHeight;
            if (window.scrollY + window.innerHeight >= h && h === last) break;
            last = h;
        }
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }, maxSteps);
    await sleep(200);
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
}

/**
 * Pins `position: fixed` elements to one spot in the document and turns `sticky` ones into `relative`, so
 * headers, navbars, cookie bars and chat bubbles appear exactly once in a full-page capture: top-anchored
 * elements stay where they are on first view, bottom-anchored ones move to the end of the page instead of
 * floating in the middle of the image. Best effort: pages that forbid inline styles are left as they are.
 */
async function unstickFixedElements(page: Page): Promise<number> {
    return page.evaluate(() => {
        const docHeight = document.documentElement.scrollHeight;
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const fixed: { el: HTMLElement; rect: DOMRect }[] = [];
        const sticky: HTMLElement[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('body *')) {
            const { position } = window.getComputedStyle(el);
            if (position === 'fixed') fixed.push({ el, rect: el.getBoundingClientRect() });
            else if (position === 'sticky') sticky.push(el);
        }
        // Measure everything first, then mutate, so earlier changes do not shift later measurements.
        for (const el of sticky) el.style.setProperty('position', 'relative', 'important');
        for (const { el, rect } of fixed) {
            if (rect.width === 0 && rect.height === 0) continue;
            const { style } = el;
            // Off-screen drawers and menus stay invisible; as absolute boxes they would land inside the tall capture.
            if (rect.right <= 0 || rect.left >= viewportWidth || rect.bottom <= 0 || rect.top >= viewportHeight) {
                style.setProperty('visibility', 'hidden', 'important');
                continue;
            }
            // Pin the box at its current size, move it to the origin of whatever its containing block turns out
            // to be, measure where that origin lands, then offset from there. This sidesteps guessing which
            // ancestor (positioned, transformed, contained, ...) establishes the containing block.
            style.setProperty('transition', 'none', 'important');
            style.setProperty('animation', 'none', 'important');
            style.setProperty('position', 'absolute', 'important');
            style.setProperty('top', '0px', 'important');
            style.setProperty('left', '0px', 'important');
            style.setProperty('right', 'auto', 'important');
            style.setProperty('bottom', 'auto', 'important');
            // A box parked partly outside the right edge (reCAPTCHA badges, side tabs) must not widen the page.
            const width = rect.right > viewportWidth ? viewportWidth - Math.max(0, rect.left) : rect.width;
            if (width !== rect.width) style.setProperty('overflow', 'hidden', 'important');
            style.setProperty('width', `${width}px`, 'important');
            style.setProperty('height', `${rect.height}px`, 'important');
            style.setProperty('margin', '0', 'important');
            style.setProperty('transform', 'none', 'important');
            const origin = el.getBoundingClientRect();
            const originTop = origin.top + window.scrollY;
            const originLeft = origin.left + window.scrollX;
            // Only bars and bubbles that hug the bottom edge and hang off the document itself move to the page end;
            // anything inside a positioned ancestor stays put so overflow clipping cannot hide it.
            const documentLevel = el.offsetParent === document.body || el.offsetParent === null;
            const anchoredToBottom =
                documentLevel && rect.bottom >= viewportHeight - 100 && rect.top > viewportHeight / 2;
            const docTop = anchoredToBottom
                ? docHeight - (viewportHeight - rect.bottom) - rect.height
                : rect.top + window.scrollY;
            const docLeft = rect.left + window.scrollX;
            style.setProperty('top', `${(documentLevel ? Math.max(0, docTop) : docTop) - originTop}px`, 'important');
            style.setProperty('left', `${docLeft - originLeft}px`, 'important');
        }
        return fixed.length + sticky.length;
    });
}

async function imageDimensions(buffer: Buffer, format: Settings['format']): Promise<{ width: number; height: number }> {
    try {
        if (format === 'png' && buffer.length > 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
            return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
        }
        if (format === 'jpeg') {
            let i = 2;
            while (i < buffer.length) {
                if (buffer[i] !== 0xff) break;
                const marker = buffer[i + 1];
                const len = buffer.readUInt16BE(i + 2);
                if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                    return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
                }
                i += 2 + len;
            }
        }
    } catch {
        /* fall through */
    }
    return { width: 0, height: 0 };
}

await Actor.init();

Actor.on('aborting', async () => {
    await sleep(1000);
    await Actor.exit();
});

const input = (await Actor.getInput<Input>()) ?? {};
const settings = parseSettings(input);

const rawUrls = (input.urls ?? []).map((u) => (typeof u === 'string' ? u : (u?.url ?? '')));
if (rawUrls.length === 0) {
    await Actor.fail('Input "urls" is empty. Provide at least one website URL, e.g. ["https://apify.com"].');
}

const requests: { url: string; uniqueKey: string; userData: { originalUrl: string; index: number } }[] = [];
const seen = new Set<string>();
const earlyFailures: FailureItem[] = [];
let index = 0;
for (const raw of rawUrls) {
    const normalized = normalizeUrl(raw);
    if (!normalized) {
        earlyFailures.push({
            url: raw,
            success: false,
            errorType: 'invalid-url',
            error: 'Not a valid website URL',
            fetchedAt: new Date().toISOString(),
        });
        continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    index += 1;
    requests.push({ url: normalized, uniqueKey: normalized, userData: { originalUrl: raw, index } });
}
if (earlyFailures.length) await Actor.pushData(earlyFailures);

const env = Actor.getEnv();
const storeId = env.defaultKeyValueStoreId ?? 'default';
const store = await Actor.openKeyValueStore();
const publicUrl = (key: string) =>
    env.isAtHome ? `https://api.apify.com/v2/key-value-stores/${storeId}/records/${key}` : store.getPublicUrl(key);

log.info(
    `Rendering ${requests.length} page(s): device=${settings.device} ${settings.viewport.width}x${settings.viewport.height}@${settings.deviceScaleFactor}x, format=${settings.format}, fullPage=${settings.fullPage}, pdf=${settings.renderPdf}`,
);
// Cookie and header values are secrets; only their counts are ever logged.
if (
    settings.cookies.length ||
    Object.keys(settings.extraHeaders).length ||
    settings.blockResources.length ||
    settings.waitForSelector
) {
    log.info(
        `Options: cookies=${settings.cookies.length}, extraHeaders=${Object.keys(settings.extraHeaders).length}, blockResources=[${settings.blockResources.join(',')}]` +
            `${settings.waitForSelector ? `, waitForSelector="${settings.waitForSelector}"` : ''}`,
    );
}
const BLOCKED_TYPES = new Set<string>(settings.blockResources.flatMap((t) => (t === 'xhr' ? ['xhr', 'fetch'] : [t])));
const HAS_EXTRA_HEADERS = Object.keys(settings.extraHeaders).length > 0;

const proxyConfiguration =
    input.proxyConfiguration?.useApifyProxy || input.proxyConfiguration?.proxyUrls?.length
        ? await Actor.createProxyConfiguration(input.proxyConfiguration)
        : undefined;

let rendered = 0;
let charged = 0;
let failed = 0;
let stopBecauseOfBudget = false;

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency: settings.maxConcurrency,
    maxRequestRetries: settings.maxRetries,
    navigationTimeoutSecs: settings.timeoutSecs,
    requestHandlerTimeoutSecs: settings.timeoutSecs + 60 + (settings.waitForSelector ? settings.timeoutSecs : 0),
    retryOnBlocked: false,
    useSessionPool: true,
    persistCookiesPerSession: false,
    sessionPoolOptions: { blockedStatusCodes: [] },
    launchContext: {
        launchOptions: { args: ['--disable-gpu', '--disable-dev-shm-usage'] },
    },
    browserPoolOptions: {
        // Deterministic rendering matters more than fingerprint randomisation for a screenshot tool
        // (random fingerprints flip prefers-color-scheme and screen metrics).
        useFingerprints: false,
        prePageCreateHooks: [
            /* eslint-disable no-param-reassign -- crawlee expects the options object to be mutated */
            (_pageId, _browserController, pageOptions) => {
                if (!pageOptions) return;
                pageOptions.viewport = settings.viewport;
                pageOptions.deviceScaleFactor = settings.deviceScaleFactor;
                pageOptions.isMobile = settings.isMobile;
                pageOptions.hasTouch = settings.hasTouch;
                if (settings.userAgent) pageOptions.userAgent = settings.userAgent;
                pageOptions.colorScheme = settings.darkMode ? 'dark' : 'light';
                pageOptions.ignoreHTTPSErrors = true;
            },
            /* eslint-enable no-param-reassign */
        ],
    },
    preNavigationHooks: [
        async ({ page, request }, gotoOptions) => {
            if (gotoOptions) {
                /* eslint-disable no-param-reassign -- crawlee expects gotoOptions to be mutated */
                // Navigate on 'load' (or faster); 'networkidle' is applied best-effort after navigation so that
                // pages with long-polling or analytics beacons never time out the whole request.
                gotoOptions.waitUntil = settings.waitUntil === 'domcontentloaded' ? 'domcontentloaded' : 'load';
                gotoOptions.timeout = settings.timeoutSecs * 1000;
                /* eslint-enable no-param-reassign */
            }
            await page.setViewportSize(settings.viewport);
            await page.emulateMedia({ colorScheme: settings.darkMode ? 'dark' : 'light' });
            if (settings.cookies.length) await page.context().addCookies(settings.cookies);
            if (BLOCKED_TYPES.size || HAS_EXTRA_HEADERS) {
                // Extra headers go only to the page's own site. Sending custom headers to third-party hosts
                // (via setExtraHTTPHeaders) forces CORS preflights that CDNs reject, so stylesheets fail to
                // load, and it would leak Authorization tokens to trackers and CDNs.
                const pageHost = new URL(request.url).hostname;
                await page.route('**/*', async (route) => {
                    const req = route.request();
                    if (BLOCKED_TYPES.has(req.resourceType())) {
                        await route.abort('blockedbyclient');
                        return;
                    }
                    if (HAS_EXTRA_HEADERS && isSameSite(new URL(req.url()).hostname, pageHost)) {
                        await route.continue({ headers: { ...req.headers(), ...settings.extraHeaders } });
                        return;
                    }
                    await route.continue();
                });
            }
        },
    ],
    async requestHandler({ request, response, page }) {
        if (stopBecauseOfBudget) return;
        const started = Date.now();
        const statusCode = response?.status() ?? null;

        const warnings: string[] = [];

        if (settings.waitUntil === 'networkidle') {
            await page
                .waitForLoadState('networkidle', { timeout: Math.min(15000, settings.timeoutSecs * 500) })
                .catch(() => undefined);
        }
        if (settings.waitForSelector) {
            try {
                await page.waitForSelector(settings.waitForSelector, {
                    state: 'attached',
                    timeout: settings.timeoutSecs * 1000,
                });
            } catch {
                warnings.push('waitForSelector timed out');
                log.warning(
                    `${request.url}: selector "${settings.waitForSelector}" did not appear within ${settings.timeoutSecs} s; capturing anyway.`,
                );
            }
        }

        const wholePage = settings.fullPage && !settings.clipSelector;
        if (settings.autoScroll && wholePage) {
            try {
                await autoScroll(page);
            } catch {
                /* pages with scroll traps are fine to skip */
            }
        }
        if (settings.unstickFixed && wholePage) {
            try {
                await unstickFixedElements(page);
            } catch {
                /* CSP or a detached frame; keep the original layout */
            }
        }
        const hide = [...(settings.hideCookieBanners ? COOKIE_BANNER_SELECTORS : []), ...settings.hideSelectors];
        if (hide.length) {
            try {
                await page.addStyleTag({
                    content: `${hide.join(',\n')} { display: none !important; visibility: hidden !important; }`,
                });
            } catch {
                /* CSP may block inline styles; continue without hiding */
            }
        }
        if (settings.delayMs) await sleep(settings.delayMs);

        let buffer: Buffer;
        if (settings.clipSelector) {
            const el = await page.$(settings.clipSelector);
            if (!el) throw new Error(`Element not found for clipSelector "${settings.clipSelector}"`);
            buffer = await el.screenshot({ type: settings.format, quality: settings.quality, timeout: 30000 });
        } else {
            buffer = await page.screenshot({
                type: settings.format,
                quality: settings.quality,
                fullPage: settings.fullPage,
                timeout: 45000,
                animations: 'disabled',
            });
        }
        if (!buffer || buffer.length < 100) throw new Error('Screenshot capture produced an empty image');

        const ext = settings.format === 'jpeg' ? 'jpg' : settings.format;
        const key = recordKey('screenshot', request.userData.index, request.loadedUrl ?? request.url, ext);
        await store.setValue(key, buffer, { contentType: MIME[settings.format] });
        const dims = await imageDimensions(buffer, settings.format);

        const item: SuccessItem = {
            url: request.userData.originalUrl,
            finalUrl: request.loadedUrl ?? request.url,
            success: true,
            statusCode,
            title: (await page.title().catch(() => null)) || null,
            screenshotUrl: publicUrl(key),
            screenshotKey: key,
            format: settings.format,
            width: dims.width,
            height: dims.height,
            fullPage: wholePage,
            device: settings.device,
            sizeBytes: buffer.length,
            renderTimeMs: 0,
            fetchedAt: new Date().toISOString(),
        };
        if (warnings.length) item.warnings = warnings;

        let pdfCharge = 0;
        if (settings.renderPdf) {
            try {
                await page.emulateMedia({ media: 'screen' });
                const pdf = await page.pdf({ format: settings.pdfFormat, printBackground: true });
                const pdfKey = recordKey('pdf', request.userData.index, item.finalUrl, 'pdf');
                await store.setValue(pdfKey, pdf, { contentType: 'application/pdf' });
                item.pdfUrl = publicUrl(pdfKey);
                item.pdfKey = pdfKey;
                item.pdfSizeBytes = pdf.length;
                pdfCharge = 1;
            } catch (err) {
                log.warning(
                    `${item.finalUrl}: PDF rendering failed (${(err as Error).message.slice(0, 120)}); screenshot still delivered.`,
                );
            }
        }
        item.renderTimeMs = Date.now() - started;

        const result = await Actor.pushData(item, SCREENSHOT_EVENT);
        rendered += 1;
        charged += 1;
        let limitReached = result.eventChargeLimitReached;
        if (pdfCharge && !limitReached) {
            const pdfResult = await Actor.charge({ eventName: PDF_EVENT });
            limitReached = pdfResult.eventChargeLimitReached;
        }
        log.info(
            `${item.finalUrl}: ${dims.width}x${dims.height} ${settings.format} ${(buffer.length / 1024).toFixed(0)} KB in ${item.renderTimeMs} ms${item.pdfUrl ? ' + PDF' : ''}${warnings.length ? ` (warnings: ${warnings.join('; ')})` : ''}`,
        );
        if (limitReached) {
            stopBecauseOfBudget = true;
            log.warning(
                'Maximum charge limit for this run reached; stopping early. Raise the run cost limit to render more pages.',
            );
            await crawler.autoscaledPool?.abort();
        }
    },
    async failedRequestHandler({ request }, error) {
        failed += 1;
        const { statusCode } = error as { statusCode?: number };
        const item: FailureItem = {
            url: request.userData.originalUrl,
            success: false,
            errorType: categorizeError(error.message, statusCode),
            error: error.message.split('\n')[0].slice(0, 500),
            statusCode,
            fetchedAt: new Date().toISOString(),
        };
        log.warning(`${request.url}: ${item.errorType} - ${item.error}`);
        await Actor.pushData(item); // free of charge
    },
});

await crawler.run(requests);

const summary = {
    requested: rawUrls.length,
    rendered,
    failed: failed + earlyFailures.length,
    chargedScreenshots: charged,
    stoppedEarlyDueToBudget: stopBecauseOfBudget,
    keyValueStoreId: storeId,
};
await Actor.setValue('SUMMARY', summary);
log.info(`Done. ${JSON.stringify(summary)}`);

await Actor.exit();
