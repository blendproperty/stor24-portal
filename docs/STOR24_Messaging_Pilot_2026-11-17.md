# STOR24 messaging pilot — ready for an owner-led test window

Prepared 17 November 2026, SAST. Scope: STOR24 WhatsApp, Facebook Messenger and Instagram only. Use owner-controlled sending accounts and an approved test phone number entered privately. Use the already provisioned Midpoint CRM connections and the existing approved staff notification route. Do not rotate keys, turn on Twilio customer automation, change an unrelated bot or send a broadcast.

| Order | Entry point | QA name | Leave behind |
| --- | --- | --- | --- |
| 1 | Existing WhatChimp WhatsApp trigger: `enquiry` | STOR24 QA WA 17NOV | Existing production configuration unchanged |
| 2 | STOR24 Messenger CRM draft; temporary exact-match keyword `stor24qa17novfb` | STOR24 QA FB 17NOV | Draft, original channel assignment, no pilot keyword |
| 3 | STOR24 Instagram CRM draft; temporary exact-match keyword `stor24qa17novig` | STOR24 QA IG 17NOV | Draft, original channel assignment, no pilot keyword |

The keywords are proposed for this window; check both are unused before setting either. Use a future date acceptable to the flow and a short clearly labelled QA requirement. No real booking, payment, access or lease action is part of the test.

1. Open [WhatChimp Automation](https://dashboard.whatchimp.com/bots), [CRM Integrations](https://portal.stor24.co.za/integrations), and [Lead to lease](https://portal.stor24.co.za/leads) together. Record baseline bot state and channel assignment. Have the staff recipient ready to verify inbox receipt, without sharing credentials. Before either social pilot, inspect Meta Inbox's instant/away and keyword replies and WhatChimp's channel default for overlap. The earlier duplicate reply is an observed symptom; the source is unconfirmed. If one-reply routing cannot be isolated without changing live customer behavior, stop and keep the bot in Draft.
2. Run WhatsApp with the existing trigger. For each social channel in turn, use only its exact-match keyword and only the named draft during the agreed window. Where the social flow requests a phone, try `123` first and expect a re-prompt and no saved lead; then continue with an approved valid test number. Do not fabricate a real customer name or use a random valid phone number.
3. Pass criteria per channel: one expected bot path and confirmation, correct facility and source, one saved labelled lead, expected staff follow-up, and staff inbox confirmation where configured. Verify acknowledgement follows the CRM success result. If provider tooling allows safe replay of the same submission, verify the same lead reference and no extra task/notice; a fresh enquiry with the same name is not the same replay.
4. Stop on unexpected replies, a false success, missed notice, unapproved data or traffic to the restricted flow. Return each social bot to Draft and remove its temporary keyword immediately after its test. Verify that state in WhatChimp before proceeding. Keep manual inbox monitoring. Review and disposition only the labelled test records under normal CRM QA practice; record timestamps/source/lead count/task count/receipt in a redacted evidence note. No public rollout is implied by passing a pilot.

Evidence from preparation: WhatsApp enquiry/welcome/staff bots Active; Messenger and Instagram CRM bots Draft, on their intended channels, with no keyword. Both Midpoint CRM connections Active with no pending or uncertain notices. Unauthenticated WhatChimp requests return 401/no-store. No message, lead, task, notification, pilot keyword or bot change was made during preparation.
