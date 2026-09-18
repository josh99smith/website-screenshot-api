import { describe, expect, it } from 'vitest';

import { categorizeError, COOKIE_BANNER_SELECTORS, DEVICE_PRESETS, normalizeUrl, parseSettings, recordKey } from '../src/options.js';

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
