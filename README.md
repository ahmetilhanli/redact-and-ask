# Redact & Ask

Ask an AI about a document without sending the personal data in it to the cloud.

Redact & Ask finds names, addresses, phone numbers, IBANs, card numbers and national IDs **on your device**,
replaces them with placeholders such as `[PERSON_1]`, sends only the masked text to the cloud model, and puts
the real values back into the answer on your device. The placeholder map never leaves the browser.

Built for the #BuildHybridAI 2026 hackathon with Firebase AI Logic hybrid inference (Web / Chrome).

**Live demo:** https://redact-and-ask.web.app (Chrome on desktop with the on-device model available)

## How the hybrid split works

| Step | Where it runs | Why |
|---|---|---|
| Detect personal data | On-device only (Gemini Nano through Firebase AI Logic, `ONLY_ON_DEVICE`) plus deterministic rules | Raw text must not leave the device |
| Review and correct the mask | In the browser | The user sees exactly what will be sent |
| Short tasks (summary, action items) | `PREFER_ON_DEVICE`, cloud fallback | Fast and offline when possible |
| Long or reasoning tasks (reply, translation) | `ONLY_IN_CLOUD` | Needs the larger model; receives masked text only |
| Fill the real values back in | In the browser | The cloud never learns them |

Deterministic rules (`app/js/rules.js`) validate what they find: IBAN (mod 97), card numbers (Luhn), Turkish
national ID check digits. Model findings are kept only if the value really occurs in the document.

## Answer check

Before anything is filled back in, the device checks the answer (`checkAnswer` in `app/js/mask.js`):
- how many placeholders were filled back in;
- any placeholder the model invented, with the one it most likely meant (same number, shortened or misspelt type,
  e.g. `[IB_1]` → `[IBAN_1]`); it is applied only when the user clicks;
- how many of the real values appear in the answer. The cloud never received them, so any hit is a leak or a guess.

## Other Firebase products

- **App Check** (reCAPTCHA Enterprise) on the hosted site.
- **Remote Config** sets the routing: `heavy_task_min_chars` (masked text longer than this goes to the cloud model;
  2500) and `cloud_tasks_enabled` (`false` keeps every task on the device: heavy tasks are refused, short ones run on
  Gemini Nano). The page shows which values are in effect. Template: `remoteconfig.template.json`.
- **Authentication (anonymous) + Cloud Firestore (eur3): masked history.** An entry holds the task, where it ran, the
  masked text, the answer with placeholders and a value count, never the real values. `firestore.rules` allows only
  those fields and only for the owner. The placeholder map is never stored: after a reload the values cannot be filled
  back in without the original document, not even by this app's backend.

## Many documents

The "Many documents" section takes one document per line (.txt or .csv, first field) or generates 500 fictional
support tickets in the browser. Each line is scanned on the device, one after the other, with one shared
placeholder map, so the same customer gets the same placeholder in every ticket. A counter shows the requests the
page makes while the batch runs, measured by the browser's Resource Timing API. Afterwards the masked lines can be
downloaded, or sent to the cloud in one request to group the tickets by problem; the real values are filled back in
locally.

The batch runs in two passes. The rules pass masks every IBAN, card, e-mail, phone and ID in all documents first,
so the lines are safe at once; the on-device model then checks each document for names and addresses. Only lines
the model has checked can be downloaded or sent, so stopping early never exposes a name.

The sample tickets come from a seeded generator, so the values in each ticket are known. After a run on the sample,
the page checks every masked line against them and shows how many names, addresses and contact values were masked,
and which tickets still hold one.

Measured on 15 Nov 2026 (one MacBook, Chrome 155, the 500 fictional tickets):

| | Result |
|---|---|
| Rules pass, in the browser | 237 values in 500 tickets in 5.0 ms (in Node: 5,000 tickets in 30 ms) |
| Model pass (Gemini Nano through Firebase AI Logic) | 500 tickets in 492 s, 0.98 s each |
| Model pass again on 16 Nov, same machine | 500 tickets in 287 s, 0.57 s each; rules pass 8.2 ms |
| Live site, 17 Nov, same machine | 500 tickets in 368 s, 0.74 s each; rules pass 4.3 ms; checked against the generator's values: names 498 of 500, addresses 119 of 120, e-mails/phones/IBANs 385 of 385 (misses listed on screen: tickets 1053 and 1247); 0 requests during the batch |
| Names / addresses / e-mails, IBANs, phones | 499 of 500 / 120 of 120 / all |
| Over-masking | 3 lines had a non-personal word masked as an organisation |
| Requests made by the page during the batch | 0 (Resource Timing). A browser-level capture also saw 2 requests, both from a Chrome extension, none from the page |
| Cloud grouping of the 500 masked lines | 1.9 s, 8 groups, matching the 8 problems in the generator |
| Live site, 22 Nov, same machine (film take) | Rules pass 237 values in 7.5 ms; model pass 294 s, 0.59 s each, 596 distinct values; names 498 of 500, addresses 120 of 120, e-mails/phones/IBANs 385 of 385 (misses listed: tickets 1111 and 1332, which then went to the cloud with the grouping request); 0 requests during the batch; grouping: 8 groups, about 2 s |

