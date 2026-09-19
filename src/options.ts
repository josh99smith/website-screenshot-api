/** Input parsing and device presets (pure, unit-testable). */

export type ImageFormat = 'png' | 'jpeg';
export type Device = 'desktop' | 'laptop' | 'tablet' | 'mobile' | 'custom';
export type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle';
export type BlockableResource = 'image' | 'media' | 'font' | 'stylesheet' | 'script' | 'xhr';

export const BLOCKABLE_RESOURCES: readonly BlockableResource[] = ['image', 'media', 'font', 'stylesheet', 'script', 'xhr'];

/** A Playwright cookie as accepted by `context.addCookies`. */
export interface CookieInput {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    url?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface Input {
    urls?: (string | { url: string })[];
    device?: Device;
    viewportWidth?: number;
    viewportHeight?: number;
    deviceScaleFactor?: number;
    fullPage?: boolean;
    format?: ImageFormat;
    quality?: number;
    waitUntil?: WaitUntil;
    delayMs?: number;
    autoScroll?: boolean;
    hideCookieBanners?: boolean;
    hideSelectors?: string[];
    clipSelector?: string;
    unstickFixed?: boolean;
    waitForSelector?: string;
    darkMode?: boolean;
    renderPdf?: boolean;
    pdfFormat?: 'A4' | 'Letter' | 'Legal';
    maxConcurrency?: number;
    timeoutSecs?: number;
    maxRetries?: number;
    cookies?: unknown;
    extraHeaders?: unknown;
    blockResources?: unknown;
    proxyConfiguration?: { useApifyProxy?: boolean; apifyProxyGroups?: string[]; apifyProxyCountry?: string; proxyUrls?: string[] };
}

export interface Settings {
    device: Device;
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    isMobile: boolean;
    hasTouch: boolean;
    userAgent?: string;
    fullPage: boolean;
    format: ImageFormat;
    quality?: number;
    waitUntil: WaitUntil;
    delayMs: number;
    autoScroll: boolean;
    hideCookieBanners: boolean;
    hideSelectors: string[];
    clipSelector?: string;
    unstickFixed: boolean;
    waitForSelector?: string;
    darkMode: boolean;
    renderPdf: boolean;
    pdfFormat: 'A4' | 'Letter' | 'Legal';
    maxConcurrency: number;
    timeoutSecs: number;
    maxRetries: number;
    cookies: CookieInput[];
    extraHeaders: Record<string, string>;
    blockResources: BlockableResource[];
}

const MOBILE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export const DEVICE_PRESETS: Record<Exclude<Device, 'custom'>, Pick<Settings, 'viewport' | 'deviceScaleFactor' | 'isMobile' | 'hasTouch' | 'userAgent'>> = {
    desktop: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    laptop: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: MOBILE_UA },
};

const clamp = (value: number | undefined, fallback: number, min: number, max: number): number => {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.min(Math.max(Math.round(n), min), max);
};

