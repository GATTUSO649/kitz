# Payment Monitoring Architecture

Operations calls only the Kitz API. For MarketHub, Kitz makes a server-to-server GET to the fixed configured `MARKETHUB_SECURITY_FEED_URL`, authenticated by the existing shared service token. The URL must use the same origin as `MARKETHUB_PUBLIC_URL`, an exact fixed path, and HTTPS in production. The browser never connects to MarketHub's database or receives its service token.

MarketHub reads only its `marketplace.marketplace_payments` and callback rows, scopes records to `application_id = MARKETHUB`, masks payer phones, omits callback payloads/access-token hashes, and writes an inspection audit entry. Kitz independently records the central Operations actor and query outcome. The response is schema-validated and `no-store`.

The Operations UI has an application selector, status/search filters, provider references, amount/currency, timestamps, callback status, verification outcome, and reconciliation status. It offers no settlement or status mutation action.

Configuration does not imply connectivity. No MarketHub endpoint/credential value was inspected or used, and no DB-backed feed call was performed. Enable the feed only after both app environments, same-origin URL, token rotation/ownership, schema readiness, and integration tests are verified. Kitz callback status remains explicitly “not recorded” with the current Kitz payment schema.