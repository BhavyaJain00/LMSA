# Student handbook

This handbook explains how to use LearnLoop as a learner: how to create an account, find courses, get access (free or paid), learn in the lesson player, take quizzes and assignments, earn certificates and badges, and look after your account. It also covers what visitors (guests) can do before they sign up.

> **Status.** Features from rounds 1 and 2 were tested page by page in a browser. Features marked **(Round 3)** in this handbook are **built and covered by automated tests; not yet tried in a browser.**

The local address used in the examples is `http://localhost:3000`. Follow along with the demo student **Alex Johnson**: email `alex@learnloop.test`, password `password123`.

Your school may have changed the name, logo and colors, so you may see another name instead of "LearnLoop". Many features can be switched off by the administrator; when a feature is off, its menu links disappear and its pages answer "not found". This handbook says which switch controls each feature, so you can ask your administrator if something is missing.

## Contents

1. [Who this is for](#who-this-is-for)
2. [Signing in and your account](#signing-in-and-your-account)
3. [Your menu](#your-menu)
4. [What you can and cannot do](#what-you-can-and-cannot-do)
5. Tasks
   - Finding courses: catalog, search, categories, tags, instructors, blog, programs, batches, bundles, membership plans
   - Getting access: free enrollment, checkout, coupons, taxes and currency, order bumps, invoices, billing history, memberships, bundles, installments, gifts, team invitations, prerequisites
   - Learning: course page, lesson player, locked and scheduled lessons, the video player, captions and transcripts, notes, discussions, the Ask AI tutor, quizzes, assignments, peer reviews, coding exercises, batches and live classes, calendar export
   - Progress and rewards: progress, certificates, badges, points, leaderboard, community
   - Your account: dashboard, the You page, profile, settings, privacy, notifications, messages, affiliate programme, jobs board, managing a team
6. [Daily and weekly checklist](#daily-and-weekly-checklist)
7. [Troubleshooting and FAQ](#troubleshooting-and-faq)
8. [URL quick reference](#url-quick-reference)

---

## Who this is for

**Students.** Everyone who learns on the site has the **Student** role. It is the default role: every account created through the sign-up page gets it automatically, and so does every account an administrator or moderator adds without choosing another role. A member whose roles are all removed also falls back to Student.

**Guests.** Visitors who have not signed in can already do a lot: browse the course, batch and program catalogs, open free preview lessons, read the blog, look at bundles and membership plans, and verify certificates. Some of this depends on the **Allow guest access** switch (on by default). This handbook marks what guests can do.

**How you get the Student role.**

| How | Who does it | Where |
|---|---|---|
| Sign up yourself | You | `/register` (while sign-up is enabled) |
| Be added by the school | A moderator or admin | **Manage → Members → Add** (`/admin/members/new`) or **Import members** (`/admin/members/import`) |
| Through a team invitation (Round 3) | Your company's team manager emails you a link; you click **Create an account** on it, which opens the sign-up page and brings you back to accept the seat | `/join/<token>` |

**Other roles.** Course creators (instructors), evaluators, moderators and admins have their own handbooks. They can do everything a student can (they can also enroll and learn), plus their own tools. Only a moderator or admin can give you another role; you cannot request one from inside the app, except by applying to teach through the instructor marketplace (see [Teach on the site](#teach-on-the-site-round-3)) when it is switched on.

---

## Signing in and your account

This chapter covers everything about getting into your account and keeping it safe. Your profile, email preferences, privacy tools and other settings pages have their own task chapters later on ([Your profile](#your-profile), [Account settings](#account-settings), [Email notifications](#email-notifications), [Privacy and your data](#privacy-and-your-data)).

### Create an account

**What it is.** Self-service sign-up. Every new account gets the **Student** role.

**Where.** `/register`. Click **Sign up** in the top-right corner of any page, or **Create an account** under the log-in form ("New here? Create an account").

**Step by step.**

1. Open `/register`. The page is titled **Create your account**.
2. Fill in **Full name** (2 to 120 characters), **Email** and **Password**.
3. Watch the password checklist under the field: **At least 8 characters**, **Contains a letter**, **Contains a number**. A strength meter (Too weak, Weak, Fair, Good, Strong) gives tips such as "Don't include your name or email".
4. If the school has published legal pages (terms, privacy policy), the form says "By creating an account you agree to" followed by links to them.
5. Click **Create account**.
6. You are signed in straight away and see "Welcome to LearnLoop, *your first name*! We sent a confirmation link to *your email*."
7. You land on the **Learning goals** questionnaire (see below). If you came from a link that needed an account (for example a team invitation), you go back to that page instead.

**Settings that affect it.**

| Setting | Where (admin) | Effect |
|---|---|---|
| **Disable sign-up** | **Admin → Settings → Learning** | The page shows "Sign up is currently disabled. Please contact an administrator for an account." and the sign-up links disappear. |
| Sign-up page content | **Admin → Settings → Learning** | A short text shown above the form (for example a welcome note). |
| **Minimum password length** | **Admin → Settings → Security** | 8 by default, can be raised up to 64. |
| Legal pages | **Admin → Settings → Legal pages** | Published policies are linked under the form. |

**Good to know.**

- One email address can have only one account ("An account with this email already exists.").
- Your **username** is made from the part of your email before the `@`. If it is taken, `-2`, `-3` and so on is added. It appears in your profile address, for example `/user/alex`. You can change it later in **Edit profile**.
- At most 10 sign-ups per hour are accepted from one network address.
- If you are already signed in, `/register` sends you to your dashboard.

### Learning goals (the welcome questionnaire)

**What it is.** Four quick questions that tailor the course recommendations on your dashboard.

**Where.** `/persona`. You land here right after signing up. Later, open it from **Account settings → Learning preferences → Update goals** (or **Set goals**), the **You** page (**Learning goals**), the command palette ("Learning goals"), or **Update** on the **Learning goals** card of your own profile.

**Step by step.**

1. **How did you hear about LearnLoop?** Pick one: Search engine, Social media, Friend or colleague, YouTube, Newsletter or blog, My employer or school, AI assistant, Other.
2. **What best describes you?** Student, Career switcher, Working professional, Team lead or manager, Teacher or trainer, Founder or freelancer, Hobbyist, Other.
3. **Which industry are you in?** Software, Education, Finance, Healthcare, Marketing and media, Design and creative, Manufacturing, Retail and e-commerce, Government or non-profit, Other.
4. **What do you want to achieve?** Choose as many as you like: Get a job, Build projects, Learn a new skill, Get certified, Grow in my current role, Start a business, Teach others, Just exploring. Click **Next**.
5. On **You're all set**, choose where to start: **Browse courses**, **Join a live batch**, **Follow a program**, **Complete my profile** or **Go to my dashboard**. Your answers are saved when you choose.

Picking an answer in a single-choice question moves you to the next step automatically. Use the **Back** arrow to go back. **Skip for now** at the bottom leaves without answering; your dashboard then shows a **Tailor your recommendations** card with **Get started** until you answer.

**Good to know.** Your answers are private: your profile shows the **Learning goals** card only to you ("Only you can see this.") and to moderators.

### Confirm your email

**What it is.** A link emailed after sign-up that proves the address is yours.

**Where.** The link in the email opens `/verify-email?token=…`. To get a new link, go to **Settings → Security** (`/settings/security`) and click **Resend confirmation email**.

**Step by step.**

1. Open the confirmation email and click the link.
2. The page shows **Email confirmed** ("Thanks! *your email* is confirmed.") with **Continue to your dashboard**.
3. If you see **This link has expired** or **This link isn't valid**, click **Send a new link** (when signed in) or **Log in to get a new link**, then use **Settings → Security → Resend confirmation email**.

**Settings that affect it.** **Admin → Settings → Security → Require a confirmed email to enroll and purchase** (off by default). When it is on and your email is not confirmed:

- a banner **Confirm your email address** appears at the top of every page ("You'll be able to enroll in courses and make purchases once it's confirmed");
- you can still sign in, browse and open free preview lessons;
- enrolling in courses, batches and programs, buying anything, sending gifts and accepting checkout offers are blocked until you confirm.

**Good to know.**

- A link works for 24 hours. Only the newest link works.
- You can request at most 3 confirmation emails per hour.
- Resetting your password with an emailed link also confirms your address.
- If an administrator created your account, the address counts as confirmed already ("This address was added by your organisation and doesn't need confirming.").
- On a local copy without email set up, the link is printed in the terminal where the app runs.

### Log in

**Where.** `/login`. Click **Log in** in the top-right corner, or **Log in** on the phone tab bar. Pages that need an account send you here automatically and bring you back afterwards (the address then contains `?next=…`).

**Step by step.**

1. Enter your **Email** and **Password**.
2. Click **Log in**.
3. If you use two-step verification, enter your code on the next screen (see below).
4. You land on the page you were trying to open, or on your **Dashboard** (`/dashboard`).

The page also lists the demo accounts ("Demo accounts (password: password123)"). The demo student is `alex@learnloop.test`.

**Messages you may see.**

| Message | Meaning |
|---|---|
| "Incorrect email or password." | Either is wrong. The site never tells you which, so nobody can find out who has an account. |
| "This account has been disabled. Contact support." | An administrator disabled your account. Only an admin can enable it again. |
| "Too many failed sign-in attempts. For your security, sign-in is paused for …" | Your account is locked for a while (see [Locked out](#locked-out-and-too-many-attempts)). |
| "Too many sign-in attempts. Please wait … and try again." | Too many tries from your network in a short time. |

**Good to know.** The language picker and the light/dark button sit in the top-right corner of all sign-in screens. You stay signed in for 30 days (the server setting `SESSION_DAYS`) unless you log out.

### Two-step verification

**What it is.** After your password, sign-in also asks for a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password, Authy and similar). Ten one-time recovery codes get you in if you lose your phone. For students it is optional.

**Where.** Set it up in **Settings → Security** (`/settings/security`; also **Security** in the account menu). At sign-in the code is asked on `/two-factor`.

**Turn it on.**

1. Open **Settings → Security** and find the **Two-step verification** card.
2. Click **Set up two-step verification**.
3. **Scan the QR code** with your authenticator app. If you can't scan, click **Can't scan it? Enter the key instead** and type the **Setup key** into the app (Type: "Time-based (TOTP), 6 digits, every 30 seconds"). **Copy key** copies it.
4. Type the 6-digit code from the app into **Code from your authenticator app** and click **Turn on two-step verification**.
5. **Save your recovery codes**: click **Download .txt** or **Copy all** and store them in a password manager or print them. They are shown only once.
6. Tick **I've saved these codes somewhere safe** and click **Done**.

**Sign in with it.**

1. Log in with your email and password as usual.
2. On **Two-step verification**, type the **Authentication code** from your app and click **Verify and sign in**.
3. No phone? Click **Use a recovery code** and type one of your saved codes. Each code works once; a message tells you how many are left.
4. **Cancel** takes you back to the log-in page.

**Manage it later** (same card on **Settings → Security**):

- **New recovery codes** (or **Generate recovery codes** when you have none): makes a fresh set of 10; the old ones stop working. The card warns you when few are left.
- **Turn off**: asks for your **Password** and a code from the app (or **Use a recovery code instead**). Click **Turn off**, or **Keep it on** to cancel.

**Settings that affect it.** **Admin → Settings → Security → Allow two-step verification** (on by default). If it is off, the card says "Two-step verification isn't available on LearnLoop right now." **Require two-step verification for staff** does not apply to students.

**Good to know.**

- The code step expires after 10 minutes ("Your sign-in attempt expired"). After 5 wrong codes on one attempt you have to log in again.
- If codes keep failing, check that the time on your phone is set automatically.
- Lost your phone and your recovery codes? Ask an administrator to **Reset two-step verification** for you. You are then signed out everywhere and can set it up again after signing in with your password.

### Forgot your password

**Where.** `/forgot-password` (the **Forgot password?** link next to the password field on the log-in page). The emailed link opens `/reset-password?token=…`. When signed in, **Settings → Security → Password** also has a **Reset it by email** link.

**Step by step.**

1. On the log-in page click **Forgot password?**.
2. Enter your email and click **Send reset link**.
3. The page says **Check your email**. It says this whether or not the address has an account, to protect privacy. **Send again** sends another link.
4. Open the email and click the link.
5. On **Choose a new password**, fill in **New password** and **Confirm new password**.
6. Click **Reset password and sign in**. You see "Your password was reset and you're signed in." If you use two-step verification, you are asked for a code first.

**Good to know.**

- The link expires after 1 hour and works once. Requesting a new link cancels earlier ones ("Only the newest link works").
- At most 3 reset emails per address per hour.
- A reset signs you out on every other device, clears a lockout, confirms your email and sends you a security notice email.
- If the page says **This link was already used**, **This link has expired** or **This link isn't valid**, click **Request a new link**.

### Change your password

**Where.** **Settings → Security** → **Password** card → **Change password**, or the **Password** card on **Account settings** (`/settings`).

1. Type your **Current password**.
2. Type the **New password** twice (**Confirm new password**). **Show passwords** reveals what you typed.
3. Click **Update password**. You see "Password updated."

The new password must be different from the current one. Changing it signs you out on your other devices (this one stays signed in) and sends you a security notice email.

### Locked out and "too many attempts"

- After **8** wrong passwords or codes in a row, sign-in to your account is paused for **15 minutes**. The administrator can change both numbers in **Admin → Settings → Security**.
- To get in sooner, reset your password by email: that clears the lock at once. An administrator can also unlock you.
- Separately, the server limits how fast anyone can try: 10 tries for one email from one network in 15 minutes, 30 for one email from anywhere, 40 from one network.
- Every sign-in attempt on your account, successful or not, is listed under **Settings → Security → Recent sign-in activity** (the last 20). If something looks unfamiliar, change your password.

### Sign out

1. Click your avatar in the top-right corner and choose **Log out** (the last item), or
2. On a phone, tap the **You** tab and then **Log out** at the bottom of the page.

You land on the log-in page.

**Sign out other devices.** **Settings → Security → Signed-in devices** lists every browser where you are signed in ("This device" marks the current one). Click **Sign out** next to one device, or **Sign out other devices** to keep only this one. **Account settings → Sessions** has the same list with **Log out**, **Log out other sessions** and **Log out everywhere**.

### Language and colour mode

- **Language.** Choose English, Hindi, Spanish, French or Arabic (right-to-left) from **Language** in the account menu, the picker on sign-in pages, or the **Language** card on **Account settings**. When signed in, your choice is "Saved to your account and used on every device where you sign in". Menus, buttons and messages change; course content and articles stay in the language they were written in.
- **Colour mode.** The light/dark button in the header switches the theme. **Account settings → Appearance** (and the **You** page) offers **System** (match your device), **Light** and **Dark**. This applies to the current device only.

---

## Your menu

The screen has four parts: the **sidebar** on the left (a slide-out menu on phones, opened with the menu button), the **header** at the top (search, notifications bell, light/dark button, your avatar), the page itself, and a **footer**. On phones a **tab bar** sits at the bottom.

### The sidebar

The sidebar changes with who you are and with what the administrator has switched on. Items with a "Round 3" note are newer features.

**Main section**

| Menu item | Address | What it is for | Shown when |
|---|---|---|---|
| Dashboard | `/dashboard` | Your home: continue learning, streak, pending work | You are signed in |
| Courses | `/courses` | The course catalog | Courses feature is on |
| Batches | `/batches` | Cohorts with start dates, live classes and timetables | Batches feature is on |
| Programs | `/programs` | Learning paths made of several courses | Programs feature is on |
| Bundles | `/bundles` | Several courses for one price (Round 3) | Bundles are on and Courses is on |
| Membership | `/pricing` | Membership plans (Round 3) | Membership plans are on |
| Certified members | `/certified-members` | Directory of people who earned certificates | Signed in, and Certifications and Certified members are on |
| Jobs | `/jobs` | The jobs board | Jobs feature is on |
| Instructors | `/instructors` | The instructor directory (Round 3) | Courses is on, and you are signed in or guest access is allowed |
| Blog | `/blog` | Articles (Round 3) | The blog is switched on (in SEO settings) |
| Statistics | `/statistics` | Site-wide figures | Statistics is on, and you are signed in or guest access is allowed |
| Community | `/community` | Questions and discussions of your courses and batches | Signed in, Discussions is on, and Courses or Batches is on |
| Leaderboard | `/leaderboard` | Points ranking | Points are on and "show leaderboard" is on, and you are signed in or guest access is allowed |

**"You" section** (signed-in members only)

| Menu item | Address | What it is for | Shown when |
|---|---|---|---|
| Notifications | `/notifications` | Everything that happened for you; a number shows unread items | Notifications feature is on |
| Messages | `/messages` | Private messages (Round 3); a number shows unread messages | Direct messages are on |
| My team | `/team` | Manage your company's seats (Round 3) | You own or manage a team |
| Affiliate | `/affiliate` | Referral links and commission (Round 3) | The affiliate programme is on |
| Peer reviews | `/peer-reviews` | Reviews of classmates' work assigned to you (Round 3) | You have at least one peer review assigned |
| Gifts | `/gift` | Buy a course, bundle or plan for someone (Round 3) | Gifts are on |
| Teach | `/teach` | Apply to become an instructor (Round 3) | The instructor marketplace is on and accepts applications, or you are already an instructor |
| My profile | `/user/<your username>` | Your public profile | Always |

**Links section.** Appears when the administrator adds custom sidebar links, or a **Contact us** link when a contact address is set (it is, by default: `support@example.com`).

Students never see the **Manage** section; it belongs to staff.

**Collapse the sidebar.** On a computer, the collapse button at the bottom shrinks the sidebar to icons (**Collapse** / **Expand sidebar**).

### The header

| Item | What it does |
|---|---|
| **Search or jump to…** | Opens the command palette (also **Ctrl+K**, or **Cmd+K** on a Mac). See [Search](#search-and-the-command-palette). |
| Bell | The notifications bell (signed in, Notifications on). Shows the latest notifications with **Mark all read** and **View all**. |
| Light/dark button | Switches the colour mode. |
| **Log in** / **Sign up** | Shown to guests. |
| Your avatar | Opens the account menu (below). |

### The account menu

Click your avatar in the top-right corner. The menu shows your name, email and roles, then:

| Item | Goes to | Notes |
|---|---|---|
| Dashboard | `/dashboard` | |
| My profile | `/user/<username>` | |
| Edit profile | `/user/<username>/edit` | |
| Account settings | `/settings` | |
| Security | `/settings/security` | Password, two-step verification, devices |
| Email notifications | `/settings/notifications` | Which emails you get |
| Privacy & data | `/settings/privacy` | Download your data, cookies, delete account |
| Orders & invoices | `/billing/history` | |
| Membership | `/settings/subscription` | Only when membership plans are on, or you have a membership |
| Gifts | `/gift` | Only when gifts are on |
| You | `/you` | "Your account hub and shortcuts" |
| Language | Opens the language picker | |
| Log out | Signs you out | |

Staff also see **Admin**; students do not.

### On a phone

The bottom tab bar holds up to four tabs plus a last tab:

- **Signed in:** **Home** (`/dashboard`), **Courses**, **Batches** and **Notifications** (with **Programs** or **Jobs** filling in when one of these is switched off), then **You** (your avatar), which opens `/you`.
- **Guest:** **Courses**, **Batches**, **Jobs** and **Statistics** (or **Programs**), then **Log in**.

**The You page** (`/you`) is the phone-friendly account hub: your photo and name with **View profile**, **Dashboard** and **Edit profile** buttons; a **Pages** list with every sidebar item not already on the tab bar; and an **Account** list with **Notifications**, **Search**, **Account settings**, **Security**, **Email notifications**, **Calendar feed**, **Orders & invoices**, **Learning goals**, the colour mode choice and **Log out**.

### The footer

Public pages (catalog, course pages, blog) have a full footer: an email sign-up box for the newsletter, contact details, **Explore**, **Categories**, **Popular courses** and **From the blog** columns. Working pages show one line. Both have the legal pages, **Cookie settings** (when the cookie banner is on), **Sitemap** (`/sitemap`, a list of every public page) and a language picker.

### Search and the command palette

**What it is.** One search box for the whole site.

**Where.** Click **Search or jump to…** in the header, press **Ctrl+K** (**Cmd+K** on a Mac), or tap **Search** on the **You** page.

**Step by step.**

1. Open the palette.
2. Without typing, it lists places you can jump to (the same items as your sidebar) and account shortcuts (**Account settings**, **Edit profile**, **Learning goals**; guests get **Log in** and **Create an account**).
3. Type at least 2 letters. Results are grouped: **Courses**, **In video transcripts**, **Batches**, **Programs**, **Jobs** and (signed in) **People**.
4. Pick a search category to search only there; **Backspace** in an empty box leaves the category.
5. Use the arrow keys and **Enter** to open a result, **Escape** to close.

**Good to know.** "In video transcripts" finds words spoken in lesson videos you are allowed to open; clicking a result starts the video at that moment. Only published courses, batches and programs appear.

---

## What you can and cannot do

**Legend.** **Yes** = allowed. **Guest\*** = allowed for visitors who are not signed in while **Allow guest access** is on (the default); otherwise they are asked to log in. **Enrolled** = only for courses or batches you have joined. Features the administrator switched off are hidden for everyone.

| Area | Guest | Student |
|---|---|---|
| Landing page `/` | Yes | Sent to the default home page (the course catalog by default) |
| Course, batch and program catalogs, course pages, category and topic pages | Guest\* | Yes |
| Free preview lessons | Guest\* | Yes |
| All lessons, quizzes, assignments and exercises of a course | No | Enrolled |
| Enroll in a free course, buy a paid one | No (log in first) | Yes |
| Jobs board, instructor directory, statistics, leaderboard | Guest\* | Yes |
| Blog, bundles, membership plans, legal pages, certificate verification, sitemap, developer docs | Yes | Yes |
| Redeem a gift code (`/redeem`) | Can open it; must log in to redeem | Yes |
| Accept a team invitation (`/join/<token>`) | Can open it; must log in or sign up to accept | Yes |
| Dashboard, notifications, messages, your profile, account settings, orders | No | Yes |
| Community, certified members, points history | No | Yes |
| Ask the AI tutor | No | Enrolled, when the tutor is on |
| Take quizzes, submit assignments and exercises | No | Enrolled |
| Review classmates' work (peer review) | No | When assigned to you |
| Read course reviews | Guest\* | Yes |
| Write a course review, post in lesson and batch discussions | No | Enrolled |
| Post a job and manage your own postings, apply to jobs | No | Yes |
| Affiliate programme, buy gifts | No | Yes (when switched on) |
| Apply to teach (instructor marketplace) | No | Yes (when switched on) |
| My team (`/team`) | No | Only if you own or manage a team |
| Send direct messages | No | To the instructors of your courses and batches; to classmates only when the admin allows learner-to-learner messages |
| Build courses, grade work, issue certificates, see other people's submissions | No | No (staff roles) |
| See other members' email addresses, private learning goals, admin pages | No | No |
| Change your own roles or email address | No | No (ask a moderator or admin) |

If you open a page you are not allowed to see, you get either the log-in page (for guests), **No permission** (`/forbidden`: "Ask an administrator to grant you the required role, or go back to your dashboard"), or the "not found" page (for switched-off features, unpublished content and wrong addresses).

---

**Tasks, part A: finding something to learn.** The task chapters start here. Each one says what the feature is, where it lives, how to use it step by step, which administrator settings change it, and what is good to know.

## The home page

**What it is.** The front page for visitors who are not signed in. It shows a welcome banner, site statistics, popular and upcoming courses, categories, live and upcoming batches, how learning works, learner reviews and a sign-up box.

**Where.** `/`. Signed-in members never see it: they go straight to the **default home page**, which is the course catalog (`/courses`) unless the administrator chose the dashboard (**Admin → Settings → Learning → Default home page**).

**Step by step (guest).**

1. Open `http://localhost:3000/`.
2. Click **Browse courses** or **Explore the catalog** to see every course.
3. Click **Get started for free** or **Create your free account** to sign up, or **Log in**.

**Good to know.** When **Allow guest access** is off, the buttons read **Log in to browse courses** and the page does not list individual courses or batches.

## The course catalog

**What it is.** The list of every published course, with search, filters and sorting.

**Where.** `/courses`, the **Courses** item in the sidebar (or the **Courses** tab on a phone).

**Step by step.**

1. Open **Courses**. The page is titled **All courses**.
2. Pick a tab at the top:

   | Tab | Shows | Who sees it |
   |---|---|---|
   | **Live** (default) | Published courses open for enrollment | Everyone |
   | **Upcoming** | Announced courses that open soon | Everyone |
   | **New** | Courses published in the last 30 days | Everyone |
   | **Enrolled** | Courses you are enrolled in, with your progress | Signed-in members |

3. Type in **Search courses** ("Search by title, topic, tag or instructor").
4. Open **Filters** to narrow down: **Category** (with the number of courses in each), **Certification available** ("Show only courses that come with a certificate") and **Sort by**: **Newest**, **Most popular**, **Highest rated** or **Title A–Z**.
5. Active filters show as chips; remove one with its **x**, or use **Clear all**.
6. At the bottom, choose how many to **Show** per page (24, 60 or 120) and load more.
7. Click a course card to open the course page.

**What a course card shows.** Cover image, title, instructors, rating, number of lessons and students, the price (or **Free**), and badges such as **Upcoming**, **Featured**, **Offers a certificate** or **Coming soon**. On courses you are enrolled in it shows "*N*% completed", **Completed**, or **Get certified**.

**Settings that affect it.**

- **Admin → Settings → Features → Courses**: when off, the page says "Courses are not available".
- **Admin → Settings → Learning → Allow guest access**: when off, guests see **Log in to browse courses** ("The LearnLoop catalog is available to members.").
- **Admin → Settings → Features → Certifications**: hides the certification filter when off.

**Good to know.** The filters are part of the address, so you can bookmark or share a filtered list, for example `/courses?category=web-development&sort=rating` or `/courses?tab=enrolled`.

## Categories and topics

**What it is.** Landing pages that group courses by subject (category) and by tag (topic).

**Where.**

| Page | Address | How to get there |
|---|---|---|
| All categories | `/courses/category` | **All categories** in the footer, or a category link on a course page |
| One category | `/courses/category/<slug>` | Click a category |
| All topics | `/courses/tag` | **All topics** on a category page |
| One topic | `/courses/tag/<tag>` | Click a tag on a course page |

**Step by step.**

1. Open **Course categories** (`/courses/category`) and pick a subject.
2. A category page shows an introduction, **Popular *category* courses**, **All *category* courses** (sort by **Most popular**, **Newest** or **Top rated**), **Popular topics in *category***, **Who teaches *category***, related blog articles and **Explore other categories**.
3. A topic page lists **Courses about *topic***, **Related topics**, **Categories with *topic* courses** and **Articles about *topic***.

**Good to know.** Categories are created by the administrator (**Admin → Settings → Categories**). Topics come from the tags instructors put on their courses.

## Instructors (Round 3)

**What it is.** A directory of the people who teach, with a public page for each.

**Where.** `/instructors` (sidebar **Instructors**). Each instructor's page is `/instructors/<username>`.

**Step by step.**

1. Open **Instructors**.
2. Search by name, skill or subject ("Search by name, skill or subject").
3. Each card shows what they teach, their number of courses and learners, and their average rating.
4. Open a card to see **About *name***, **What *name* knows** (skills), **Courses by *name***, **Articles by *name*** and **More instructors**. **Full profile** opens their member profile.

**Settings that affect it.** Needs **Courses** on, and guest access for visitors. An instructor appears once their first course is published.

## Batches (cohorts)

**What it is.** A batch is a group of learners who take one or more courses together, with start and end dates, live classes, a timetable, assessments, announcements and discussions. Batches can be free or paid, online or in person, and may have a limited number of seats.

**Where.** `/batches` (sidebar **Batches**). A batch's page is `/batches/<slug>`.

**Step by step: browse.**

1. Open **Batches** (**All batches**).
2. Pick a tab: **Upcoming**, **Live** (running now), **Archived** (finished) or **Enrolled** (yours, when signed in).
3. Use **Search batches**, the **Category** filter and the certification filter ("List only the batches that come with a certificate").
4. Each card shows the dates, **Online** or **In person**, seats (**Full**, "*N* seats left") and the price.

**Step by step: look at a batch before joining.** The page shows the description, **Batch details** (dates, schedule, time zone, format), **Instructors**, **What's included** (courses, assessments, live classes, certificate, structured schedule) and the enroll panel on the right. How to join is explained in [Join a batch](#join-a-batch).

**Settings that affect it.** **Admin → Settings → Features → Batches** and **Live classes**; **Allow guest access** for visitors.

**Good to know.** Batch times are shown in the batch's time zone, with "Your time" converted for you when it differs.

## Programs (learning paths)

**What it is.** A program groups several courses into a learning path. Some programs make you take the courses in order ("In order": each course unlocks when you finish the one before).

**Where.** `/programs` (sidebar **Programs**). A program's page is `/programs/<slug>`.

**Step by step.**

1. Open **Programs** (**All programs**).
2. Pick **Published** or **Enrolled** (yours), and use **Search programs**.
3. Open a program to see its courses, the number of members and whether the order is enforced.
4. Click **Join program** (guests see **Log in to join this program**). You see "Successfully enrolled in program".
5. On the program page, **Your courses** shows each course with **Start** or **Continue**, and **Program progress** ("*N* of *M* courses completed").

**Good to know.**

- Joining enrolls you right away in the courses you may start: the first course when the order is enforced, otherwise every course. A **paid** course in a program still has to be bought; a course with unfinished prerequisites waits until you complete them.
- In an ordered program, later courses show "Finish the previous course to open this one."
- When you finish every course you see "Congratulations on finishing the program!"

## Course bundles (Round 3)

**What it is.** Several courses sold together for one price, usually cheaper than buying each one.

**Where.** `/bundles` (sidebar **Bundles**). A bundle's page is `/bundles/<slug>`. A paid course that belongs to a bundle also shows "Also in *bundle*: *N* courses for *price*" under its buy button.

**Step by step.**

1. Open **Bundles** (**Course bundles**) and search if needed (bundles are also found by the courses inside them).
2. Open a bundle. You see **This bundle includes:** with each course and its **Price on its own**, the **Bundle price**, what it costs **Bought separately** and **You save**.
3. Click **Buy this bundle**. Guests are asked to log in or create an account first.
4. Complete the checkout (see [Buy a course, batch, certificate or bundle](#buy-a-course-batch-certificate-or-bundle)).
5. After payment you are enrolled in every course ("Everything unlocks"). The bundle page then says "You bought this bundle. Every course in it is yours for good." with **Continue learning** and **View your order**.

**Good to know.**

- One payment, no subscription; the courses stay yours.
- If you already own some of the courses, the page says so; the price stays the same.
- If you already own all of them: "You already have every course in this bundle, so there is nothing to buy."
- An unpaid order shows "You have an open order for this bundle" with **Complete your order**.

**Settings that affect it.** **Admin → Settings → Plans, bundles & installments**: bundles must be switched on and published. Default: on.

## Membership plans (Round 3)

**What it is.** A membership unlocks every course its plan includes (all courses, or a selection) for as long as it runs. Plans are monthly, yearly or lifetime, and may start with a free trial.

**Where.** `/pricing` (sidebar **Membership**). A paid course included in a plan also shows "Or get it with *plan* for *price*".

**Step by step.**

1. Open **Membership**. The page is titled "One membership, every course you need".
2. When both monthly and yearly plans exist, switch between **Pay monthly** and **Pay yearly** (the yearly toggle may show "Save *N*%").
3. Each plan card shows its price, what is included ("Every course in the catalog" or the listed courses) and its features.
4. Click the plan's button:

   | Button | When |
   |---|---|
   | **Start *N*-day free trial** | The plan has a trial and you have never had one |
   | **Join monthly** / **Join yearly** | Recurring plan, no trial for you |
   | **Get lifetime access** | One-time plan |
   | **Manage membership** | It is your current plan |
   | **Switch to this plan** | You already have another monthly or yearly plan |

5. Complete the checkout ([Start a membership](#start-a-membership)).

**Good to know (from the FAQ on the page).**

- Courses you bought separately, or joined through a batch, stay yours either way.
- Cancel any time from **Settings → Membership**; you keep access until the end of the period you paid.
- If a membership ends, your progress, notes, quiz results and certificates are kept; the included courses lock again until you rejoin.
- If a renewal payment fails, your courses stay open for 7 more days while it is retried or you update your payment method.
- A free trial is for first-time members only ("The free trial is for first-time members.").

**Settings that affect it.** **Admin → Settings → Plans, bundles & installments** (memberships on, plans active). Default: on. When nothing is on sale the page says "Memberships aren't available right now".

## The blog (Round 3)

**What it is.** Articles, guides and tutorials from the instructors.

**Where.** `/blog` (sidebar **Blog**). Articles live at `/blog/<slug>`; categories at `/blog/category/<slug>`; topics at `/blog/tag/<tag>`. An RSS feed is at `/blog/rss.xml`.

**Step by step.**

1. Open **Blog**.
2. Search with **Search articles**, or pick a category or topic.
3. Open an article. Long articles have an **In this article** table of contents. At the end you find **Topics**, **About the author**, sometimes **Frequently asked questions**, a course recommendation (**Learn it step by step**), **Share** buttons (**Copy link**, email, social networks) and **Keep reading**.
4. Sign up for new articles with the box "Enjoyed this article? Get the next one by email".

**Settings that affect it.** **Admin → Settings → SEO → Blog** (on by default). Articles are always readable by guests, even when guest access is off.

## Free lessons by email (newsletter)

**What it is.** A mailing list for free lessons, new courses and offers. It is separate from your account.

**Where.** `/free` ("Free courses and lessons"), the **Get free lessons by email** box in the footer of public pages, blog articles, and **Get the syllabus by email** on course pages ("Email me the syllabus").

**Step by step.**

1. Enter your **Email address** (and optionally your first name).
2. Tick the consent box ("I agree to receive emails with free lessons and offers…").
3. Click **Subscribe** (or **Send me free lessons**, **Email me the syllabus**).
4. You see **Check your inbox**. Click **Confirm my email** in the email. The confirmation page says **Your email is confirmed**.
5. To stop, click **Unsubscribe** in any of these emails (`/free/unsubscribe`).

**Good to know.** Your account's own emails are controlled separately in [Email notifications](#email-notifications).

## Site statistics

**What it is.** Platform-wide totals and trends: published courses, sign-ups, active members, course enrollments and completions, certified members, with daily charts.

**Where.** `/statistics` (sidebar **Statistics**).

**Settings that affect it.** **Admin → Settings → Features → Statistics**; guests see it only with guest access on.

## Sitemap, legal pages and certificate checks

| Page | Address | What it is |
|---|---|---|
| Sitemap | `/sitemap` | A readable list of every public page (footer link **Sitemap**) |
| Legal pages | `/legal/<slug>` | Privacy policy, terms, refund policy, cookie policy, once the administrator publishes them (footer links) |
| Verify a certificate | `/certificates` | Enter the certificate ID printed at the bottom of a certificate (for example `LL-7K2M-Q9ZX`) to check it is genuine; each certificate also has its own page `/certificates/<code>` |

