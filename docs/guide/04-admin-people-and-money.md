# Admin guide, part 1: people, payments and growth

This chapter is the reference for administrators who run the people and money side of LearnLoop: members and roles, account security, payment gateways, transactions and invoices, coupons, memberships, bundles, installments, gifts, upsells, taxes and currencies, abandoned-checkout recovery, affiliates, teams, the instructor marketplace, analytics, and points and badges.

> **Status.** Features from rounds 1 and 2 (members, account security, payment gateways, transactions, coupons, points and badges) were tested page by page in a browser. Features marked **(Round 3)** are **built and covered by automated tests; not yet tried in a browser.** Round 3 in this chapter covers: membership plans, bundles, installments, gifts, upsells, taxes and multi-currency, abandoned checkouts and `/api/cron/commerce`, affiliates, teams, the instructor marketplace, analytics, and the account erasure tool in the audit log.

Examples use the demo data. All demo accounts use the password `password123`:

| Account | Email | Roles |
|---|---|---|
| Admin User | `admin@learnloop.test` | Admin (also Moderator, Course creator, Evaluator) |
| Maya Chen | `maya@learnloop.test` | Course creator, Moderator |
| Priya Raman | `priya@learnloop.test` | Evaluator, Moderator |
| Alex Johnson | `alex@learnloop.test` | Student |

The default local address is `http://localhost:3000` (it comes from `APP_URL`).

---

## Where everything in this chapter lives

### Getting to the admin pages

1. Sign in as an administrator (for example `admin@learnloop.test`).
2. In the sidebar, look at the **Manage** section. It shows **Members** (moderators and admins) and **Settings** (admins only).
3. Click **Settings**. You land on `/admin/settings/general`. The settings menu on the left (a scrollable row of buttons on phones and tablets) is grouped like this. The groups and items that belong to this chapter are:

| Settings group | Item | Address |
|---|---|---|
| Content & marketing | Analytics | `/admin/analytics` |
| Content & marketing | Affiliates | `/admin/affiliates` |
| Course configuration | Badges | `/admin/settings/badges` |
| Course configuration | Points & leaderboard | `/admin/settings/gamification` |
| User management | Members | `/admin/members` |
| User management | Teams | `/admin/teams` |
| User management | Instructors & payouts | `/admin/marketplace` |
| User management | Security | `/admin/settings/security` |
| User management | Login activity | `/admin/security` |
| Payment | Payments | `/admin/settings/payments` |
| Payment | Transactions | `/admin/settings/transactions` |
| Payment | Coupons | `/admin/settings/coupons` |
| Payment | Plans, bundles & installments | `/admin/settings/plans` |
| Payment | Taxes & currencies | `/admin/settings/taxes` |
| Payment | Upsells | `/admin/upsells` |
| Legal & compliance | Audit log | `/admin/audit` |

Pages whose address starts with `/admin/settings/` open inside the settings frame, with the settings menu on the left. The others (Members, Teams, Instructors & payouts, Login activity, Analytics, Affiliates, Upsells, Audit log) open as full pages; use the breadcrumbs at the top (for example **Admin › Settings › Affiliates**) to get back.

### Who can open what

Every page checks the role again on the server, so typing an address does not get around it. Someone without the right role is sent to `/forbidden`; someone who is not signed in is sent to `/login` and brought back after signing in.

| Page | Who can use it |
|---|---|
| Members list, Add member, Import, member pages (`/admin/members…`) | Moderators and admins. Some actions on a member page are admin-only (see below). |
| Everything else in this chapter | Admins only |

The five roles, as described on the role switches:

| Role | What it allows |
|---|---|
| Student | Take courses and follow their progress |
| Course creator | Create and manage courses, chapters and lessons |
| Evaluator | Run batches and review and grade submissions |
| Moderator | Oversee every member, all content and the system settings |
| Admin | Full access, including site settings, payments and data |

An admin passes every role check. A member can hold several roles at once; a member with no role is treated as a Student.

