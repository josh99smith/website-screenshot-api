# Changelog

## 0.2.2 (2026-09-23)

- Listing: joined the Best Damn series. New title "Best Damn Website Screenshot API", new description, icon and README banner. No change to inputs, output or pricing.

## 0.2.1 (2026-09-20)

- Duplicate input URLs are now deduplicated by the Actor instead of being rejected by input validation, as the field description already promised.

## 0.2.0 (2026-09-18)

- Colour emoji and CJK fonts (Noto Color Emoji, Noto CJK) in the Docker image, so emoji and Chinese / Japanese / Korean text no longer render as boxes.
- New `unstickFixed` option (default on): fixed and sticky headers, bars and chat bubbles are pinned once in full-page captures; bottom-anchored bars move to the end of the page.
- New `waitForSelector` option; when the element never appears the page is still captured and the record carries `warnings: ["waitForSelector timed out"]`.
- New `cookies` and `extraHeaders` options for logged-in or consent-preset captures (never logged; headers are sent only to the page's own site).
- New `blockResources` option to abort images, media, fonts, stylesheets, scripts or XHR/fetch requests.
- `warnings` field on success records.
- Fixed: auto-scroll now returns to the top instantly, so pages with `scroll-behavior: smooth` (e.g. github.com) no longer capture mid-scroll with a blank band.

## 0.1.0 (2026-09-18)

- Initial release: full-page / viewport screenshots (PNG, JPEG), device presets, custom viewport, dark mode, cookie-banner hiding, element clipping, auto-scroll for lazy content, optional PDF rendering.
- Failed pages are reported as free dataset records; charged only per captured screenshot / PDF.
