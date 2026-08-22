# Production Access Diagnosis

## 2026-08-20

The local dashboard preview renders the confirmed public, read-only fifteen-role shortlist without a login or owner-access gate. The public deployment at `https://shayanjobdas-m9vovfma.manus.space` still renders the older **Your private job workspace** sign-in screen, including after a cache-busting URL and hard reload.

The production log command subsequently returned `cloudrun service not found`, indicating that the live runtime was not available for log inspection after the public-access checkpoint. The next recovery step is to re-establish the hosted runtime and then verify that the deployed domain serves the checkpoint containing the public access changes.

After a recovery publish checkpoint, the domain still served the same older `index-COc-PmnL.js` authenticated bundle and retained the sign-in screen, including with cache-busting query parameters and a hard reload. The source and local preview remain public, so this is a hosted-release propagation or runtime-provisioning failure rather than an application-code issue.