What did not work: asking the cloud model to count the tickets per group (its counts added up to 378 for 500,
so the app no longer asks for counts), and sending several tickets to Gemini Nano in one prompt (about twice as
fast, but the output format broke and addresses were missed).

## What left this device

A card at the bottom of the page shows the page's own traffic: how many requests it made after loading and where
they went (the browser's Resource Timing), and for every request to the cloud model, the exact text that was sent,
with placeholders highlighted. A thin `fetch` wrapper reads the request body and never blocks or changes it; the log
stays in the page. On 16 Nov 2026, after a warm scan the card read 0 requests; after "Draft a reply" it showed one
request to `firebasevertexai.googleapis.com` carrying placeholders only.

Each host is listed with what it is for and what the app hands it: the cloud model and the masked history get masked
text only; App Check, reCAPTCHA, Remote Config, the installation ID and anonymous sign-in get no document text. A host
that is not on that list shows as unexpected.

## Run it locally

Requirements: Chrome 139 or newer on desktop with the on-device model available
(`chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled).

```
cd app
python3 -m http.server 8765 --bind 127.0.0.1
# open http://127.0.0.1:8765/
```

Without a Firebase configuration the app runs in local-only mode: masking works, cloud tasks are disabled.
To enable cloud tasks, create a Firebase project, enable Firebase AI Logic (Gemini Developer API) and App Check,
then put the web config into `app/js/firebase-config.js`.

## Tests

```
node --test tests/core.test.mjs
```

The tests (14) cover the validators, the masking and re-identification logic, the model-output parser, the answer
check and the batch score. They use no model and no network.

## Status and limits

- Tested on one machine (Chrome 155, macOS): the sample letter is scanned in about 2 seconds on-device once the model is loaded. When Chrome had unloaded the idle model, a scan took 15 to 28 seconds while it loaded again; the app now warms the model on the first click or key press. That helps only when the user does something before scanning: on 15 Nov a scan clicked as the very first action still took 19.4 seconds.
- **Browsers without the on-device model (fixed 15 Nov 2026).** Firebase AI Logic creates its on-device adapter only when the browser has the `LanguageModel` API; without it, a model set to `ONLY_ON_DEVICE` sent the request to the cloud (Firebase JS SDK 13.3.0). A test with the API hidden showed the raw sample letter reaching `generateContent`. The app now checks for the API itself and, when it is missing, runs the rules only and says so. Reported upstream with a fix: firebase/firebase-js-sdk issue #10635, PR #10636. Retested: no network request during the scan; IBAN, e-mail, phone and postcode masked; names and addresses left for the user to add.
- **Browsers without the on-device model: no cloud task until the text is checked (fixed 17 Nov 2026).** A live test with the `LanguageModel` API hidden showed that after a rules-only scan, "Draft a reply" still sent names, a date of birth and an address to the cloud. The cloud tasks now stay off after a rules-only scan until the user ticks that they have read the text and masked every name and address. Retested on the live site: 0 requests until the box is ticked.
- With `fetch` blocked in the page, the privacy scan still completed and made no network request. Loading the page itself needs a connection (no service worker yet).
- Network during the scan, measured 16 Nov 2026 with Playwright request events: when an earlier click had warmed the model, the scan made no network request. When the scan was the very first click on a fresh page, Firebase and App Check started during that scan and 7 GET requests loaded the reCAPTCHA Enterprise scripts; none carried document text. That cold scan took 8.4 seconds.
- A short task (Summarise) in `PREFER_ON_DEVICE` mode answered in about 2 seconds with no network request, so it ran on the device.
- The full loop ran end to end on 14 Nov 2026: on-device detection through Firebase AI Logic (about 2 s), a reply drafted in the cloud from masked text only, and the real values filled back in locally.
- On a 5-document fictional test set, all 24 expected personal values were masked and the document without personal data was left untouched. This is a small set, not a benchmark.
- App Check (reCAPTCHA Enterprise) is active on the hosted demo and returns a verified token. Enforcement is not switched on yet.
- The on-device model can miss personal data. The review step exists so the user can add what was missed.
  This is a helper, not a compliance guarantee.
- All sample documents are fictional.
- This project was built with AI coding assistance.

## License

Apache-2.0. See `LICENSE`.
