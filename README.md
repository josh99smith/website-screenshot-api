Turn any URL into a **full-page screenshot or PDF** with one API call. Paste a list of websites, pick a device (desktop, laptop, tablet, mobile or custom viewport), choose PNG or JPEG, and get back image files plus a structured record for each page. Cookie banners are hidden automatically, lazy-loaded images are scrolled into view, and pages that fail to load are reported **free of charge**.

It runs in a real headless Chromium browser on Apify's infrastructure, so there is nothing to install and no browser fleet to maintain, and it can be scheduled, called from code, or wired into Zapier, Make, n8n and the Apify MCP server for AI agents.

## What can you use Website Screenshot API for?

- **Visual monitoring**: schedule daily captures of your landing pages, pricing pages or competitors and keep a visual history.
- **Link previews and thumbnails** for directories, newsletters, bookmarking tools and CMS cards.
- **Design and QA reviews**: capture the same pages on laptop, tablet and mobile in one run, in light and dark mode.
- **Compliance and evidence**: archive how a page looked on a given date, as an image and as a PDF.
- **Reports**: convert dashboards or articles into PDFs (A4, Letter or Legal) for sharing.
- **AI agents**: give an agent eyes on the web through the Apify MCP server.

## How it works

Each URL is opened in headless Chromium with the viewport, pixel density and user agent of the chosen device. The Actor waits for the page to load (and, by default, for the network to go idle for a more complete render), scrolls to the bottom so lazy-loaded content appears, hides the most common consent pop-ups with CSS (nothing is clicked or accepted on your behalf), waits an optional extra delay, and captures the image. Files are saved to the run's key-value store and the dataset record links to them.

## How to use it

1. Paste your URLs into **Website URLs**, one per line.
2. Pick a **Device preset**, **Image format** and whether you want the **Full page** or only the first screen.
3. Optionally enable **Also render a PDF**, **Dark mode**, or add **Hide elements** selectors (chat widgets, newsletter pop-ups).
4. Click **Start**. Each finished page appears in the **Output** tab with a preview; the files are in the **Storage** tab (or via API).

```json
{
    "urls": ["https://apify.com", "https://www.wikipedia.org"],
    "device": "laptop",
    "format": "jpeg",
    "quality": 80,
    "fullPage": true,
    "hideCookieBanners": true,
    "renderPdf": false
}
```

From code, start the Actor with the API and read the `screenshotUrl` of each dataset item, which is a direct link to the image in the key-value store.

## Output

```json
{
    "url": "https://www.wikipedia.org",
    "finalUrl": "https://www.wikipedia.org/",
    "success": true,
    "statusCode": 200,
    "title": "Wikipedia",
    "screenshotUrl": "https://api.apify.com/v2/key-value-stores/AbCdEf123/records/screenshot-002-www-wikipedia-org.jpg",
    "screenshotKey": "screenshot-002-www-wikipedia-org.jpg",
    "format": "jpeg",
    "width": 1366,
    "height": 1101,
    "fullPage": true,
    "device": "laptop",
    "sizeBytes": 172806,
    "pdfUrl": "https://api.apify.com/v2/key-value-stores/AbCdEf123/records/pdf-002-www-wikipedia-org.pdf",
    "renderTimeMs": 1139,
    "fetchedAt": "2026-09-18T20:41:07.000Z"
}
```

Pages that could not be captured are still listed, so nothing goes missing from your batch:

```json
{ "url": "https://this-domain-does-not-exist.example", "success": false, "errorType": "dns", "error": "page.goto: net::ERR_NAME_NOT_RESOLVED ...", "fetchedAt": "..." }
```

| Field | Description |
| --- | --- |
| `screenshotUrl` / `screenshotKey` | Direct link to the image and its key in the key-value store. |
| `pdfUrl` / `pdfKey` | Present when **Also render a PDF** is on. |
| `width` / `height` | Pixel dimensions of the captured image (height is the full page height when `fullPage` is on). |
| `statusCode` | HTTP status of the page. Error pages (404, 500) are still captured so you can see them. |
| `title` | The page title. |
| `errorType` | For failures: `invalid-url`, `dns`, `timeout`, `blocked`, `http-error`, `network` or `other`. |

## Pricing: how much does it cost to screenshot a website?

You pay a **flat price per captured screenshot** and, if enabled, a flat price per **PDF**; both are shown next to the Start button. Pages that fail to load cost nothing, and there is no per-run start fee. Set a maximum cost per run and the Actor stops cleanly when it is reached.

For comparison, screenshot SaaS products typically charge a monthly subscription for a fixed quota; here you only pay for the pages you actually capture.

## Tips

- **Speed vs completeness**: `networkidle` gives the best render on sites with lazy content; switch to `load` or `domcontentloaded` for large batches of simple pages.
- **Above-the-fold only**: turn off **Full page** for thumbnails and previews. Combine with `device: "mobile"` for app-store style captures.
- **Cleaner captures**: add selectors for chat bubbles, promo bars or "download our app" overlays to **Hide elements**.
- **A single element**: use **Capture only this element** with a selector like `#pricing` to crop precisely.
- **Blocked or geo-restricted sites**: enable Apify Proxy (residential groups are available) in **Proxy configuration**.
- **Memory**: each concurrent tab needs roughly 200 to 400 MB. If you raise concurrency, raise the run memory too.

## FAQ

**Are cookie banners accepted or dismissed?**
No. They are hidden visually with CSS so the capture is clean. No consent choice is made on the visited site.

**Why is the page dark / light?**
The Actor requests a light colour scheme unless **Dark mode** is on. Sites that ship a dark design (like Apify's) will still render dark.

**Can it log in or click through pop-ups?**
Not in this version. It captures publicly reachable pages as an anonymous visitor.

**Is this legal?**
The Actor loads public web pages in a browser, like a visitor would, at low request rates. You are responsible for how you use the captured images and for respecting the target sites' terms and copyright.

## Support

Report problems or request features in the **Issues** tab. Feature requests such as custom headers, cookies, or scripted interactions are welcome.
