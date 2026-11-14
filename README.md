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

The tests cover the validators, the masking and re-identification logic and the model-output parser. They use
no model and no network.

## Status and limits

- Tested on one machine (Chrome 155, macOS): the sample letter is scanned in about 2 seconds on-device.
- The full loop ran end to end on 14 Nov 2026: on-device detection through Firebase AI Logic (about 2 s), a reply drafted in the cloud from masked text only, and the real values filled back in locally.
- On a 5-document fictional test set, all 24 expected personal values were masked and the document without personal data was left untouched. This is a small set, not a benchmark.
- App Check (reCAPTCHA Enterprise) is active on the hosted demo and returns a verified token. Enforcement is not switched on yet.
- The on-device model can miss personal data. The review step exists so the user can add what was missed.
  This is a helper, not a compliance guarantee.
- All sample documents are fictional.
- This project was built with AI coding assistance.

## License

Apache-2.0. See `LICENSE`.