> **Two-step verification for staff.** If **Require two-step verification for staff** is on (see [Account security settings](#account-security-settings)), any staff member who has not set up two-step verification is sent to `/settings/security?required=2fa` when they open an `/admin` page, and comes back after setting it up.

---

## Members

**What it is.** The list of everyone with an account, where you add people one by one or from a spreadsheet, change their roles, and (as an admin) disable, reset or delete accounts.

**Who can use it.** Moderators and admins. Moderators can add and import members, edit profiles and change roles, but cannot touch administrators' accounts, grant the Admin role, change email addresses, disable accounts, reset passwords or delete members. Those are admin-only.

**Where.** `/admin/members`. Sidebar: **Manage › Members**, or **Settings › User management › Members**.

### The members list

The page header shows three numbers:

- **Members**: every account.
- **Staff**: accounts with any role besides student.
- **Disabled**: accounts that cannot sign in.

Header buttons: **Settings** (admins only; opens General settings), **Import** and **Add member**.

**How to find someone**

1. Type in the search box ("Search by name, email or username"). The list filters as you type.
2. Pick a role in **Filter by role** (All roles, Student, Course creator, Evaluator, Moderator, Admin).
3. Pick a status in **Filter by status** (Any status, Enabled, Disabled).
4. The filters are kept in the address, for example `/admin/members?role=moderator&status=enabled&search=maya`, so you can bookmark or share a filtered view.

The table shows **User** (name and email), **Roles** (a red **Disabled** badge appears for disabled accounts), **Enrollments**, **Last active**, **Joined**. Newest accounts come first. 25 rows are shown at a time; click **Load more** at the bottom for the next 25. The footer says "Showing X of Y".

Click a name to open the member's page. On the right of each row:

- The person icon opens their public profile (`/user/<username>`).
- The bin icon (admins only, not on your own row) deletes the member after a confirmation. See [Delete a member](#delete-a-member).

### Add a member

1. On `/admin/members`, click **Add member** (or go to `/admin/members/new`).
2. Fill in **Account**:
   - **Full name** (required, 2 to 100 characters).
   - **Email** (required, must not belong to another member).
   - **Username** (optional; "Taken from the email if left empty"). Use 3 to 40 lowercase letters, numbers, dashes or underscores. If the name derived from the email is taken, a number is added (`ada-2`).
   - **Password** (required). It must have at least the minimum length set in Security settings (8 by default) and contain letters and numbers. Click **Generate** to fill in a strong random password, and the eye icon to show it.
3. Under **Roles**, switch on the roles the person needs. Members with no role are added as students. Only administrators see the **Admin** switch.
4. Click **Add member**.
5. You land on the new member's page with the message "Member added successfully".
6. Send the password to the member over a safe channel. They can change it from their profile once signed in.

> Accounts created by an admin count as having a confirmed email address, so the email-verification rule never blocks them.

### Import members from a CSV file

**What it is.** Add up to 500 members at once from a spreadsheet. You see every row checked before anything is created.

**Where.** `/admin/members/import`, from the **Import** button on the members list.

**Step 1: prepare the file**

1. Click **Download template**. It downloads `members-import-template.csv` (from `/admin/members/import/template`):

   ```csv
   email,name,roles,password
   ada@example.com,Ada Lovelace,student,
   grace@example.com,Grace Hopper,"course_creator; batch_evaluator",Welcome2024
   alan@example.com,Alan Turing,moderator,
   ```

2. Fill it in with Excel, Google Sheets or similar, then save as **CSV (UTF-8)**. In Google Sheets: File › Download › Comma-separated values.

**The columns**

| Column | Required | Rules |
|---|---|---|
| `email` | Yes | Must be unique in the file and among existing members. Also recognised as "Email address", "E-mail", "Email ID", "User email". |
| `name` | Yes | The member's full name. Also recognised as "Full name", "Fullname", "Member name". |
| `roles` | No | Separate several with semicolons, for example `course_creator; batch_evaluator`. Leave empty for Student. Accepted values: `student`, `course_creator`, `batch_evaluator`, `moderator`, `admin`, the labels ("Course creator", "Evaluator", …) and the aliases `instructor`, `creator`, `evaluator`, `learner`, `administrator`. Only administrators can import admins. |
| `password` | No | Same rules as Add member. Leave empty to have a password generated; generated passwords are shown once after the import. Also recognised as "New password". |

Column order does not matter and blank lines are skipped. Limits: 1 MB per file and 500 member rows per file (split bigger lists).

**Step 2: upload and check**

1. Drop the file on the box ("Drop a CSV file here or click to browse") or click to choose it.
2. The page checks every row and shows a **Preview**: how many rows are ready, how many have errors, and how many passwords will be generated. Each row shows **Line**, **Member**, **Roles**, **Password** ("Generated" or "From file"), **Status** and **Errors**.
3. Tick **Show only rows with errors** to see just the problems. Typical errors: invalid email, "A member with this email already exists.", "Duplicate email: already used on line N of this file.", unknown roles, a password that is too short.
4. Fix the file and use **Choose another file**, or carry on: rows with errors are skipped.

**Step 3: import**

1. Click **Import N members**. If some rows have errors you are asked to confirm with **Import valid rows**.
2. The summary shows **Imported**, **Skipped** and **Generated passwords**.
3. If passwords were generated, click **Download results** straight away. Generated passwords appear only on this page; send each one privately to its member.
4. Click **Import another file** to start again.

### A member's page

**Where.** `/admin/members/<member id>`, by clicking a name on the members list.

At the top: the member's name, email and username, their role badges (and **You** on your own page), and a **Go to Profile** button for their public profile.

**Left column**

- **Profile**: Full name, Email, Username, Location, Headline, Bio. Edit and click save in the save bar that appears ("Member updated"). Only administrators can change the email address. A moderator sees an administrator's profile and roles read-only.
- **Roles**: switch roles on or off, then save. See [Change roles](#change-roles).
- Admins also see **Sign-in access**, **Reset password** and **Delete member** (below).

**Right column**: Joined, Last active, Courses (enrollments and how many completed), Batches, Certificates, the onboarding Persona if the member filled it in, and the member's **Badges** with a **Manage badge assignments** link (admins).

**Below**

- **Course enrollments**: course, progress bar, enrolled date and access ("Via <batch>", "Paid" or "Self-enrolled"), with badges for Staff or Mentor enrollments, completion and purchased certificates.
- **Batches** the member belongs to.
- **Payments**: every order with its order ID, amount and status. Admins get a **View in Transactions** link and an **Invoice INV-…** link per invoiced order.
- **Certificates** issued to the member.

### Change roles

1. Open the member's page.
2. In **Roles**, switch the roles on or off.
3. Click save. The sidebar and permissions change on the member's next page load.

Rules the server enforces:

- Only administrators can grant the Admin role or change an administrator's roles.
- You cannot remove your own Admin role. A moderator cannot remove their own Moderator role.
- There must always be at least one administrator.
- Unticking every role makes the member a Student.

### Disable or enable an account

**Who.** Admins only, and never on your own account.

1. Open the member's page and find **Sign-in access**.
2. Click **Disable account**, then **Disable** in the confirmation.
3. The member is signed out on every device right away and cannot sign in. Their data is kept.
4. To undo, click **Enable account**, then **Enable**. They can sign in with their current password.

The last enabled administrator cannot be disabled.

### Reset a member's password

**Who.** Admins only.

1. Open the member's page and find **Reset password**.
2. Type a **New password** and the same in **Confirm password**, or click **Generate** (it fills both boxes).
3. Leave **Sign the member out on every device** ticked (the default) unless you have a reason not to.
4. Click **Update password**. The message reads "Password updated for <name>."
5. Send the new password to the member securely.

Updating the password also cancels any reset links already emailed and any sign-in that was waiting for a two-step code.

If you would rather let the member choose their own password, use **Send reset link** in [Login activity](#login-activity-and-account-tools): they get an email with a link that works for 1 hour.

### Reset two-step verification, unlock, confirm an email

These tools live on the Login activity page, not on the member page:

1. Go to `/admin/security` (Settings › User management › **Login activity**).
2. Search for the member and click their name chip under **Account tools**, or open `/admin/security?user=<member id>`.
3. Use **Reset two-step verification**, **Unlock**, **Mark email confirmed**, **Send reset link** or **Sign out everywhere**. Details are in [Login activity and account tools](#login-activity-and-account-tools).

### Impersonation

There is no "log in as this member" feature. To see what a learner sees, sign in with a test account (for example the demo student) in a private browser window.

### Delete a member

**What it is.** Permanent removal of an account and the learning records attached to it.

**Who.** Admins only. You cannot delete yourself or the last administrator.

1. Open the member's page and scroll to **Delete member**, or click the bin icon on the members list.
2. Click **Delete member**, then **Delete** in the confirmation ("The account is deleted permanently. This can't be undone.").
3. You are taken back to the members list with "User deleted".

What happens:

- Removed: the account, sessions, enrollments and progress, video watch data, notes, reviews, quiz, assignment and exercise submissions, batch and program memberships, certificates and certificate requests, evaluator slots, badges, activity, notifications, job applications, and the member's discussion topics (with every reply under them) and replies.
- Kept: payment records, for accounting. Any of the member's orders still awaiting payment are marked failed so they no longer hold coupon uses.
- Refused: members who own content (courses, batches, programs, quizzes, questions, assignments, exercises, live classes, job posts, or who are a course's instructor or evaluator). The message reads "This member owns courses, batches or other content. Reassign it, or disable the account instead."

### Erase an account on a member's request (GDPR) (Round 3)

**What it is.** The admin version of a member's own "Delete my account": the account is anonymised rather than removed, so orders, statistics and discussion threads stay consistent. Use it when someone asks you by email or letter to delete their data.

**Who.** Admins only.

**Where.** `/admin/audit?tab=requests` (Settings › Legal & compliance › **Audit log**, then the **Data requests** tab), card **Requests received by email or letter**.

1. In **Erase a member's account**, click **Erase an account…**.
2. Choose the **Member**.
3. Type **Your password** (your own admin password) to confirm.
4. Type `DELETE` in **Type DELETE to confirm**.
5. Confirm. The message reports how many records were deleted and how many anonymised.

What happens:

- The member is signed out everywhere and can never sign in again.
- Personal data is removed: name, email, profile, sessions, sign-in history, notes, preferences, notifications, emails, AI tutor chats, direct messages they sent, leads and job applications, and their uploaded profile pictures and résumés.
- Their discussion posts and reviews now show "Deleted user". Orders keep their amounts and invoice numbers for your books, but billing name, address and tax IDs are removed.
- A confirmation email goes to the address the account had, other administrators get a notification, and the request is recorded in the **Data requests** list and in the activity log.

It is refused for the only administrator account and for members whose membership is still billed automatically by Stripe or Razorpay ("Cancel them first so the member is not charged again"). You cannot erase yourself here; use your own Settings › Privacy & data.

**Download a member's data.** In the same card, **Download a member's data** gives you the same JSON file members can download from their privacy settings. Pick the **Member** and click **Download data**, then send it over a secure channel. Downloads are rate-limited; if you see "Too many data downloads in the last hour", wait and try again.

**The requests list.** Below the card, every data download and account deletion (made by members themselves or by you) is listed with **Requested**, **Member**, **Type**, **Status** and **Completed**. Switch between **All**, **Data downloads** and **Account deletions**, search by member or request ID, and export the list as CSV.

**Delete or erase?**

| | Delete member (member page) | Erase account (audit log) |
|---|---|---|
| Account record | Removed | Kept, stripped of personal data |
| Learning records | Removed | Personal data removed; counts stay correct |
| Payments | Kept as they were | Kept, billing details removed |
| Blocked when | Member owns content; last admin | Last admin; membership billed by a gateway |
| Recorded as a data request | No | Yes |

### Settings that affect members

| Setting | Where | Effect |
|---|---|---|
| Minimum password length | Settings › Security | Applies to Add member, import and password resets |
| Disable sign-up | Settings › Learning | When on, new members can only be added by an admin |
| Require a confirmed email to enroll and purchase | Settings › Security | Admin-created and imported accounts count as confirmed |

**Good to know.** Every add, import, profile change, role change, enable/disable, password reset and deletion is written to the audit log at `/admin/audit` with who did it and when.

---

## Account security settings

**What it is.** Site-wide rules for sign-in: email confirmation, two-step verification (authenticator app), lockout after failed attempts, and password length.

**Who can use it.** Admins only.

**Where.** `/admin/settings/security` (Settings › User management › **Security**). The **Login activity** button at the top opens `/admin/security`.

At the top, four numbers:

- **Two-step verification**: share of enabled members who use it.
- **Staff protected**: staff with two-step verification, out of all staff.
- **Unconfirmed emails**: members who signed up themselves and have not confirmed yet.
- **Locked right now**: accounts currently locked ("Unlock them from Login activity").

**The settings**

| Setting | Default | Allowed | What it does |
|---|---|---|---|
| Require a confirmed email to enroll and purchase | Off | On/off | New members get a confirmation link when they sign up. Until they confirm, they can browse and learn from free previews but cannot enroll or pay. Accounts created by admins count as confirmed. |
| Allow two-step verification | On | On/off | Members can protect their account with an authenticator app (TOTP) and recovery codes. Members who already use it keep it if you turn this off. |
| Require two-step verification for staff | Off | On/off | Admins, moderators, course creators and evaluators must set it up before they can open admin and teaching pages. Needs "Allow two-step verification" on. |
| Failed attempts before lockout | 8 | 3 to 20 | Consecutive wrong passwords or codes before sign-in is paused for the account. |
| Lockout duration (minutes) | 15 | 1 to 1440 | How long sign-in stays paused. Members can still reset their password by email. |
| Minimum password length | 8 | 8 to 64 | Applies to sign-up, password changes and resets. Passwords must also contain letters and numbers. |

**How to require two-step verification for staff**

1. Set up two-step verification on your own account first: open your account **Settings › Security** (`/settings/security`) and follow the steps. If you skip this, saving fails with "Turn on two-step verification for your own account first, so you aren't locked out of admin pages."
2. Go back to `/admin/settings/security`.
3. Make sure **Allow two-step verification** is on, then switch on **Require two-step verification for staff**.
4. Save. From now on, staff without two-step verification are sent to `/settings/security?required=2fa` when they open an `/admin` page.

**Environment variables that matter here** (in the server's `.env`, restart after changing):

| Variable | Why |
|---|---|
| `APP_SECRET` | Encrypts two-step verification secrets. Required in production (32+ characters, e.g. `openssl rand -hex 32`). Changing it later breaks existing two-step setups and signed links. |
| `SESSION_DAYS` | How long a sign-in lasts (default 30 days). |
| `COOKIE_SECURE` | Sends the session cookie over HTTPS only (on by default in production). |
| `TRUST_PROXY_HOPS` | Number of reverse proxies in front of the app (0 by default). Set it to 1 behind one nginx/Caddy/load balancer, so Login activity shows real visitor IP addresses and per-IP limits work per visitor. Never set it higher than the real number of proxies. |

**Good to know.** The lockout counter resets after a successful sign-in, a password reset, or when an admin clicks **Unlock**. Failed attempts against email addresses that have no account are treated exactly like real ones, so attackers cannot tell which addresses exist.

---

## Login activity and account tools

**What it is.** A log of every sign-in attempt (successful, failed or blocked) with IP address and device, a list of locked accounts, and per-member account tools.

**Who can use it.** Admins only.

**Where.** `/admin/security` (Settings › User management › **Login activity**). The **Security settings** button goes back to `/admin/settings/security`.

**Numbers at the top**: Sign-ins (24h), Failed attempts (24h) (with how many IP addresses they came from), Locked accounts, Staff with 2-step.

**Locked accounts.** When accounts are locked, a card lists them with "unlocks in …". Click **Unlock** to let the member sign in again straight away (useful when they phone you).

**Search and filter the log**

1. Type in the search box ("Search email, name or IP").
2. **Filter by outcome**: Any outcome, Signed in, Failed or blocked.
3. **Filter by reason**: any of the reasons in the table below.
4. **Time period**: Last 24 hours, Last 7 days, Last 30 days (default), All time.
5. Click an IP address in the table to see every attempt from that address.

The table shows **When**, **Account** ("No account" when the email is not registered), **Outcome**, **IP address**, **Device**. 50 rows per page; use **Newer** and **Older** to page.

| Outcome shown | Meaning |
|---|---|
| Signed in | Normal sign-in |
| Account created | First sign-in after sign-up |
| Signed in with authenticator code | Two-step code accepted |
| Signed in with a recovery code | A recovery code was used (worth checking with the member) |
| Signed in after resetting password | Sign-in through a reset link |
| Password accepted, waiting for code | Not a failure; the member still has to enter a two-step code |
| Wrong password | Bad password |
| No account with this email | Unknown email |
| Wrong password — account locked | This failure triggered the lockout |
| Blocked: account temporarily locked | Attempt while locked |
| Blocked: account disabled | The account is disabled |
| Blocked: too many attempts | Rate limit hit |
| Wrong verification code | Bad two-step code |
| Wrong verification code — account locked | Bad codes triggered the lockout |

**Account tools for one member**

1. Search for the member. Their name appears as a chip after **Account tools:**; click it. (Or click a name in the table, or open `/admin/security?user=<member id>`.)
2. A card shows **Status** (Active, Locked with time left, or Disabled), **Email** (Confirmed, Admin-created or Not confirmed), **Two-step** (On with the number of recovery codes left, Setup unfinished, or Off) and **Failed attempts** in a row. The log below is filtered to this member; click **Clear** to show everyone again.
3. The buttons shown depend on the account:

| Button | When shown | What it does |
|---|---|---|
| **Unlock** | Account locked or has failed attempts | Clears the lockout and the counter |
| **Send reset link** | Account enabled | Emails a password reset link valid for 1 hour |
| **Mark email confirmed** | Email not confirmed | Marks the address as confirmed. Only do this if you know the member owns it. |
| **Reset two-step verification** | Member uses two-step (not on your own account) | For a member who lost their phone and recovery codes. Their authenticator and codes stop working, they are signed out everywhere and get a security email; they can set it up again after signing in with their password. |
| **Sign out everywhere** | Not on your own account | Ends every session of the member |

4. **Open member profile →** goes to the member's admin page.

**Sessions.** Each member sees and ends their own signed-in devices at **Settings › Security** (`/settings/security`). Admins can end all of a member's sessions with **Sign out everywhere**; there is no per-device view of other people's sessions.

**Good to know.** "Send reset link" needs working email (see the Email settings chapter: `MAIL_TRANSPORT=smtp` and the `SMTP_*` values); with the default `MAIL_TRANSPORT=log`, the email is only stored in the outbox at `/admin/emails`.

---

## Payments setup

**What it is.** Where you choose how money is collected: manual payment (bank transfer, invoice), Stripe, Razorpay, or no payment at all, plus the default currency, a simple tax and payment reminders.

**Who can use it.** Admins only.

**Where.** `/admin/settings/payments` (Settings › Payment › **Payments**).

The page has two parts: **Payment gateways** (read-only status of Stripe and Razorpay) and the settings form.

### The four ways to take payment

| Choice in "Payment gateway" | What happens at checkout |
|---|---|
| **Manual payment** (default) | Learners place an order and pay offline (bank transfer, invoice). You confirm the payment in Transactions; that enrolls them. |
| **Stripe** | Learners pay on Stripe's hosted checkout (cards, wallets and the payment methods you enabled in Stripe) and are enrolled automatically. |
| **Razorpay** | Learners pay in the Razorpay window (cards, UPI, netbanking, wallets) and are enrolled automatically. |
| **No payment gateway** | Payment is not collected: paid items are granted as soon as the learner checks out. |

Stripe and Razorpay can only be selected once their keys are in `.env`. If you try anyway, saving fails with "<Gateway> is not configured. Add its keys to the .env file and restart the server, or choose another gateway." If a selected gateway later loses its keys, learners see "Online payments are unavailable" at checkout.

### Set up Stripe

1. In the Stripe dashboard, copy your **secret key** (Developers › API keys). Use a test key (`sk_test_…`) first; a live key (`sk_live_…`) takes real money. The mode shown in LearnLoop (**Test mode** or **Live mode**) follows the key you use.
2. Add it to the server's `.env`:

   ```env
   APP_URL=https://learn.example.com
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

   `APP_URL` must be your public address: the webhook, success and cancel URLs are built from it.
3. In Stripe, add a webhook endpoint (Developers › Webhooks; the **Open Stripe webhooks** button on the Payments page takes you there) with this URL:

   `https://<your APP_URL host>/api/payments/stripe/webhook`

   The exact URL is shown on the Payments page with a copy button.
4. Subscribe the endpoint to these events (they are also listed on the page):

   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `charge.refunded`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`

5. Copy the endpoint's signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
6. Restart the app. On the Payments page the Stripe card shows **Configured** and the webhook secret shows **Set**.
7. Click **Test connection**. You should see "Connected to Stripe (test mode)."
8. In the form below, choose **Stripe** under **Payment gateway** and save.

**Testing on your own computer.** Stripe cannot reach `localhost`. The page tells you so and suggests the Stripe CLI: run `stripe listen --forward-to localhost:3000/api/payments/stripe/webhook` and put the secret it prints into `STRIPE_WEBHOOK_SECRET`.

### Set up Razorpay

1. In the Razorpay dashboard, create API keys. You get a **Key ID** (`rzp_test_…` or `rzp_live_…`) and a **Key Secret**.
2. Add them to `.env`:

   ```env
   RAZORPAY_KEY_ID=rzp_test_...
   RAZORPAY_KEY_SECRET=...
   RAZORPAY_WEBHOOK_SECRET=...
   ```

3. In Razorpay (Settings › Webhooks; or the **Open Razorpay webhooks** button), add a webhook with the URL:

   `https://<your APP_URL host>/api/payments/razorpay/webhook`

4. Choose a webhook secret there, tick these events, and put the same secret into `RAZORPAY_WEBHOOK_SECRET`:

   - `payment.authorized`, `payment.captured`, `payment.failed`
   - `order.paid`
   - `refund.processed`
   - `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`

5. Restart the app, click **Test connection** on the Razorpay card, then choose **Razorpay** under **Payment gateway** and save.

Razorpay needs international currencies enabled on your Razorpay account if you sell in anything other than INR. To receive webhooks on your own computer, expose it through a tunnel and set `APP_URL` to the tunnel address.

### The gateway status cards

Each card (Stripe, Razorpay) shows:

- **Configured** or **Not configured**, **Test mode** or **Live mode**, and **Active at checkout** for the gateway in use.
- The key, masked (for example `sk_test_…a1b2`). Secrets are never shown in full.
- The webhook secret: **Set**, or "Missing: webhooks are rejected until it's set".
- Problems, for example "Missing STRIPE_SECRET_KEY" or "RAZORPAY_KEY_ID is not a Razorpay key id (rzp_test_… or rzp_live_…)".
- **Webhook endpoint**: the URL to register (with **Copy URL**), the events to subscribe, and **Open … webhooks** and **Webhook docs** links.
- **Test connection** (only when configured).

Orders are also confirmed when learners come back from checkout, but webhooks make confirmation reliable (closed tabs, slow bank payments, refunds made in the gateway dashboard, membership renewals).

### Manual payment

1. Choose **Manual payment** under **Payment gateway** and save.
2. A learner who checks out sees "Order placed — awaiting confirmation" and a **How to pay** box: transfer the amount "using the payment details shared by our team" and use the order ID (for example `ORD-2K8F-33QA`) as the reference.
3. When the money arrives, open **Transactions**, find the order and click **Mark as paid**. The learner gets access immediately and a notification.

> There is no settings field for your bank details. Tell learners how to pay in another way, for example in the course description, an email, or your refund/terms pages.

### The settings form

| Field | Default | What it does |
|---|---|---|
| **Default currency** | USD | The currency new course and batch prices start in. Choices: USD, EUR, GBP, INR, AUD, CAD, SGD, AED, JPY. Fixed-amount coupons are stored in this currency. |
| **Show the USD equivalent** | Off | Checkout shows an approximate amount in USD for prices in other currencies. |
| **Round the equivalent** | On | Rounds that USD equivalent up to the next whole dollar. |
| **Payment gateway** | Manual payment | See the table above. |
| **Apply tax** | Off | Adds tax to every order total; checkout then asks for a GSTIN / PAN (optional). |
| **Tax percentage** | 0 | Added on top of the discounted price. Must be above 0 when tax is on (max 100). |
| **Tax label** | Tax | Shown in the order summary, e.g. GST or VAT (max 30 characters). |
| **Send payment reminders** | Off | Learners who left an order unpaid in the last week get one automatic reminder a day until they pay. Reminders are checked whenever an admin opens the admin overview or Transactions. Transactions also gets a **Send reminders** button. |

For a different tax rate per country, see [Taxes and currencies](#taxes-and-currencies-round-3).

**Good to know.** Changes to `.env` only take effect after the app is restarted. Switching gateway does not affect orders already placed: each order remembers the gateway it was paid with, and refunding an online order goes back through that gateway, so keep its keys in `.env` while you may still need to refund its orders.

---

## Transactions, refunds and invoices

**What it is.** Every order placed at checkout, with tools to confirm manual payments, refund, check a gateway, send reminders, record payments by hand, open invoices and export.

**Who can use it.** Admins only.

**Where.** `/admin/settings/transactions` (Settings › Payment › **Transactions**). The admin overview's quick link **Transactions** goes here too.

**Numbers at the top** (for the orders matching your filters): **Net revenue** (after refunds), **Paid**, **Awaiting payment**, **Refunded** (with cancelled or failed orders counted below).

**Find an order**

1. Search by name, email or order ID.
2. **Status**: All Payments, Paid, Unpaid (pending), Cancelled / failed, Refunded.
3. **Type**: All types, For Course, For Batch, For Certificate, For Membership, For Bundle, For Gift.
4. **From** and **To** dates. **Clear** resets the filters.

The table shows **Billing Name**, **Item**, **Amount**, **Status**, **Date**, 25 at a time with **Load more**. Click a row to open the order.

### The order window

It shows the item, the amounts (original, discount and coupon, tax, total), the member, billing name and address, source, gateway, gateway order and payment IDs (with a link to the order in the Stripe or Razorpay dashboard), paid date, refund ID, last reminder, GSTIN / PAN, the **Invoice** link, and **Order page** ("View as the learner sees it").

Buttons at the bottom (shown only when they apply):

| Button | When | What it does |
|---|---|---|
| **Edit details** | Always | Correct Billing Name, Payment ID (locked when it came from the gateway), Source, GSTIN and PAN. |
| **Open the Course / Batch / Bundle / pricing page** | Always | Opens the item. |
| **Delete** | Not paid and no invoice | Permanently deletes the order. For an open Stripe checkout, the checkout is closed first. Invoiced orders are kept for your records. |
| **Check with Stripe / Razorpay** | Unpaid gateway order | Asks the gateway whether it was paid and settles the order. |
| **Send reminder** | Unpaid | Sends the learner a notification to finish paying. |
| **Refund** | Paid | See below. |
| **Mark as paid** | Unpaid or failed | Records the money as received (manual payment) and gives access right away. For an open Stripe checkout, the checkout is closed first so the learner cannot pay twice; Razorpay windows cannot be closed, so you are alerted if the learner still pays. |

### Refund an order

1. Open the paid order and click **Refund**.
2. **Refund amount** is filled with what is left to refund. Lower it for a partial refund.
3. For orders paid through Stripe or Razorpay, the money goes back to the learner's original payment method through the gateway ("usually arrives within 5–10 business days"). If you already refunded in the gateway dashboard, tick **Already refunded in the <gateway> dashboard**: LearnLoop then only records it.
4. For manual and free orders, nothing is sent: return the money yourself; this records the refund.
5. Click **Refund … via <gateway>** or **Record refund**.

The learner loses the access the order granted (a paid certificate is revoked). If a refund request times out, retrying is safe: refunds already on the payment are checked first so nothing is refunded twice. Refunds made in the gateway dashboard are also picked up by the `charge.refunded` (Stripe) and `refund.processed` (Razorpay) webhooks.

### Record a payment by hand

Use this for money received outside checkout (a bank transfer, a company invoice).

1. Click **New** at the top of Transactions.
2. Fill in **Member**, **Paid For** (course, batch, certificate, membership plan or bundle; gifts cannot be recorded by hand), the item itself, **Billing Name**, **Currency**, **Original Amount**, **Discount Amount**, **Tax Amount**, and optionally **Coupon**, **Payment ID** (bank or provider reference) and **Source**. The **Total** is calculated.
3. Switch on **Received** if the money has arrived: the order is marked paid and the member gets access right away. Leave it off to record an unpaid order and mark it paid later.
4. Click **Save**.

A received membership payment starts the member's membership or extends it by one billing period; a received bundle payment enrolls the member in every course of the bundle. The form refuses to record a second sale of something the member already paid for.

### Payment reminders

With **Send payment reminders** on (Payments settings):

- A note at the top of Transactions says reminders are on and when the last one went out.
- Unpaid orders from the last 7 days get one reminder a day, automatically.
- **Send reminders** sends them right away to everyone eligible (orders reminded in the last 24 hours, learners who already have access and sold-out batches are skipped).

### Export

**Export CSV** downloads `transactions-<date>.csv` with the orders matching your current filters. Columns: Order ID, Created at, Status, Billing name, Member, Email, Item type, Item, Currency, Original amount, Discount, Tax, Total, Coupon, Gateway, Gateway order ID, Gateway payment ID, Paid at, Invoice number, Refunded amount, Refunded at, Refund ID, Failure reason, address lines, City, State, Country, Postal code, GSTIN, PAN, Source.

### Invoices

- Every paid order with an amount above zero gets a sequential invoice number per calendar year, for example `INV-2026-00042`. Free orders and orders granted with no payment gateway get none. Numbers never change once assigned, and older paid orders receive numbers when an admin opens Transactions.
- The invoice page is `/billing/invoice/<order ID>`. The buyer and admins can open it (from the order window, the member page, or the learner's billing history). **Print / Save as PDF** prints it or saves it as a PDF.
- The seller block uses your **Brand name**, tagline, logo and **Footer text** (Settings › General and Branding) and the contact email or URL (Settings › General). The buyer block uses the billing name, address and GSTIN / PAN; fix those with **Edit details**.
- Tax on the invoice uses the tax rule of the buyer's country when there is one, otherwise the tax label from Payments.

---

## Coupons

**What it is.** Discount codes learners type at checkout: a percentage or a fixed amount, optionally limited to certain courses and batches, a number of uses and an expiry date.

**Who can use it.** Admins only.

**Where.** `/admin/settings/coupons` (Settings › Payment › **Coupons**).

The list shows **Code**, **Discount**, **Expires On**, **Redeemed**, **Applies to** ("All courses & batches" or the item names), and an **Enabled** switch, with **Expired** and **Limit reached** badges. Use the search box to filter.

### Create or edit a coupon

1. Click **New coupon** (or the pencil icon on a row).
2. Fill in:

| Field | Rules |
|---|---|
| **Coupon Code** | 3 to 32 letters, numbers, dashes or underscores; stored in capitals; must be unique. |
| **Discount Type** | Percentage or Fixed Amount. |
| **Discount Percentage** / **Discount Amount** | Percentage: 1 to 100. Amount: above zero, in the default currency; it only applies to items priced in that currency. |
| **Expires On** | Optional. Empty means no expiry. Cannot be in the past for an enabled coupon. |
| **Usage Limit** | Total redemptions allowed. Empty means unlimited. |
| **Enabled** | Disabled codes are rejected at checkout. |
| **Applicable For** | Search and pick courses and batches. Leave it empty to allow every course and batch. |

3. Click save ("Coupon created successfully").

Flip the **Enabled** switch on a row to turn a code on or off; the bin icon deletes it ("the code will no longer be valid").

### How coupons are checked at checkout

- The code must be enabled, not expired, under its usage limit, applicable to the item and (for fixed amounts) priced in the default currency.
- Orders still awaiting payment reserve a use, so a limited code cannot be over-used while checkouts are open. **Redeemed** counts paid orders.
- A coupon chosen for a course also works when buying that course's paid certificate.
- Coupons cannot be used for memberships that renew ("Coupons can't be used for memberships that renew.").
- To stop guessing, a buyer can have 20 codes rejected in 10 minutes (60 per IP address); then they must wait.

**Demo data.** `LAUNCH20` (20% off everything, 100 uses, expires in 60 days), `REACT10` (10.00 off the React course only, unlimited), and `SUMMER` (50%, expired and disabled).

**Good to know.** The **Coupons** section of [Analytics](#analytics-round-3) shows orders, discounts and net revenue per code. Abandoned-checkout reminders can create their own single-use codes (see [Abandoned checkout recovery](#abandoned-checkout-recovery-round-3)).

---

## Memberships and plans (Round 3)

**What it is.** Subscriptions that unlock every course or the courses you pick, billed monthly, yearly or once (lifetime), with optional free trials. Members see them on the pricing page `/pricing` (sidebar **Membership**).

**Who can use it.** Admins manage plans and members' memberships. Any signed-in member can buy one.

**Where.** `/admin/settings/plans` (Settings › Payment › **Plans, bundles & installments**). The page has six tabs: **Plans**, **Members**, **Bundles**, **Installments**, **Gifts**, **Checkouts**. The **Plans** tab opens by default.

### Turn membership sales on or off

At the top of the Plans tab, the **Sell memberships** switch (on by default):

- On: "The pricing page is live and appears in the main menu."
- Off: "The pricing page is hidden and new membership checkouts are closed. Current members keep their access."

Below the switch, a line explains how memberships are billed with your current gateway:

| Gateway | Billing |
|---|---|
| Stripe or Razorpay | Billed automatically: the gateway charges each renewal and LearnLoop records it from webhooks. |
| Manual payment | Members get a renewal order before each period ends; you confirm the payment under Transactions. |
| No payment gateway | Memberships start without payment and renew for free. |

A warning appears if the gateway is not configured, or if its webhook secret is missing ("Renewals, failed payments and cancellations made at <gateway> are only picked up when this page is opened").

**Numbers**: **Paying members** (with how many have a payment due), **On free trial**, **Ending within 7 days** (cancelled, still running), **Monthly recurring revenue** (yearly plans count as a twelfth).

### Create a plan

1. Click **New plan**.
2. Fill in:

| Field | Rules |
|---|---|
| **Plan name** | 2 to 80 characters. |
| **URL name** | Lowercase letters, numbers and hyphens. The checkout link is `/billing/plan/<URL name>`. |
| **Description** | Shown on the plan card; Markdown allowed (max 4,000 characters). |
| **Billing** | Monthly, Yearly, or One-time (lifetime). |
| **Price** and **Currency** | Price above zero, such as 19 or 19.99. For a yearly plan, the form shows the monthly equivalent and the saving against a monthly plan in the same currency. |
| **Free trial (days)** | 0 to 365. 0 means no trial. Each member gets a trial once, on their first membership. Lifetime plans have no trial. |
| **What the plan unlocks** | **Every course** (the whole catalog, including courses added later) or **Selected courses** (pick them in the list). |
| **Features** | One per line (max 15, 140 characters each). Shown as a checklist on the plan card. |
| **On sale** | Show the plan on the pricing page and accept new members. Turning it off never affects current members. |
| **Payment gateway prices (optional)** | For monthly/yearly plans: **Stripe price ID** (`price_…`) and **Razorpay plan ID** (`plan_…`). Leave empty and they are created on the first checkout. |

3. Save. The plan appears as a card with **Paying**, **On trial** and **All time** member counts.

**Plan card menu**: **Edit**, **View members** (opens the Members tab filtered to this plan), **Retire plan** ("Stop selling it; members keep it") or **Put on sale**, and **Delete**. Only plans that never had a member or an order can be deleted; retire the others. **View pricing page** opens `/pricing`.

**Demo data.** "All-Access Monthly" (19.00 USD a month, 7-day free trial) and "All-Access Yearly" (159.00 USD a year), both unlocking every course.

### The Members tab: manage people's memberships

**Where.** `/admin/settings/plans?tab=members`.

1. Filter by status: Running memberships (default), All memberships, Free trial, Active, Payment due, Ending at period end, Cancelled, Expired.
2. Filter by plan (Any plan) and by billing: Any billing, Stripe, Razorpay, Manual payment, Complimentary.
3. Search by name, email or subscription ID.

The table shows **Member**, **Plan**, **Status**, **Period ends**, **Billing**, **Paid** (lifetime value). Click **Manage** on a row:

| Action | What it does |
|---|---|
| **Refresh from Stripe / Razorpay** | Reads the subscription back from the gateway (gateway-billed memberships). |
| **Resume renewal** | Undoes "end at period end". |
| **End at period end** | The member keeps access until the period ends and is not charged again. They are told by email. |
| **Extend by (days)** / **Reactivate for (days)** then **Extend** / **Reactivate** | Adds days to a membership not billed by a gateway; an ended one becomes active again from today. 1 to 3650 days. |
| **View orders** | Opens Transactions filtered to this member's membership orders. |
| **Open in Stripe / Razorpay** | Opens the subscription in the gateway dashboard. |
| **Cancel now** | Ends the membership immediately and locks its courses (progress is kept). A gateway subscription is cancelled too. Refund the last payment from Transactions if needed. |

**Bulk extend.** Tick several rows, type the number of days in **Extend by … days** and click **Apply**. Memberships billed by Stripe or Razorpay are skipped and counted.

**Grant a membership.** Click **Grant membership** (top of the Members tab), choose the **Member** and **Plan**, and optionally **Length in days** (empty = one billing period; lifetime plans never end). Use it for scholarships or bank transfers.

**Export CSV** downloads the members matching your filters.

### Keeping memberships up to date

Without any scheduler, memberships paid by hand move to "payment due" or "ended", renewal orders are opened and missed gateway webhooks are caught up whenever an admin opens this page. To make this timely, schedule the commerce cron (see [Scheduled commerce upkeep](#scheduled-commerce-upkeep-apicroncommerce)).

---

## Course bundles (Round 3)

**What it is.** Several courses sold together for one price. Buyers are enrolled in every course of the bundle at once and see how much they save. Public pages: `/bundles` and `/bundles/<URL name>`.

**Who can use it.** Admins.

**Where.** `/admin/settings/plans?tab=bundles`.

1. The **Sell bundles** switch turns bundle sales (and the **Bundles** menu item) on or off.
2. Numbers: **Bundles** (and how many published), **Bundles sold**, **Bundle revenue**, **Courses available**.
3. Click **New bundle** (it needs at least 2 courses on the site). Fill in **Title**, **URL name** (page `/bundles/<URL name>`; if you change it later, the old address redirects), **Description** (Markdown), **Courses in the bundle** (2 to 30; use the up and down arrows to set the order shown on the bundle page), **Bundle price**, **Currency**, an optional **Cover image** (without one, the covers of the first courses are shown) and **Published**.
4. Save.

Row menu: **Edit**, **View page** / **Preview page**, **View orders**, **Duplicate** (copy as a draft), **Unpublish** ("Stop selling it; buyers keep it") or **Publish**, **Delete** (not for bundles that have orders, gifts or upsells). Tick several rows to **Publish**, **Unpublish** or **Delete** them together. Filters: All bundles, Published, Drafts, and a search box. **Export CSV** is in the header.

A bundle shows as **Hidden** when none of its courses is published or bundle sales are off.

**Demo data.** "Full-Stack Starter Bundle": Modern JavaScript Fundamentals plus React & Next.js, 59.00 USD.

---

## Installments (Round 3)

**What it is.** Learners pay a course in equal parts. Access starts with the first payment and pauses when a payment is more than 7 days late.

**Who can use it.** Admins set it up; learners choose it at checkout.

**Where.** `/admin/settings/plans?tab=installments`.

### Turn it on and offer a course

1. Switch on **Offer installments**. Courses with installment terms then show "or N payments of X" on their page and at checkout. (It needs an active payment gateway; with **No payment gateway** checkout cannot offer installments.)
2. Scroll to **Courses sold in installments**. Every paid course is listed with its terms or "Full payment only".
3. Click **Offer** (or **Edit**) on a course.
4. Switch on **Sell this course in installments** and set **Payments** (2 to 24), **Days between payments** (1 to 365) and **Surcharge %** (0 to 100, added to the price).
5. Save. Changes apply to new checkouts only; running plans keep their schedule.

How later payments are collected depends on the gateway:

| Gateway | Later payments |
|---|---|
| Stripe | Charged automatically on their due dates; stops after the last one. |
| Razorpay | The learner gets an email with a "Pay installment" link before each payment and pays through Razorpay. |
| Manual payment | The learner gets a reminder with the payment instructions; you confirm each payment under Transactions. |

### Follow payment plans

The **Payment plans** table lists every learner's plan. Numbers: **Plans collecting**, **Payment overdue** (within the 7-day grace period), **Access paused** (more than 7 days late), **Still to collect**.

Filters: Collecting payments (default), All plans, On track, Payment overdue, Access paused, Paid in full, Cancelled, Awaiting first payment; a course filter and a search box.

Row menu:

| Action | What it does |
|---|---|
| **View payments** | Opens Transactions for this plan's orders. |
| **Send reminder** | Reminds the learner of the next payment (one reminder per plan and day). |
| **Waive the rest** | Writes off what is still owed; the course becomes the learner's for good. They are told by email. |
| **Cancel plan** | No more payments are collected (a Stripe subscription is stopped). The learner keeps progress, but the course locks until they buy it. Payments already made are not refunded. |

Tick several plans and click **Send payment reminders** to remind them together. **Export CSV** is in the header.

---

## Gifts (Round 3)

**What it is.** Courses, bundles and memberships bought for someone else. The recipient gets an email with a single-use code on the date the buyer chose and redeems it at `/redeem`.

**Who can use it.** Admins see every gift. Buyers manage their own gifts at `/gift` (sidebar **Gifts**).

**Where.** `/admin/settings/plans?tab=gifts`.

1. The **Sell gifts** switch: on, courses, bundles and membership plans show "Give as a gift"; off, gift checkout is closed, but gifts already bought are still delivered and can be redeemed.
2. Numbers: **Gifts sold**, **Redeemed**, **Scheduled** (waiting for their send date), **Gift revenue**.
3. Filter by status (All gifts, Awaiting payment, Scheduled, Being sent, Delivered, Redeemed, Cancelled, Refunded) or search by item, buyer, recipient, code or order.

Row menu: **Send now** (scheduled gifts), **Resend email** (delivered gifts), **Copy code**, **View order**. **Export CSV** is in the header.

Scheduled gifts are delivered around 9:00 (the buyer's time) on the chosen day, when the commerce cron runs, or when an admin opens the Gifts tab. Gift emails need working email delivery (`MAIL_TRANSPORT=smtp`).

---

## Upsells and order bumps (Round 3)

**What it is.** When someone buys a course or bundle (the trigger), you offer another course or bundle at a discount in two places: as a tick box at checkout (an "order bump", charged in the same payment) and as a one-click offer on the order page right after the purchase.

**Who can use it.** Admins.

**Where.** `/admin/upsells` (Settings › Payment › **Upsells**).

Numbers: **Upsells** (and how many active), **Offers accepted** (paid orders from upsells), **Upsell revenue**, **Items to offer** (paid courses and bundles).

### Create an upsell

1. Click **New upsell**.
2. **When someone buys**: the trigger course or bundle.
3. **Offer them**: a different course or bundle.
4. **Discount**: 0 to 95%.
5. **Headline**: shown above the offer, for example "Add the advanced course and save 30%" (max 140 characters).
6. **Active**: show it at checkout and after purchases.
7. Save.

The table shows **Offer**, **Price** (the discounted price), **Results** (trigger sales, accepted offers split into order bumps and post-purchase, conversion, revenue) and **Status**. Row menu: **Edit**, **View trigger**, **View offer**, **Pause** / **Activate**, **Delete** (orders that came from it are kept). Filters: All upsells, Active, Paused, and search. Tick rows for bulk actions. **Export CSV** in the header.

An active upsell shows the status **Not shown** when it cannot be offered, with the reason under it: "Different currencies" (the offer is priced in another currency than the trigger) or "Offer not on sale" (the offered course or bundle is not published or not sold).

**Demo data.** Buying "React & Next.js: Build Production Apps" offers "UI Design Principles for Developers" at 20% off.

---

## Taxes and currencies (Round 3)

**What it is.** Charge the right tax for each buyer's country, and sell at fixed prices in other currencies.

**Who can use it.** Admins.

**Where.** `/admin/settings/taxes` (Settings › Payment › **Taxes & currencies**).

### Settings

1. Under **How tax is charged**, choose:
   - **One rate for everyone**: uses the single rate from Payments (the page shows "Currently GST 18%, added at checkout" or "Currently no tax").
   - **By the buyer's country**: uses the tax rules below for the country of the billing address. Other countries pay the single rate, if any.
2. Switch on **Sell in several currencies** if buyers may choose their currency at checkout and pay the fixed price you set for it. Items without a price in that currency use their own.
3. Click **Save settings**.

Tax is calculated on the server for the billing address's country and rounded once per order to the smallest unit of the currency.

### Tax rules

1. Click **Add tax rule**.
2. Choose the **Country**, a **Tax name** (printed on invoices, e.g. VAT or GST; max 40 characters) and the **Rate** (above 0 and at most 100, e.g. 18 or 7.5).
3. Switch on **Prices include this tax** for VAT-style pricing: buyers pay the listed price and the tax is carved out of it. Off: the tax is added on top.
4. Click **Add rule**.

One rule per country. The table shows **Country**, **Tax** and **Collected** (orders and amounts). Rules are only applied while **By the buyer's country** is selected; otherwise they are kept for later. Deleting rules does not change orders already placed.

**Demo data.** India GST 18% (added on top), United Kingdom VAT 20% (included), Germany VAT 19% (included).

### Prices in other currencies

1. Find the item (filter: All items, Courses, Bundles, Lifetime plans; or search).
2. Click **Set prices**, type a fixed price for each currency you want (empty = no fixed price) and click **Save prices**.

Available currencies are the default currency plus USD, EUR, GBP, INR, AUD, CAD, SGD, AED and JPY. You can prepare prices while **Sell in several currencies** is off; buyers see them once it is on. Memberships that renew are always billed in their own currency, so only lifetime plans appear here. Buyers switch currency at checkout; the choice is remembered for a year.

### Tax report

The **Tax report** lists the tax charged on paid orders, newest first, marking refunded ones. Filter with **From**, **To** and **Country**, then **Apply** (or **Clear**). Totals per currency show the tax collected, the net amount and the amount charged. **Export CSV** downloads `tax-report-<date>.csv` with every matching order (the page shows the latest ones only).

---

## Abandoned checkout recovery (Round 3)

**What it is.** LearnLoop tracks checkouts that signed-in buyers start but do not finish, emails them reminders, and can add a single-use discount code to the last reminder. Buying the item stops the reminders.

**Who can use it.** Admins.

**Where.** `/admin/settings/plans?tab=checkouts` (the **Checkouts** tab of Plans, bundles & installments).

### Settings

| Field | Default | Rules |
|---|---|---|
| **Email buyers who don't finish their checkout** | On | Off: no reminders, but checkouts are still tracked for the report. |
| **Send reminders after (hours)** | 1, 24, 72 | Up to 5 times, whole hours from 1 to 720, counted from the buyer's last checkout visit. |
| **Discount in the last reminder (%)** | 10 | 0 to 90. A single-use code valid for 7 days. 0 sends no code. Memberships that renew never get one. |

1. Change the values and click **Save reminders**.
2. **Send due reminders now** sends whatever is due immediately instead of waiting for the next run.

Requirements: email must be on in Settings › Email (a warning with "Turn it on in Email" appears otherwise), and real delivery needs `MAIL_TRANSPORT=smtp` with the `SMTP_*` values in `.env`.

### The report

Numbers: **Checkouts started** (with the share that bought), **Abandoned** (and how many got a reminder), **Recovered** (bought after a reminder), **Recovered revenue**.

Filters: status (All checkouts, In progress, Abandoned, Purchased, Recovered), period (Last 7 days, Last 30 days, Last 90 days, All time) and a search box. Row menu: **Stop reminders** (for example when the buyer asked), **Copy email**, **View order**. Tick rows to stop reminders for several at once. **Export CSV** in the header.

Only signed-in buyers are tracked; guests cannot be reminded.

### Scheduled commerce upkeep (`/api/cron/commerce`)

Reminders, renewals and gift deliveries also run when admins open the relevant tabs, but to make them timely, have a scheduler call this address every hour:

```
GET or POST https://<APP_URL host>/api/cron/commerce?key=<cron key>
```

You can also send the key as a header: `Authorization: Bearer <cron key>`.

**Where to get the key.** It is the same key as the email cron. Open Settings › Email (`/admin/settings/email`), section **Scheduled delivery**, and copy the **Cron URL** (`…/api/cron/emails?key=…`). Replace `emails` with `commerce` in that URL. The key is derived from `APP_SECRET`; if you change `APP_SECRET`, update your scheduler.

Each run:

- keeps memberships current (payment due, ended, renewal orders, trial-ending reminders, missed gateway renewals read back);
- keeps installment plans current (reminders before and after due dates, access pauses with notices to the learner and admins, missed Stripe charges read back);
- emails scheduled gifts whose time has come;
- sends abandoned-checkout reminders (the last one with a coupon) and closes checkouts that were bought;
- folds old analytics events into daily totals (at most every six hours).

Example with cron on Linux (every hour):

```
0 * * * * curl -fsS "https://learn.example.com/api/cron/commerce?key=YOUR_KEY" > /dev/null
```

A wrong or missing key returns `401 Unauthorized`.

---

## Affiliates (Round 3)

**What it is.** Members share referral links and earn a commission on purchases they bring in. You approve affiliates and their commissions, watch for self-referrals, and record payouts.

**Who can use it.** Admins manage the programme. Members join from the **Affiliate** page in their sidebar (`/affiliate`) while the programme is on.

**Where.** `/admin/affiliates` (Settings › Content & marketing › **Affiliates**). Tabs: **Affiliates**, **Commissions**, **Payouts**, **Settings**.

### Program settings (Settings tab)

| Setting | Default | What it does |
|---|---|---|
| **Affiliate program** | On | Shows the Affiliate page to members and credits commissions on new sales. Off keeps existing commissions payable. |
| **Approve new affiliates automatically** | On | Members get their link as soon as they join. Off: every application waits for an admin. |
| **Default commission** | 20% | Percent of the net, tax-exclusive price for new affiliates (0 to 100). Change it per affiliate on their page. |
| **Referral window** | 30 days | A purchase is credited to the last affiliate link the buyer clicked within this many days (1 to 365). |

**Fraud checks** (applied automatically, listed on the same tab):

- Purchases through a member's own link never earn a commission.
- Commissions are flagged when the buyer signed in from an IP address the affiliate also used.
- Commissions are flagged when the buyer's email is the affiliate's account or payout email (ignoring +tags, and dots for Gmail).
- Refunds void unpaid commissions; refunds after a payout are deducted from the next one.

Flagged commissions that are still unpaid show a red banner at the top: "N unpaid commissions look like a possible self-referral. Review flagged commissions".

### How referral links work

An affiliate's link is any page of the site with `?ref=<CODE>` added, for example `https://learn.example.com/courses/modern-javascript-fundamentals?ref=MAYA20` (codes are 3 to 32 capital letters, numbers, dashes or underscores; affiliates build links on their own Affiliate page). The visitor's browser remembers the code (last click wins); a purchase within the referral window is credited to that affiliate. Clicks from bots are not counted.

### Affiliates tab

Numbers at the top: **Active affiliates** (with how many are awaiting review or paused), **Clicks (30 days)**, **Awaiting approval** (pending commission totals), **Payable** (approved, unpaid; with how much was paid so far).

1. Filter with the search box (name, email or code), **Status** (All statuses, Awaiting review, Active, Paused) and **Flagged only**, then click **Apply**.
2. The table shows **Affiliate**, **Code** (and commission %), **Clicks**, **Sales** (and conversion), **Payable**, **Status**.
3. Actions on a row: **Approve** (for applications), **Open details**, **Record payout** (when there is an approved balance), **Reactivate** (paused), and **Pause** or **Decline (pause)**. Pausing stops their links from crediting new sales; commissions already earned stay payable.

**An affiliate's page** (`/admin/affiliates/<id>`): numbers for **Clicks**, **Sign-ups**, **Sales**, **Payable**; the latest clicks with landing page and result (Visit or Purchase); **Affiliate settings** with **Referral code** (changing it stops old links from crediting them), **Commission** (applies to new sales), **Payout email** (empty uses the account email) and **Status**; and their payouts.

### Commissions tab

1. Filter by search (order, item, buyer or affiliate), status (All statuses, Pending, Approved, Paid, Void), from/to dates and **Flagged only**, then **Apply**.
2. New commissions start as **Pending**. Tick the ones you accept and click **Approve N**; approved commissions go into the affiliate's next payout.
3. Tick commissions you reject and click **Void**. Voided commissions are never paid; paid ones stay unchanged.

### Payouts

1. On the Affiliates tab, open a row's menu and click **Record payout** (or use the button on the affiliate's page).
2. Pick the **Currency** if they earned in several. **Amount to pay** is fixed: all approved commissions in that currency, after refund adjustments.
3. Choose **Paid with**: Bank transfer, PayPal, Wise, UPI, Store credit or Other.
4. Optionally add a **Reference** (transaction or transfer ID, shown to the affiliate).
5. Click **Mark <amount> as paid**. The commissions are marked paid and the affiliate is notified.

LearnLoop does not send the money; you pay through your bank or provider and record it here. The **Payouts** tab lists every payout (affiliate, date, method, reference, amount).

**Exports.** **Export CSV** in the header downloads the current tab: affiliates, commissions (with your filters) or payouts.

---

## Teams and B2B seats (Round 3)

**What it is.** Companies buy seats for their people. The team owner and managers invite members, who are enrolled in the team's courses; managers follow progress from **My team** (`/team`).

**Who can use it.** Admins manage every team here. Companies buy from the **For teams** page `/team/buy`. Owners and managers use `/team`.

**Where.** `/admin/teams` (Settings › User management › **Teams**). Tabs: **Teams** and **Settings**.

### Settings tab

**Sell team seats** (on by default): shows the "For teams" purchase page. Off stops new purchases; existing teams keep their seats and keep working.

### How team pricing works

One seat costs what the chosen courses cost together (only paid, published courses can be chosen; they must all be in one currency). A purchase can have 1 to 500 seats and up to 25 courses.

### Teams tab

Numbers: **Teams** (and how many are awaiting payment), **Seats** (and how many are not assigned yet), **Active members** (and open invitations), **Seat revenue**.

Filter by search (team or owner) and status (All teams, Active, Awaiting payment, All seats used), then **Apply**. The table shows **Team** (with owner), **Seats** (used of total, active and invited), **Courses**, **Paid**, **Status**, **Created**.

**Create a team yourself** (for customers paying by invoice or sponsored teams):

1. Click **New team**.
2. Fill in **Company or team name**, **Owner's account email** (they must already have an account; they manage the team), **Seats** (0 to 10,000) and **Courses for every seat**.
3. Click **Create team**. The owner then invites the members.

### A team's page

**Where.** `/admin/teams/<id>`. Tabs: **Overview**, **Seats**, **Progress**, **Orders**. **Manager view** opens the team as its managers see it (`/team?org=<slug>`).

On **Overview**:

- **Seats**: set the seat count by hand when an invoice is paid, or correct it, with a **Reason (kept in the audit log)**. It cannot go below the seats in use; managers are notified. Click **Save seat count**. Online orders add their seats automatically.
- **Courses**: choose the team's courses and click **Save courses**. Members are enrolled in courses you add; courses you remove stay with members who already joined them.
- **History**: seat changes, invitations and manager changes.
- **Team name**: rename.
- **Owner and managers**: **Add manager**, **Remove** a manager, or **Transfer** ownership. Managers invite members and see progress; the owner can also add managers.
- **Delete team**: revokes every seat (members lose access to the team's courses they have not finished) and removes the team. Orders stay in Transactions.

**Seats** lists every seat (active, invited, expired, revoked), **Progress** shows members' course progress, and **Orders** lists the team's orders with links to Transactions. **Export CSV** on the teams list downloads the teams matching your filters.

---

## Instructor marketplace (Round 3)

**What it is.** Outside instructors apply to teach, get the Course creator role when approved, publish courses and earn a share of the revenue of the courses they teach. You review applications, set revenue shares and record payouts.

**Who can use it.** Admins. Members apply at `/teach` (sidebar **Teach**) and see their earnings at `/teach/earnings`.

**Where.** `/admin/marketplace` (Settings › User management › **Instructors & payouts**). Tabs: **Instructors**, **Earnings**, **Payouts**, **Settings**.

> **Off by default.** Turn it on in the **Settings** tab before members can apply.

### Settings tab

| Setting | Default | What it does |
|---|---|---|
| **Marketplace** | Off | Credits approved instructors on new course sales. Off stops new earnings; unpaid earnings stay payable. |
| **Accept applications** | On | Shows **Teach** in the sidebar so members can apply from `/teach`. Approved instructors keep their Teach page even if you close applications. |
| **Default revenue share** | 70% | Suggested when approving a new instructor. Change it per instructor at any time. |

### Review applications (Instructors tab)

Numbers: **Instructors** (approved), **Awaiting review**, **Unpaid earnings** (and sales in the last 30 days), **Paid out**.

1. Filter by search (name, email or subject) and status (All statuses, Awaiting review, Approved, Declined or suspended), then **Apply**.
2. On an application, click **Approve**: confirm or change the **Revenue share** (percent of the net course revenue, after discounts, tax and refunds) and click **Approve instructor**. The member gets the Course creator role.
3. Or click **Decline**, write a **Reason** (sent to the member in a notification) and click **Decline application**. They can update their application and apply again.
4. For an approved instructor, **Suspend** (with a reason) stops new sales from earning for them. Unpaid earnings stay payable and their courses are not changed. **Approve** reinstates them.

**An instructor's page** (`/admin/marketplace/<id>`): status, revenue share, unpaid and paid totals; the **Application** (reason given, about, subjects, sample link and outline, profile); their **Earnings**; **Terms** (**Revenue share**, applying to new sales, and **Payout email**); **Payouts**; and the review and pay buttons.

### How earnings are calculated

Earnings are created for course sales only: a course order, a bundle, or a gift of either. The net order amount is split across its courses by list price, then shared among each course's approved marketplace instructors at their revenue share. Refunds create correcting entries.

### Earnings tab

Filter by search (course, instructor or order), instructor, course, status (All statuses, Unpaid, Paid, Void) and dates, then **Apply**. The table shows **Instructor**, **Course**, **Date**, **Net sale**, **Share**, **Status**. **Export CSV** downloads the matching earnings.

### Payouts tab

1. **Unpaid balances** lists instructors with money owed. Click **Pay** on one, or tick several and click **Pay selected**.
2. In the dialog, choose the **Currency**, **Paid with** (Bank transfer, PayPal, Wise, UPI, Store credit, Other), optionally **Sales up to** (pays only sales up to that day; leave it as today to pay everything) and a **Reference** (shown to the instructor). The amount is the unpaid balance after refund corrections.
3. Click **Mark as paid**. Each instructor's balance is marked paid with its own payout record.

You can also pay one instructor from their page with **Record payout**.

**Payout history** lists past payouts; **Export CSV** downloads them. As with affiliates, you send the money yourself; LearnLoop records it.

---

## Analytics (Round 3)

**What it is.** A built-in report of traffic, sales and learner retention from your own data, with no third-party trackers.

**Who can use it.** Admins.

**Where.** `/admin/analytics` (Settings › Content & marketing › **Analytics**).

### Choosing the period

Click **7 days**, **30 days** (default), **90 days** or **12 months**, or enter your own from/to dates. Dates are in UTC, and every trend compares with the same number of days just before.

### The key numbers

| Number | Meaning |
|---|---|
| **Visitors** | Unique visitors who accepted analytics cookies, plus each visit from visitors who did not (they cannot be told apart). The hint shows page views. |
| **Sign-ups** | New accounts created in the period. |
| **Conversion rate** | Orders divided by visitors. |
| **Net revenue** | Sales without tax, minus refunds, in your default currency (other currencies listed below it). |
| **Average order** | Average order value in the default currency. |
| **Refund rate** | Share of orders refunded, and the amount refunded. |
| **MRR** | Monthly recurring revenue from memberships right now (yearly plans count one twelfth; trials count nothing yet), and how many paying subscriptions. |
| **Active learners** | Members who learned something or signed in during the period. |

### The report sections

| Section | What it shows |
|---|---|
| **Trends** | Day-by-day visits, page views, sign-ups, orders and revenue. |
| **Funnel** | Visited the site → Viewed a course or offer → Started checkout → Purchased. Visitors without analytics consent count once per page view. |
| **Revenue by type** | Net revenue split by what was sold (Course, Bundle, Membership, Batch, Certificate, Gift, Team seats). |
| **Revenue by course, bundle and plan** | The top 10 items: orders, refunds and net. The CSV has all of them. |
| **Subscriptions** | MRR per currency with paying, trialing and past-due counts, revenue at risk, memberships cancelling at period end, and how many started and ended in the period. |
| **Top landing pages** | Where visits started. |
| **Top referrers** | Sites that sent visits (reduced to the host name; "Direct or unknown" otherwise), with sign-ups and sales credited to them. |
| **UTM campaigns** | Visits tagged with `utm_source`, `utm_medium` or `utm_campaign`, and the sign-ups and sales made within 30 days of such a visit. Add UTM tags to links in your emails and ads to compare them. |
| **Coupons** | Orders paid with each coupon, the discount given and net revenue. **Manage** opens Coupons. |
| **Affiliates** | Referral clicks, credited sales and commissions per affiliate. **Manage** opens Affiliates. |
| **Learner retention** | Members grouped by the week they signed up, and the share active (a lesson, an activity or a sign-in) in each later week, for the eight weeks up to the end of the period. Administrators are left out. |

Each section has a **CSV** button that downloads that section for the selected period (`analytics-<section>-<from>-to-<to>.csv`); **Daily CSV** in the header downloads the daily series.

If no page views were recorded, a note explains that traffic starts on the day tracking went live; sales, sign-ups and learner activity come from your records and are complete.

### Privacy and consent rules

- Page views are sent by the visitor's browser to `/api/analytics`. Nothing is sent when the browser asks not to be tracked (Do-Not-Track or Global Privacy Control).
- The visitor's choice in the cookie banner decides what is stored. With analytics consent, a page view carries an anonymous visitor ID and (when signed in) the member ID. Without consent (including visitors who have not decided yet), the page view is stored with no visitor or member ID: only the path, the referring site and campaign tags.
- Query strings are never stored, paths that could carry a secret (invitations, tokens) are reduced to their route, and referrers are reduced to the host name.
- Bots, link previews, uptime monitors and headless browsers are not counted.
- Raw events are kept for 90 days, then folded into daily totals without any visitor ID. The note at the bottom of the page shows the share of consented page views and how many raw events and daily totals are stored.
- The cookie banner is controlled by **Ask visitors for cookie consent** at `/admin/settings/legal` (Settings › Legal & compliance › Legal pages, section "Cookies and data retention"; on by default). When it is off, the banner is hidden but visitors can still choose from the "Cookie settings" link in the footer; until they accept analytics, their page views stay anonymous.
- Exporting any analytics section is recorded in the audit log.

---

## Points, levels and the leaderboard

**What it is.** Members earn points for learning activity, level up, and can be ranked on a leaderboard. You set how many points each activity is worth, adjust points by hand and rebuild everyone's points from history.

**Who can use it.** Admins configure it. Members see their points and level on their profile and dashboard, the board at `/leaderboard` and their history at `/leaderboard/points`.

**Where.** `/admin/settings/gamification` (Settings › Course configuration › **Points & leaderboard**). **View leaderboard** at the top opens `/leaderboard`.

### Ledger

The **Ledger** card shows when points were last awarded, **Points awarded**, **This month**, **Members with points**, **Ledger entries** (with how many are manual) and the **Biggest sources**. The first time you open the page on a site with history, points from earlier lessons, quizzes and certificates are filled in automatically; a yellow note shows while that is running or if it failed (it retries by itself).

### Settings

| Setting | Default | What it does |
|---|---|---|
| **Enable points and levels** | On | Off: no points are awarded and points, levels and the leaderboard are hidden everywhere. |
| **Show the leaderboard** | On | Adds the Leaderboard page with weekly, monthly and all-time rankings for signed-in members (and guests when guest access is on in Settings › Learning). |
| **Leave staff out of rankings** | On | Admins, moderators, course creators and evaluators still earn points for their own learning but are not ranked. Nobody earns points for courses, quizzes, assignments or exercises they manage, or results they grade or issue themselves. |

**Points per activity** (0 to 1000 each; 0 stops awarding points for that activity):

| Activity | Default | When |
|---|---|---|
| Lesson completed | 10 | Once per lesson |
| Quiz passed | 20 | The first time a quiz is passed |
| Perfect quiz score | 10 | Bonus for the first attempt that scores 100% |
| Assignment submitted | 10 | Once per assignment, on the first submission |
| Assignment passed | 25 | When an evaluator grades it as pass |
| Exercise solved | 25 | The first time every test case passes |
| Course completed | 100 | When every lesson is complete |
| Certificate earned | 50 | Once per certificate (taken back if revoked) |
| Learning day | 5 | Once per day with learning activity |
| Helpful reply | 5 | Replying to someone else's question, up to 10 replies a day |
| Course review | 10 | Once per course reviewed |

Save with the save bar. New values apply to future activity only.

### Recalculate points

**Recalculate points from history** rebuilds every member's points from completed lessons, quizzes, assignments, exercises, certificates, reviews, discussion replies and learning days, using the current values. Manual adjustments are kept.

1. Change the point values and save first.
2. Click **Recalculate**, then **Recalculate** in the confirmation ("Ranks may change").
3. A **Ledger rebuilt** summary shows **Entries** (and how many before), **Members**, **Points** and **Manual kept**.

It is disabled while points are switched off.

### Adjust a member's points

1. In **Adjust a member's points**, choose the **Member**.
2. Choose **Add** or **Deduct** and type the **Points** (up to 10,000 per adjustment).
3. Write a **Note** (shown to the member, e.g. "Winner of the June project challenge").
4. Click **Add points** or **Deduct points**. The member is notified, and it appears in their points history.

**Recent adjustments** lists the last 15; the undo icon (**Undo this adjustment**) removes one.

### Levels

Levels come from total points: level L starts at 50 × (L − 1)² points (level 2 at 50, level 3 at 200, level 5 at 800, level 10 at 4,050). Tier names: Beginner (level 1), Learner (3), Achiever (5), Expert (7), Master (10), Legend (15). The **Level tiers** card on the page shows them.

### The leaderboard

`/leaderboard` has **week** (resets every Monday), **month** (starts fresh on the 1st) and **all time** boards, and can be filtered by course. Guests can see it only when guest access is on. Each member sees their own points history at `/leaderboard/points`. Moderators and admins can open anyone's history with `/leaderboard/points?member=<username>` (for example `?member=alex`).

---

## Badges

**What it is.** Achievement badges awarded automatically by rules (enrollments, completions, quiz scores, assignments, certificates, streaks) or by hand.

**Who can use it.** Admins. The **Badges** feature switch in Settings › Features must be on for members to see badges (the page tells you when it is off).

**Where.** `/admin/settings/badges` (Settings › Course configuration › **Badges**). Tabs: **Badges** and **Awarded** (`?tab=assignments`).

### Create or edit a badge

1. On the **Badges** tab, click **New badge** (or the pencil icon on a row).
2. Fill in **Title** (max 80 characters), **Description** and **Badge image** (a square SVG or PNG looks best).
3. Under **Award rules**, choose the **Event** and, where it applies, its threshold:

| Event | Threshold |
|---|---|
| Course enrollment | Number of enrollments (awarded once a learner has at least N) |
| Course completion | Number of completed courses |
| Quiz passed | Minimum score (%) |
| Assignment passed | Number of passed assignments |
| Certificate issued | none |
| 7-day streak | none (seven days of learning in a row) |
| 30-day streak | none |
| Manual assignment | none; never awarded automatically |

   Leave the threshold empty to use the default (1, or 0% for quizzes).
4. **Award only once**: a member can receive this badge just one time (otherwise it shows as "repeatable").
5. **Enabled**: disabled badges are never handed out automatically.
6. Click **Save**.

The list shows **Badge**, **Awarded for**, **Holders** and an **Enabled** switch. Deleting a badge removes it from everyone who holds it.

### Award or revoke a badge by hand

1. Open the **Awarded** tab.
2. In **Award a badge**, choose the **Member**, the **Badge** and the **Issued on** date.
3. Click **Award**. The member is notified immediately.
4. To take one back, find it in the list (search by name) and use **Revoke badge**, then **Revoke**.

**Demo data.** First Steps (first enrollment), Finisher (first completed course), Quiz Whiz (a quiz passed with 100%), On a Roll (7-day streak), Certified (a certificate).

---

## Limits and gaps in this part

- **No impersonation.** There is no "log in as this member".
- **Manual payments have no bank-details field.** Learners are told to use "the payment details shared by our team"; you must send those details yourself.
- **The commerce cron URL is not shown anywhere.** Build it from the email Cron URL in Settings › Email by replacing `emails` with `commerce`.
- **Payouts are records only.** Affiliate and instructor payouts are paid outside LearnLoop and recorded here.
- **Per-device sessions** are visible only to the member themselves; admins can only sign a member out everywhere.
- Round 3 features in this chapter have not yet been tried in a browser.
