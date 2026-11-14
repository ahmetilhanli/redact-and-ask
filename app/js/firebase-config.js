// Firebase web configuration for the "redact-and-ask" project. This is the public web config that every Firebase
// web app ships in its client code; access is protected by App Check and security rules, not by hiding it.
// Set to null to run in "local only" mode: on-device masking works, cloud tasks are disabled.
export const firebaseConfig = {
  apiKey: "AIzaSyDShMtTImk_ueGZYRTJkZyNHSv8hVzwUo0",
  authDomain: "redact-and-ask.firebaseapp.com",
  projectId: "redact-and-ask",
  storageBucket: "redact-and-ask.firebasestorage.app",
  messagingSenderId: "713741431047",
  appId: "1:713741431047:web:4833704e0bad672e9b55a2",
};
// reCAPTCHA Enterprise site key for App Check (production). In development a debug token is used instead.
// Public site key (it is embedded in every page that uses reCAPTCHA). Allowed domain: redact-and-ask.web.app.
export const appCheckSiteKey = "6Ld8mh8uAAAAAKx0bsBP1-fYonSYtFmJg2QUnbwW";