export function parseSettings(input: Input): Settings {
    let device: Device = 'laptop';
    if (input.device === 'custom') device = 'custom';
    else if (input.device && input.device in DEVICE_PRESETS) device = input.device;
    const preset = device === 'custom' ? DEVICE_PRESETS.laptop : DEVICE_PRESETS[device];
    const format: ImageFormat = input.format === 'jpeg' ? 'jpeg' : 'png';
    return {
        device,
        viewport: {
            width: clamp(input.viewportWidth, preset.viewport.width, 320, 3840),
            height: clamp(input.viewportHeight, preset.viewport.height, 240, 2160),
        },
        deviceScaleFactor: clamp(input.deviceScaleFactor, preset.deviceScaleFactor, 1, 3),
        isMobile: preset.isMobile,
        hasTouch: preset.hasTouch,
        userAgent: preset.userAgent,
        fullPage: input.fullPage ?? true,
        format,
        quality: format === 'png' ? undefined : clamp(input.quality, 80, 1, 100),
        waitUntil: input.waitUntil === 'load' || input.waitUntil === 'domcontentloaded' ? input.waitUntil : 'networkidle',
        delayMs: clamp(input.delayMs, 500, 0, 15000),
        autoScroll: input.autoScroll ?? true,
        hideCookieBanners: input.hideCookieBanners ?? true,
        hideSelectors: (input.hideSelectors ?? []).map((s) => s.trim()).filter(Boolean),
        clipSelector: input.clipSelector?.trim() || undefined,
        unstickFixed: input.unstickFixed ?? true,
        waitForSelector: typeof input.waitForSelector === 'string' && input.waitForSelector.trim() ? input.waitForSelector.trim() : undefined,
        darkMode: input.darkMode ?? false,
        renderPdf: input.renderPdf ?? false,
        pdfFormat: input.pdfFormat === 'Letter' || input.pdfFormat === 'Legal' ? input.pdfFormat : 'A4',
        maxConcurrency: clamp(input.maxConcurrency, 5, 1, 20),
        timeoutSecs: clamp(input.timeoutSecs, 60, 10, 180),
        maxRetries: clamp(input.maxRetries, 1, 0, 3),
        cookies: parseCookies(input.cookies),
        extraHeaders: parseHeaders(input.extraHeaders),
        blockResources: parseBlockResources(input.blockResources),
    };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Keeps only well-formed cookie objects. A cookie needs `name`, `value` and either `url` or `domain`
 * (Playwright rejects cookies without a scope); `domain` cookies default to path `/`.
 */
export function parseCookies(raw: unknown): CookieInput[] {
    if (!Array.isArray(raw)) return [];
    const cookies: CookieInput[] = [];
    for (const entry of raw) {
        if (!isRecord(entry)) continue;
        const name = typeof entry.name === 'string' ? entry.name.trim() : '';
        if (!name || entry.value === undefined || entry.value === null) continue;
        const value = typeof entry.value === 'string' ? entry.value : String(entry.value);
        const domain = typeof entry.domain === 'string' && entry.domain.trim() ? entry.domain.trim() : undefined;
        const url = typeof entry.url === 'string' && entry.url.trim() ? entry.url.trim() : undefined;
        if (!domain && !url) continue;
        const cookie: CookieInput = { name, value };
        if (url) cookie.url = url;
        if (domain) {
            cookie.domain = domain;
            cookie.path = typeof entry.path === 'string' && entry.path.trim() ? entry.path.trim() : '/';
        } else if (typeof entry.path === 'string' && entry.path.trim()) {
            cookie.path = entry.path.trim();
        }
        if (typeof entry.expires === 'number' && Number.isFinite(entry.expires)) cookie.expires = entry.expires;
        if (typeof entry.httpOnly === 'boolean') cookie.httpOnly = entry.httpOnly;
        if (typeof entry.secure === 'boolean') cookie.secure = entry.secure;
        if (entry.sameSite === 'Strict' || entry.sameSite === 'Lax' || entry.sameSite === 'None') cookie.sameSite = entry.sameSite;
        cookies.push(cookie);
    }
    return cookies;
}

/** Keeps string-valued headers with a syntactically valid name; other values are stringified, blanks dropped. */
export function parseHeaders(raw: unknown): Record<string, string> {
    if (!isRecord(raw)) return {};
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
        const name = key.trim();
        if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) continue;
        let text = '';
        if (typeof value === 'string') text = value;
        else if (typeof value === 'number' || typeof value === 'boolean') text = String(value);
        if (!text) continue;
        headers[name] = text;
    }
    return headers;
}

export function parseBlockResources(raw: unknown): BlockableResource[] {
    if (!Array.isArray(raw)) return [];
    const out = new Set<BlockableResource>();
    for (const entry of raw) {
        if (typeof entry !== 'string') continue;
        const key = entry.trim().toLowerCase() as BlockableResource;
        if (BLOCKABLE_RESOURCES.includes(key)) out.add(key);
    }
    return [...out];
}

