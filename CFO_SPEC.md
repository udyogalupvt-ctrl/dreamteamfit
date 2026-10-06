# CFO for Gym: Specification (Version 1)

Put this file in the root folder of the gym project. It tells Claude Code what "the CFO" is.

## Goal

Add an AI CFO to the gym software. Its job: keep the gym alive, stop money leaks, and tell the owner what to do this week. The owner is not a finance person, so everything must be in simple language.

## Three rules that must never be broken

1. **Code does the maths. The AI only explains.** Every number is calculated by our own code from the database. The AI model never calculates, estimates, or invents a number.
2. **Only totals go to the AI.** Send counts and amounts (for example "38 members at risk, Rs 1.9 lakh"). Never send names, phone numbers, or any member's personal details to the AI provider.
3. **The AI provider must be switchable.** One interface, three possible providers (Gemini, OpenAI, Claude), chosen by a config value. API keys and model names live in environment variables, never in code.

## Before building: map the existing data

Read the existing database and code first. Find the real table and column names for:

- Members
- Membership plans and each member's plan (start date, end date, price, discount)
- Payments received (amount, date, which plan or PT package it is for)
- Personal training (PT): packages or sessions, the trainer, the fee
- Attendance (member, date)
- Expenses (amount, date, category)
- Staff and trainers (salary, if stored)

Write this mapping into the plan. Reuse existing tables. Do not duplicate data.

## New data to add

| Item | Why |
|---|---|
| Opening cash balance + the date it was entered (one per gym) | Needed for cash balance and runway |
| Expense category, if missing (rent, salary, electricity, marketing, equipment, other) | Needed to say where money goes |
| CFO settings (the thresholds listed in Layer 2, with defaults) | So each gym can adjust the rules |
| Saved weekly briefs (date, numbers used, AI text) | History, and to compare prediction vs result later |

## Layer 1: Numbers (calculated by code)

Use days, not months, when spreading a plan, so 28-day and 31-day months are handled correctly.

| Number | Exact calculation |
|---|---|
| **Earned income (month M)** | For every plan active in M: plan price after discount x (days of the plan that fall in M / total days of the plan). Add PT income the same way if PT is sold as a package over a period; if PT is per session, use sessions done in M x session rate. |
| **Expenses (month M)** | Sum of all expenses dated in M. |
| **Profit or loss (month M)** | Earned income - expenses. |
| **Average monthly expenses** | Average of the last 3 full months. If less than 3 months of data, use what exists and show "based on N months". |
| **Active members** | Members with a plan that covers today. |
| **Average income per member** | Earned income of last full month / active members in that month. |
| **Break-even members** | Average monthly expenses / average income per member, rounded up. |
| **Advance money owed** | For every active plan: the larger of zero and (amount paid so far - plan price x days already used / total days). Add them all up. |
| **Cash balance** | Opening cash balance + all payments received since the opening date - all expenses since the opening date. |
| **Free cash** | Cash balance - advance money owed. |
| **Cash runway (months)** | Cash balance / average monthly expenses. Label it "if no new money comes in". |
| **Renewal rate (month M)** | Of the members whose plan ended in M, the share who started a new plan before the end date or within the grace period after it. |
| **Pending dues** | For every plan where price after discount is more than amount paid: the difference. Group by age: 0 to 7 days, 8 to 30 days, more than 30 days. |
| **Net member growth (month M)** | Members who joined for the first time in M - members whose plan ended in M and did not renew within the grace period. |
| **PT income per trainer (month M)** | PT income from that trainer's clients in M. If trainer salary is stored, show income next to salary. |

Edge cases to handle: division by zero (show "not enough data", never an error or "Infinity"), brand-new gym with no history, frozen or paused memberships (do not count frozen days as used, do not flag as at-risk), partial payments, refunds (subtract from payments), plans with a zero or missing end date, more than one branch (calculate per branch and total, if the software has branches).

## Layer 2: Problems (found by code, using rules)

Thresholds come from CFO settings. Defaults:

| Alert | Rule | Default |
|---|---|---|
| **At-risk member** | Active member with no visit in the last N days, OR visits in the last 14 days are half or less of their visits in the 14 days before that | N = 14 |
| **Renewal coming** | Plan ends within N days. If also at-risk, mark as top priority | N = 30 |
| **New member slipping** | Joined within the last 30 days and visited fewer than N times | N = 4 |
| **PT opportunity** | Visited N or more times in the last 30 days and has never bought PT | N = 12 |
| **Cash warning** | Runway below N months, OR active members below break-even members | N = 2 |
| **Grace period for renewal** | Days after plan end that still count as a renewal | 15 |

Each alert list shows: member name, phone, plan, end date, last visit, and money at stake. Sort by money at stake, highest first. These lists are shown by the app from the database. They are not sent to the AI.

## Layer 3: AI brief

**Provider interface.** One function: it takes the summary object and returns the brief text. Three implementations (Gemini, OpenAI, Claude). Config value picks one. Set a timeout and one retry.

