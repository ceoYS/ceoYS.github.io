# wethru-interior-lead

Serverless endpoint behind the qualification form on
https://ceoys.github.io/wethru/interior/ (`#apply`). It validates the
submission, scores it internally and emails it to WeThru through Resend.

GitHub Pages is static, so the email provider key can never live in the page.
It lives only in this Vercel project's environment.

- Vercel project: `ceoys-projects/wethru-interior-lead`
- Production URL: `https://wethru-interior-lead.vercel.app/api/lead`
- Frontend config: `wethru/interior/index.html` → `<form id="lead" data-endpoint="…">`
- Frontend logic: `wethru/interior/assets/lead-form.js`

## Status / TODO before leads arrive by email

| Item | State | Who |
| --- | --- | --- |
| Endpoint deployed | done | — |
| `SUBMISSION_NOTIFICATION_EMAIL` = `ceo@nitual.com` (public operator email on wethru.com) | set (production) | — |
| `EMAIL_FROM` = `WeThru Interior <interior@auth.nitual.com>` | set (production) | confirm sender is acceptable |
| `EMAIL_PROVIDER_API_KEY` (Resend) | **not set** — endpoint answers `503 not_configured` | **operator** |
| Privacy retention period in the consent notice | **not decided** — shown as "운영자 확정 필요" | **operator** |

Until the key is set, the form still works for visitors: on any delivery
failure it keeps their answers and offers "다시 보내기", a prefilled email to
`ceo@nitual.com`, "내용 복사" and the Kakao channel.

### 1. Add the Resend key (one time)

`auth.nitual.com` is already verified in WeThru's Resend account (see the
Google-Biz intake app's `docs/SUPABASE_SETUP.md`). A Resend key with
*sending access* only is enough.

```bash
cd services/interior-lead
vercel env add EMAIL_PROVIDER_API_KEY production   # paste the key when prompted; never commit it
vercel deploy --prod
```

The env names match the existing `wethru-google-biz-production` project, so
the same key can be reused if that is preferred.

### 2. Verify

```bash
curl -s -X POST https://wethru-interior-lead.vercel.app/api/lead \
  -H 'Origin: https://ceoys.github.io' -H 'Content-Type: application/json' \
  -d '{"company":"[TEST] 배포 확인","region":"부산","phone":"010-0000-0000","email":"ceo@nitual.com","field":"residential","channels":["instagram"],"painPoint":"noTime","budget":"100to150","startTiming":"asap","intent":"now","consentPrivacy":true,"elapsedMs":30000,"website":""}'
# expect {"ok":true} and an email titled "[WeThru Interior] 신규 상담 — [TEST] 배포 확인"
```

### 3. Privacy notice

Replace the `<span class="tbd" data-operator-setting="retention">` in
`wethru/interior/index.html` with the decided retention period (for example
"상담 종료 후 N개월"). Nothing in the existing WeThru repositories fixes a
period, so it was not invented.

## Contract

`POST /api/lead` with `Content-Type: application/json`, from an allowed
origin (`https://ceoys.github.io`, plus `ALLOWED_ORIGINS`, comma separated).

| Field | Type | Required | Values |
| --- | --- | --- | --- |
| `company`, `region` | string | yes | ≤ 60 chars |
| `phone` | string | yes | 9–12 digits after stripping |
| `email` | string | yes | email |
| `owner`, `links` | string | no | ≤ 40 / 300 chars |
| `field` | code | yes | `residential` `commercial` `cafe` `office` `remodeling` `other` |
| `channels` | code[] | yes | `instagram` `blog` `ohouse` `website` `none` `other` |
| `painPoint` | code | yes | `unorganized` `noDifferentiation` `outdatedSite` `noInquiryFlow` `noTime` `other` |
| `projectCount` | code | no | `lt5` `5to10` `10to30` `gt30` |
| `showFirst` | code[] | no | `cases` `brand` `specialty` `design` `consultation` `other` |
| `threeD` | code | no | `no` `interested` `yes` `later` |
| `budget` | code | yes | `lt100` `100to150` `150to300` `gt300` `unknown` |
| `startTiming` | code | yes | `asap` `within2w` `within1m` `1to3m` `exploring` |
| `intent` | code | yes | `now` `conditional` `comparing` `researching` |
| `notes` | string | no | ≤ 1000 chars |
| `consentPrivacy` | boolean | yes | must be `true` |
| `website` | string | — | honeypot, must be empty |
| `elapsedMs` | number | — | time on form; < 3000 is treated as a bot |
| `page`, `referrer` | string | — | context |

Responses: `200 {ok:true}` · `400 {ok:false,error:"invalid",fields:{name:"required"|"invalid"}}`
· `403` origin · `413` too large · `415` not JSON · `429` rate limited ·
`502` provider failed · `503 not_configured`.

Honeypot or too-fast submissions get `200 {ok:true}` and nothing is sent.

## Lead scoring (internal only, never shown to the visitor)

Points: budget (`lt100` 0 · `100to150` 2 · `150to300`/`gt300` 3 · `unknown` 1)
+ timing (`asap`/`within2w` 3 · `within1m` 2 · `1to3m` 1 · `exploring` 0)
+ intent (`now` 3 · `conditional` 2 · `comparing` 1 · `researching` 0), max 9.

- **HIGH** — budget ≥ 100만원 and start within 1 month and intent `now`/`conditional`
- **LOW** — budget < 100만원 and intent `researching`
- **MEDIUM** — everything else

The tier and score appear at the top of the email and as a Resend tag.
Every valid submission is delivered regardless of tier.

## Spam and abuse

Origin allowlist, JSON-only, 20 KB body cap, honeypot field, minimum fill
time, field length caps, enum validation, and a per-IP limit of 5 requests
per 10 minutes (best effort: kept in memory per warm instance). If spam
becomes a problem, add Cloudflare Turnstile or a shared rate limiter.

## Tests

```bash
npm test   # node:test, no dependencies
```
