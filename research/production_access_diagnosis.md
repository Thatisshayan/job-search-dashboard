# Production Access Diagnosis

## 2026-08-20

The local dashboard preview renders the confirmed public, read-only fifteen-role shortlist without a login or owner-access gate. The public deployment at `https://shayanjobdas-m9vovfma.manus.space` still renders the older **Your private job workspace** sign-in screen, including after a cache-busting URL and hard reload.

The production log command subsequently returned `cloudrun service not found`, indicating that the live runtime was not available for log inspection after the public-access checkpoint. The next recovery step is to re-establish the hosted runtime and then verify that the deployed domain serves the checkpoint containing the public access changes.

After a recovery publish checkpoint, the domain still served the same older `index-COc-PmnL.js` authenticated bundle and retained the sign-in screen, including with cache-busting query parameters and a hard reload. The source and local preview remain public, so this is a hosted-release propagation or runtime-provisioning failure rather than an application-code issue.

## 2026-08-22 recovery

The production domain eventually served the public dashboard bundle successfully at release `d4ded358`; it opens without authentication and shows the public navigation shell. The page has no browser-console errors. Its Today view currently reflects the current Toronto date, which has no imported live run yet; the historical verified roles remain tied to their original import date and need a fresh source run to populate today’s queue.

## 2026-08-22 verified public readiness

Release `737f5001` successfully initialized the hosted public workspace and rendered today’s full shortlist. The deployed page shows 15 full-time Toronto/GTA construction roles, scorecards, source attribution, and direct official Job Bank application links without requiring authentication. The initial cards displayed include Atlas JF Contracting (98), Landmark Properties (92), Plan Group (92), FORYOU Real Estate (88), Civicon (88), magnum millwork (88), and Ark Group (86). Public application-tracking and Telegram-initiation controls remain intentionally hidden in the public UI.