**Input to the AI.** A single JSON object with only: the Layer 1 numbers for this month and last month, the count and total money for each Layer 2 alert, expenses by category, and the gym's currency. No names, no phones.

**Instructions to the AI (system prompt).**

> You are the CFO of a gym. You are writing to the owner, who is not a finance person. Use short, simple sentences. Use only the numbers given in the data. Never calculate or invent a number. If a number is missing, say it is not available. Write three parts: (1) "Where you stand": 2 to 3 lines on profit or loss, break-even, and cash runway. (2) "What is going wrong": the 2 to 3 biggest problems by money. (3) "Do this week": exactly 3 actions, each tied to a number in the data. Keep it under 150 words. Write in the language given in the data.

**Output.** Save the brief with the date and the exact numbers used. Generate a new one every Monday morning, plus a "Refresh" button for the admin.

**If the AI fails.** The CFO page still shows all numbers and alert lists, with a small message: "AI summary is not available right now." The page must never break because of the AI.

## The CFO page (admin only)

1. **Health cards at the top:** profit or loss this month, active members vs break-even members, cash balance, free cash, runway. Green, amber, or red.
2. **This week's brief:** the AI text.
3. **Problem lists:** one tab per alert, with a button on each row to call or message the member using whatever the software already supports.
4. **Trends:** earned income vs expenses for the last 6 months, member growth, renewal rate.
5. **Settings:** opening cash balance and the thresholds.

Only the gym owner or admin role can open this page or its API. Other roles get "not allowed". The page must work on a phone screen.

## Not in version 1

Forecasts for 3, 6, and 12 months. What-if scenarios (price change, new trainer, new branch). Sending the brief on WhatsApp. Comparing with other gyms. Do not build these now.

## Test data

Create test data only in the local development database, never in a real gym's data. It must include at least: one yearly plan paid in full, one monthly plan, one plan with part payment, one frozen member, one member with no visits for 20 days, one new member with 2 visits, one regular member with no PT, one member whose plan ended and who renewed, one who did not renew, one PT package, and expenses in at least 4 categories across 3 months.

## The 10 checks (this is what "10/10" means)

Each check is pass or fail. A check passes only with proof: a test result, a hand calculation that matches, or what was seen in the browser.

1. **Earned income** for a test month matches a hand calculation, including a yearly plan spread across months.
2. **Profit or loss** equals earned income minus expenses for that month.
3. **Break-even members** is correct, and the page shows if the gym is above or below it.
4. **Advance money owed** and **free cash** match a hand calculation, including the part-payment plan and the frozen member.
5. **Cash balance and runway:** the opening balance can be saved, and both numbers change correctly after adding one new payment and one new expense.
6. **Renewal rate** and **net member growth** match the test data.
7. **Pending dues:** the list, the age groups, and the total match the test data.
8. **Alert lists:** each of the five alerts contains exactly the expected test members, and no frozen member appears as at-risk.
9. **AI brief:** it is generated, every number in it matches the page, the request sent to the provider contains no names or phone numbers, and when the AI is switched off the page still works and shows the fallback message.
10. **Safety:** a non-admin user cannot open the page or its API, the old features (add member, take payment, mark attendance, add expense) still work, the page works at phone width, and the browser console shows no errors.

## Adjustments for this app (agreed 2026-10-06)

These notes fit the generic spec above to Rebuild Fitness (dreamteamfit). Where they differ, these win.

1. **Frozen = Pause.** "Frozen" in this spec means the app's existing plan Pause (each pause moves the end date forward). Paused days are not counted as used, and a member on a pause today is never at-risk.
2. **One gym, no branches.** No per-branch numbers.
3. **Expense categories already exist** (Rent, Electricity, Equipment, Staff Salary, Incentive, Maintenance, Marketing, Cleaning, Supplies, Other, plus custom ones). Nothing new to add.
4. **Pending dues come from bills** (bill balance and pay-by date), aged from the pay-by date (from the bill date when there is no pay-by date).
5. **CFO cash balance is not the Day Book.** The Day Book counts the cash drawer only. The CFO counts all the gym's money (cash + UPI + card + bank), so it gets its own one-time entry: "total money on date X".
6. **Who can open it:** owners, plus staff logins with **Finance** ticked. Everyone else gets "not allowed" (page and API).
7. **Low Firestore reads:** the numbers and alert lists are worked out on the server once each morning (existing morning job) and when someone presses Refresh, and saved as one record. Opening the page reads that record, not every plan, payment and visit.
8. **Row buttons:** Call, and open a WhatsApp chat (free). No paid WhatsApp template is sent automatically.
9. **Excel download** on each problem list.
10. **AI provider:** Gemini first (free tier); OpenAI and Claude also wired. Built and tested with a fake AI on this PC (no cost); a real key only for the final live check. The Monday brief runs inside the existing morning job (Vercel free plan allows only 2 scheduled jobs).
11. **Browser testing:** Claude in Chrome is not connected, so the owner-style browser test uses Playwright on the local emulator copy, with screenshots as proof.
