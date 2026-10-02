# Guide for learners (students)

This chapter explains everything a student can do on LearnLoop: finding courses, getting access (free or paid), learning in the lesson player, taking quizzes and assignments, earning certificates and badges, and managing your account.

> **Status.** Features from rounds 1 and 2 were tested page by page in a browser. Features marked **(Round 3)** in this chapter are **built and covered by automated tests; not yet tried in a browser.**

Examples use the demo data. Sign in as the demo student **Alex Johnson** (`alex@learnloop.test`, password `password123`) to follow along. The default local address is `http://localhost:3000`.

## Where things are: the menus

### The sidebar

The left sidebar (a slide-out menu on phones) changes with who you are and which features the admin has switched on.

**Main section**

| Menu item | Address | Shown when |
|---|---|---|
| Dashboard | `/dashboard` | You are signed in |
| Courses | `/courses` | The Courses feature is on |
| Batches | `/batches` | The Batches feature is on |
| Programs | `/programs` | The Programs feature is on |
| Bundles | `/bundles` | Bundles are on and Courses is on (Round 3) |
| Membership | `/pricing` | Subscriptions are on (Round 3) |
| Certified members | `/certified-members` | You are signed in, and Certifications and Certified members are both on |
| Jobs | `/jobs` | The Jobs feature is on |
| Instructors | `/instructors` | Courses is on, and you are signed in or guest access is allowed (Round 3) |
| Blog | `/blog` | The blog is switched on in SEO settings (Round 3) |
| Statistics | `/statistics` | Statistics is on, and you are signed in or guest access is allowed |
| Community | `/community` | You are signed in, Discussions is on, and Courses or Batches is on |
| Leaderboard | `/leaderboard` | Gamification and "show leaderboard" are on, and you are signed in or guest access is allowed |

**"You" section** (signed-in members only)

| Menu item | Address | Shown when |
|---|---|---|
| Notifications | `/notifications` | The Notifications feature is on. A number shows unread notifications. |
| Messages | `/messages` | Direct messages are on (Round 3). A number shows unread messages. |
| My team | `/team` | You own or manage a team (Round 3) |
| Affiliate | `/affiliate` | The affiliate programme is on (Round 3) |
| Peer reviews | `/peer-reviews` | You have peer reviews assigned to you (Round 3) |
| Gifts | `/gift` | Gifts are on (Round 3) |
| Teach | `/teach` | The instructor marketplace is on and accepting applications, or you are already an instructor (Round 3) |
| My profile | `/user/<your username>` | Always |

A **Links** section appears at the bottom when the admin adds custom sidebar links, or a **Contact us** link when a contact URL or email is set.

### The account menu

Click your avatar in the top-right corner. The menu shows your name, email and roles, then:

| Item | Goes to |
|---|---|
| Dashboard | `/dashboard` |
| My profile | `/user/<username>` |
| Edit profile | `/user/<username>/edit` |
| Account settings | `/settings` |
| Security | `/settings/security` |
| Email notifications | `/settings/notifications` |
| Privacy & data | `/settings/privacy` |
| Orders & invoices | `/billing/history` |
| Membership | `/settings/subscription` (only when memberships are on, or you have one) |
| Gifts | `/gift` (only when gifts are on) |
| You | `/you` — "Your account hub and shortcuts" |
| Language | Opens the language picker |
| Log out | Signs you out |

Staff also see **Admin**. Students do not.

### On a phone

At the bottom of the screen there is a tab bar. Signed-in members see **Home** (`/dashboard`), **Courses**, **Batches** and **Notifications** (or **Programs** / **Jobs** when one of those is switched off), followed by a **You** tab. Guests see **Courses**, **Batches**, **Jobs** and **Statistics** (or **Programs**), followed by **Log in**.

<!-- Sections below are being filled in. -->