export function normalizeUrl(raw: string): string | null {
    let value = raw.trim();
    if (!value) return null;
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    try {
        const parsed = new URL(value);
        if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

/** Builds a key-value-store key such as `screenshot-003-example-com.png`. */
export function recordKey(prefix: string, index: number, url: string, ext: string): string {
    const host = (() => {
        try {
            return new URL(url).hostname;
        } catch {
            return 'page';
        }
    })();
    const slug = host
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 60);
    return `${prefix}-${String(index).padStart(3, '0')}-${slug || 'page'}.${ext}`;
}

export type ErrorType = 'invalid-url' | 'dns' | 'timeout' | 'blocked' | 'http-error' | 'network' | 'other';

export function categorizeError(message: string, statusCode?: number): ErrorType {
    const m = message.toLowerCase();
    if (statusCode === 403 || statusCode === 429 || m.includes('blocked') || m.includes('captcha')) return 'blocked';
    if (statusCode && statusCode >= 400) return 'http-error';
    if (m.includes('err_name_not_resolved') || m.includes('enotfound') || m.includes('getaddrinfo')) return 'dns';
    if (m.includes('timeout') || m.includes('timed out')) return 'timeout';
    if (m.includes('err_connection') || m.includes('err_ssl') || m.includes('err_cert') || m.includes('net::') || m.includes('econnre'))
        return 'network';
    return 'other';
}

/** Selectors for the most common cookie / consent banners. Hidden with CSS, never clicked. */
export const COOKIE_BANNER_SELECTORS = [
    '#onetrust-consent-sdk',
    '#onetrust-banner-sdk',
    '.onetrust-pc-dark-filter',
    '#CybotCookiebotDialog',
    '#CybotCookiebotDialogBodyUnderlay',
    '#usercentrics-root',
    '#usercentrics-cmp-ui',
    '#didomi-host',
    '.didomi-popup-container',
    '.qc-cmp2-container',
    '#qc-cmp2-container',
    '.fc-consent-root',
    '#truste-consent-track',
    '.truste_overlay',
    '.truste_box_overlay',
    '.evidon-banner',
    '.evidon-consent-wrapper',
    '#sp_message_container',
    '[id^="sp_message_container_"]',
    '.sp-message-open',
    '.osano-cm-window',
    '#cookiescript_injected',
    '#cookiescript_injected_wrapper',
    '#cookie-law-info-bar',
    '#cookie-notice',
    '.cookie-notice',
    '.cookie-banner',
    '#cookie-banner',
    '#cookieBanner',
    '.cookieBanner',
    '#cookie-consent',
    '.cookie-consent',
    '#cookieConsent',
    '.cookieConsent',
    '#cookies-banner',
    '.cookies-banner',
    '.cc-window',
    '.cc-banner',
    '.cc-overlay',
    '#gdpr-banner',
    '.gdpr-banner',
    '#gdpr-consent-tool-wrapper',
    '.js-consent-banner',
    '#consent-banner',
    '.consent-banner',
    '#iubenda-cs-banner',
    '.iubenda-cs-container',
    '#axeptio_overlay',
    '#cmpbox',
    '#cmpbox2',
    '.cmp-wrapper',
    '#tarteaucitronRoot',
    '#tarteaucitronAlertBig',
    '#BorlabsCookieBox',
    '#moove_gdpr_cookie_info_bar',
    '#cookie-law-bar',
    '#coiOverlay',
    '#ez-cookie-dialog',
    '#hs-eu-cookie-confirmation',
    '.hs-cookie-notification-position-bottom',
    '#klaro',
    '.klaro',
    '#pum-overlay[data-popmake*="cookie"]',
    '.pea_cook_wrapper',
    '#adroll_consent_container',
    '.adroll_consent_container',
    '#ketch-banner',
    '#transcend-consent-manager',
    '[aria-label="cookieconsent"]',
    '[role="dialog"][aria-label*="cookie" i]',
    '[role="dialog"][aria-label*="consent" i]',
];
