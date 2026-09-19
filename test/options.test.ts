import { describe, expect, it } from 'vitest';

import {
    categorizeError,
    COOKIE_BANNER_SELECTORS,
    DEVICE_PRESETS,
    normalizeUrl,
    parseBlockResources,
    parseCookies,
    parseHeaders,
    parseSettings,
    recordKey,
} from '../src/options.js';

describe('parseSettings', () => {
    it('applies laptop defaults for an empty input', () => {
        const s = parseSettings({});
        expect(s.device).toBe('laptop');
        expect(s.viewport).toEqual(DEVICE_PRESETS.laptop.viewport);
        expect(s.format).toBe('png');
        expect(s.quality).toBeUndefined();
        expect(s.fullPage).toBe(true);
        expect(s.waitUntil).toBe('networkidle');
        expect(s.hideCookieBanners).toBe(true);
        expect(s.renderPdf).toBe(false);
        expect(s.maxConcurrency).toBe(5);
        expect(s.unstickFixed).toBe(true);
        expect(s.waitForSelector).toBeUndefined();
        expect(s.cookies).toEqual([]);
        expect(s.extraHeaders).toEqual({});
        expect(s.blockResources).toEqual([]);
    });

    it('parses the wait / unstick / block options', () => {
        const s = parseSettings({
            unstickFixed: false,
            waitForSelector: '  .loaded  ',
            blockResources: ['image', 'font', 'image', 'bogus', 'SCRIPT'] as never,
            cookies: [{ name: 'a', value: '1', domain: '.example.com' }],
            extraHeaders: { 'Accept-Language': 'de-DE' },
        });
        expect(s.unstickFixed).toBe(false);
        expect(s.waitForSelector).toBe('.loaded');
        expect(s.blockResources).toEqual(['image', 'font', 'script']);
        expect(s.cookies).toEqual([{ name: 'a', value: '1', domain: '.example.com', path: '/' }]);
        expect(s.extraHeaders).toEqual({ 'Accept-Language': 'de-DE' });
    });

    it('treats a blank waitForSelector as unset', () => {
        expect(parseSettings({ waitForSelector: '   ' }).waitForSelector).toBeUndefined();
        expect(parseSettings({ waitForSelector: 42 as never }).waitForSelector).toBeUndefined();
    });

    it('uses the mobile preset with its user agent and scale factor', () => {
        const s = parseSettings({ device: 'mobile' });
        expect(s.viewport.width).toBe(390);
        expect(s.deviceScaleFactor).toBe(3);
        expect(s.isMobile).toBe(true);
        expect(s.userAgent).toContain('iPhone');
    });

    it('honours custom viewport values and clamps them', () => {
        const s = parseSettings({ device: 'custom', viewportWidth: 10, viewportHeight: 99999, deviceScaleFactor: 9 });
        expect(s.device).toBe('custom');
        expect(s.viewport).toEqual({ width: 320, height: 2160 });
        expect(s.deviceScaleFactor).toBe(3);
    });

    it('falls back to laptop for an unknown device', () => {
        expect(parseSettings({ device: 'tv' as never }).device).toBe('laptop');
    });

    it('applies quality only for jpeg', () => {
        expect(parseSettings({ format: 'jpeg', quality: 55 }).quality).toBe(55);
        expect(parseSettings({ format: 'jpeg', quality: 500 }).quality).toBe(100);
        expect(parseSettings({ format: 'png', quality: 55 }).quality).toBeUndefined();
    });

    it('trims custom selectors and ignores blanks', () => {
        const s = parseSettings({ hideSelectors: [' .a ', '', '#b'], clipSelector: '  ' });
        expect(s.hideSelectors).toEqual(['.a', '#b']);
        expect(s.clipSelector).toBeUndefined();
    });
});

describe('parseCookies', () => {
    it('keeps well-formed cookies and defaults the path for domain cookies', () => {
        const cookies = parseCookies([
            { name: 'sid', value: 'abc', domain: 'example.com' },
            { name: 'consent', value: 1, domain: '.example.com', path: '/shop', secure: true, httpOnly: false, sameSite: 'Lax', expires: 1900000000 },
            { name: 'u', value: 'x', url: 'https://example.com/app' },
        ]);
        expect(cookies).toEqual([
            { name: 'sid', value: 'abc', domain: 'example.com', path: '/' },
            { name: 'consent', value: '1', domain: '.example.com', path: '/shop', secure: true, httpOnly: false, sameSite: 'Lax', expires: 1900000000 },
            { name: 'u', value: 'x', url: 'https://example.com/app' },
        ]);
    });

    it('drops cookies without a name, value or scope and non-object entries', () => {
        expect(
            parseCookies([
                { value: 'x', domain: 'a.com' },
                { name: 'n', domain: 'a.com' },
                { name: 'n', value: 'v' },
                { name: 'n', value: 'v', sameSite: 'weird', domain: 'a.com' },
                'garbage',
                null,
            ]),
        ).toEqual([{ name: 'n', value: 'v', domain: 'a.com', path: '/' }]);
        expect(parseCookies(undefined)).toEqual([]);
        expect(parseCookies({ name: 'n' })).toEqual([]);
    });
});

describe('parseHeaders', () => {
    it('keeps string, number and boolean values with valid header names', () => {
        expect(parseHeaders({ Authorization: 'Bearer t', 'X-Count': 3, 'X-Flag': true, ' X-Trim ': 'v' })).toEqual({
            Authorization: 'Bearer t',
            'X-Count': '3',
            'X-Flag': 'true',
            'X-Trim': 'v',
        });
    });

    it('drops blank, nested and invalid-name headers', () => {
        expect(parseHeaders({ 'Bad Name': 'v', 'X-Empty': '', 'X-Obj': { a: 1 }, 'X-Null': null })).toEqual({});
        expect(parseHeaders(undefined)).toEqual({});
        expect(parseHeaders(['a'])).toEqual({});
        expect(parseHeaders('Authorization: x')).toEqual({});
    });
});

describe('parseBlockResources', () => {
    it('normalises, de-duplicates and filters unknown types', () => {
        expect(parseBlockResources(['image', ' Media ', 'image', 'xhr', 'html', 5])).toEqual(['image', 'media', 'xhr']);
        expect(parseBlockResources('image')).toEqual([]);
        expect(parseBlockResources(undefined)).toEqual([]);
    });
});

describe('normalizeUrl', () => {
    it('adds https and validates hosts', () => {
        expect(normalizeUrl('example.com/path')).toBe('https://example.com/path');
        expect(normalizeUrl('http://example.com')).toBe('http://example.com/');
        expect(normalizeUrl('bad url')).toBeNull();
        expect(normalizeUrl('')).toBeNull();
        expect(normalizeUrl('localhost:3000')).toBe('https://localhost:3000/');
    });
});

describe('recordKey', () => {
    it('builds safe, ordered keys', () => {
        expect(recordKey('screenshot', 3, 'https://www.Example.com/x?y=1', 'png')).toBe('screenshot-003-www-example-com.png');
        expect(recordKey('pdf', 12, 'not a url', 'pdf')).toBe('pdf-012-page.pdf');
    });
});

describe('categorizeError', () => {
    it('maps Chromium network errors', () => {
        expect(categorizeError('page.goto: net::ERR_NAME_NOT_RESOLVED at https://x')).toBe('dns');
        expect(categorizeError('page.goto: Timeout 60000ms exceeded.')).toBe('timeout');
        expect(categorizeError('page.goto: net::ERR_CONNECTION_REFUSED')).toBe('network');
        expect(categorizeError('Request blocked - received 403 status code.', 403)).toBe('blocked');
        expect(categorizeError('whatever', 500)).toBe('http-error');
        expect(categorizeError('Element not found for clipSelector')).toBe('other');
    });
});

describe('COOKIE_BANNER_SELECTORS', () => {
    it('are all syntactically plausible CSS selectors', () => {
        expect(COOKIE_BANNER_SELECTORS.length).toBeGreaterThan(50);
        for (const sel of COOKIE_BANNER_SELECTORS) {
            expect(sel.trim()).toBe(sel);
            expect(sel).not.toContain(',');
        }
    });
});
