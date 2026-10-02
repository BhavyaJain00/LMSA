# Evaluator handbook

This handbook is for people who hold the **Evaluator** role in LearnLoop (inside the code the role is called `batch_evaluator`; it matches the "Batch Evaluator" role of Frappe LMS). It explains everything you can do with that role, where each tool lives, and exactly how to use it.

Some features in this handbook come from the third round of development (for example rubrics, peer review, direct messages and teams). Those features are built and covered by automated tests; not yet tried in a browser.

Local address used in the examples: `http://localhost:3000`. On a live site, replace it with your own domain.

## Contents

1. Who this is for
2. Signing in and your account
3. Your menu
4. What you can and cannot do
5. Tasks
   - The staff Overview page
   - Your dashboard as an evaluator
   - Setting your availability (Slots)
   - Taking time off (unavailability)
   - Your evaluation schedule
   - How learners book a certification evaluation
   - Running an evaluation and recording the result
   - Issuing and editing the certificate after a pass
   - Cancelling an evaluation
   - Certificates area (list, issue, bulk issue)
   - Grading assignment submissions
   - Rubrics
   - Programming exercises and their submissions
   - Quizzes (what you can and cannot see)
   - Peer reviews
   - Batches you work with
   - Job openings
   - Notifications and calendar
6. Daily and weekly checklist
7. Troubleshooting and FAQ
8. URL quick reference

---

## 1. Who this is for

You are an **Evaluator** if an administrator or a moderator has switched on the **Evaluator** role on your account. On the role screens it is described as "Run batches and review and grade submissions" (member forms) and "Manage batches, review and grade submissions" (profile Roles tab).

As an evaluator you typically:

- publish the weekly times when learners can book a 30-minute certification evaluation with you,
- run those evaluations (usually a video call), record Pass or Fail with a rating and summary, and issue the certificate,
- grade assignment submissions and programming exercise submissions for the courses and batches you work with,
- help run batches (cohorts) that you are attached to.

### How someone becomes an evaluator

Only a **moderator** or an **administrator** can give the role. There are three places to do it:

| Where | Who can use it | How |
|---|---|---|
| **Manage > Members** (`/admin/members`), open the member (`/admin/members/[id]`) | Moderators and admins | In the roles form, tick **Evaluator** and save. |
| The member's profile, **Roles** tab (`/user/[username]/roles`) | Moderators and admins | Switch **Evaluator** on. The change saves straight away and the member gets a notification "You are now a Evaluator" style message ("&lt;name&gt; gave you the Evaluator role."). |
| **Members > Import** (`/admin/members/import`) or **Add member** (`/admin/members/new`) | Moderators and admins | In a CSV import, the roles column accepts `batch_evaluator`, `evaluator` or `batch evaluator`. |

Good to know:

- A member can hold several roles at once. Many evaluators are also students, instructors (course creators) or moderators.
- Admins automatically have every permission, including everything an evaluator can do.
- Moderators can also evaluate: most evaluator checks in the code accept "Evaluator **or** Moderator".

### How you get attached to courses and batches

Having the role is not the whole story. Some tools only show you the courses and batches you are linked to:

| Link | Who sets it | Where | What it gives you |
|---|---|---|---|
| **Course evaluator** | The course's instructors, or a moderator | Course editor, field for the evaluator on the course (see "How learners book a certification evaluation") | Learners on that course book evaluations with you only. |
| **Batch instructor** | Whoever manages the batch | Batch editor, **Instructors** field | You manage that batch, its members, timetable and live classes, and you can grade the assignments and exercises of its learners. |
| **Weekly slots** | You | `/user/[your-username]/slots` | On courses with no named evaluator, any evaluator with slots can be booked. |

The rest of this handbook explains each of these in detail.

> Demo note: the demo account **priya@learnloop.test** (password `password123`) is a good place to practise. Be aware that Priya holds **both** the Evaluator and the Moderator roles in the demo data, so she sees more than a pure evaluator would (for example **Members** and **Email outbox**). This handbook describes what the Evaluator role alone gives you, and points out where a moderator sees more.

---

## 2. Signing in and your account

The full walkthrough of signing in, profiles and settings is in the student handbook. Here is what matters for an evaluator.

### Sign in

1. Open `http://localhost:3000/login`.
2. Enter your email and password and sign in.
3. You land on your **Dashboard** (`/dashboard`). Your evaluator tools are in the **Manage** section of the sidebar.

Demo: `priya@learnloop.test` with password `password123`.

### Two-step verification (2FA)

- Any member can turn on two-step verification at **Settings > Security** (`/settings/security`).
- An administrator can make it compulsory for all staff (admins, moderators, course creators **and evaluators**). The switch is in **Admin > Settings > Security** (`/admin/settings/security`), and it is **off** by default.
- When it is on and you have not set it up yet, opening any page under `/admin` sends you to `/settings/security?required=2fa` first. Set it up there, and you are sent back to the page you wanted. Your profile's Slots and Schedule pages are not blocked by this rule.

### Your profile

Your public profile is at `/user/[your-username]` (sidebar: **You > My profile**). Because you hold the Evaluator role, your profile has two extra tabs. Only you, other evaluators and moderators can see them:

| Tab | URL | What it is |
|---|---|---|
| **Slots** | `/user/[your-username]/slots` | Your weekly availability for certification evaluations, and your "I am unavailable" dates. |
| **Schedule** | `/user/[your-username]/schedule` | A week calendar of every evaluation booked with you. |

Moderators and admins also see a **Roles** tab on every profile. You do not (unless you are also a moderator).

### Settings you will use

| Page | URL | Why it matters to an evaluator |
|---|---|---|
| Account settings | `/settings` | Name, photo, language, password. |
| Security | `/settings/security` | Two-step verification, signed-in devices. |
| Notifications | `/settings/notifications` | Which email copies of notifications you receive (for example certificate and grading emails). |
| Calendar | `/settings/calendar` | A personal calendar link. It includes **Evaluations**: "Ones you booked, and ones you run as an evaluator." It needs the server secret `APP_SECRET`; without it the page says calendar links are unavailable. |
| Privacy | `/settings/privacy` | Data export and account deletion requests. |

### Sign out

Open the account menu (your avatar, top right) and sign out. On **Settings > Security** you can also sign out of your other devices.

---

## 3. Your menu

The sidebar is built from the roles you hold. Items marked "feature on" disappear when an administrator turns that feature off in **Admin > Settings > Features** (`/admin/settings/features`). All of these features are on by default.

### Main section

These are the same for every signed-in member.

| Menu item | URL | Shown when | Purpose |
|---|---|---|---|
| Dashboard | `/dashboard` | Always | Your learning dashboard plus a "Teaching at a glance" card. |
| Courses | `/courses` | Courses feature on | Course catalog. |
| Batches | `/batches` | Batches feature on | Public batch (cohort) list. |
| Programs | `/programs` | Programs feature on | Learning programs. |
| Bundles | `/bundles` | Bundles switched on (growth settings) | Course bundles. |
| Membership | `/pricing` | Subscriptions switched on | Membership plans. |
| Certified members | `/certified-members` | Certifications and Certified members on | Public directory of certified learners. |
| Jobs | `/jobs` | Jobs feature on | Job board. |
| Instructors | `/instructors` | Courses feature on | Instructor directory. |
| Blog | `/blog` | Blog switched on (SEO settings) | Public blog. |
| Statistics | `/statistics` | Statistics feature on | Platform statistics. |
| Community | `/community` | Discussions feature on | Course and batch discussions. |
| Leaderboard | `/leaderboard` | Gamification and leaderboard on | Points ranking. |

### You section

| Menu item | URL | Shown when | Purpose |
|---|---|---|---|
| Notifications | `/notifications` | Notifications feature on | Your in-app notifications, with an unread badge. |
| Messages | `/messages` | Direct messages on (on by default) | Direct messages. As staff you can message any member. |
| My team | `/team` | You own or manage an organization | Team management. |
| Affiliate | `/affiliate` | Affiliates switched on | Affiliate programme. |
| Peer reviews | `/peer-reviews` | Someone handed you a peer review to write | Reviews you must write as a learner. |
| Gifts | `/gift` | Gifts switched on | Gift a course. |
| Teach | `/teach` | Instructor marketplace on | Instructor applications. |
| My profile | `/user/[your-username]` | Always | Your profile, including the **Slots** and **Schedule** tabs. |

### Manage section (your evaluator tools)

This section appears because you hold the Evaluator role.

| Menu item | URL | Shown when | Purpose |
|---|---|---|---|
| Overview | `/admin` | Always | Staff home page: key numbers, quick links, your upcoming evaluations and live classes. |
| Manage batches | `/admin/batches` | Batches feature on | Batches you created or teach, and **New Batch**. |
| Assignments | `/admin/assignments` | Always | All assignments, the grading queue and submissions. The badge counts every "Not graded" submission on the whole site. |
| Rubrics | `/admin/rubrics` | Always | Reusable scoring guides for assignments. |
| Exercises | `/admin/exercises` | Programming exercises feature on | Coding exercises and their automatically graded submissions. |
| Certificates | `/admin/certificates` | Certifications feature on | List, issue, bulk issue, publish and revoke certificates. |
| Job openings | `/admin/jobs` | Jobs feature on | Jobs you posted and their applicants. |

You will **not** see these Manage items unless you also hold another role: Manage courses, Manage programs, Quizzes, Question bank, Blog and AI review (course creators and moderators); Members and Email outbox (moderators); Settings (admins).

There is no menu item for your slots and schedule. Reach them from **My profile > Slots / Schedule**, from the **Overview** page ("Upcoming evaluations > My schedule"), or from the "Evaluations to run" line on your dashboard.

---

## 4. What you can and cannot do

"Any" means site-wide, not limited to your own courses or batches.

| Area | What you can do | Limit |
|---|---|---|
| Weekly availability (slots) | Add, change and delete your weekly slots; set "I am unavailable" dates | Your own only. Other evaluators' slots are read-only for you. |
| Evaluation schedule | See your bookings; record Pending, In Progress, Pass or Fail with a rating and summary; set the meeting link | Only bookings assigned to you. You can view other evaluators' schedules but not change them. |
| Certificate after a passed evaluation | Issued automatically on Pass; change Published, Template, Issue Date and Expiry Date | Bookings assigned to you. |
| Certificates area | Issue a certificate by hand, bulk issue for a batch, publish, unpublish, revoke | **Any** learner, course or batch. |
| Assignments | Create, edit and delete assignments; attach a rubric; turn on peer review | **Any** assignment on the site. |
| Assignment submissions | Read and grade (Pass, Fail, Not graded, Not applicable) with comments or a rubric | **Any** submission on the site. |
| Delete assignment submissions | No | Moderators only. |
| Rubrics | Create and duplicate; edit and delete rubrics you created | Other people's rubrics: view and duplicate only. |
| Peer reviews (staff view) | See progress, write or edit a review as instructor, reassign, add a reviewer, remove, hand out now, remind, export CSV | **Any** assignment with peer review. |
| Programming exercises | Create, edit and delete exercises; view every submission including hidden tests; re-run | **Any** exercise. Grading is automatic; there is no manual grade. |
| Delete exercise submissions | No | Moderators only. |
| Quizzes and quiz grading | No | Course creators and moderators only. |
| Batches | Create a new batch; fully manage batches you created or are an instructor of | Other batches: you can open their public page (even unpublished) but not manage them. |
| Courses | No course editing; no Manage courses menu | Course creators and moderators only. |
| Jobs | Post jobs; edit, close, delete and see applicants for jobs you posted | Your own jobs only. |
| Members and roles | No | Moderators and admins only. |
| Site settings | No | Admins only. |
| Direct messages | Message any member | Needs Messages switched on. |

---

## 5. Tasks

Each task below follows the same pattern: what it is, where it is, step-by-step instructions, the settings that affect it, and things that are good to know. The certification tasks come first because they are the heart of the evaluator role.

---

## 5.1 Set your weekly availability (Slots)

**What it is.** Your slots are the weekly time windows when learners may book a certification evaluation with you. Each window is cut into 30-minute bookable sessions. For example, Monday 10:00 to 12:00 gives four sessions: 10:00, 10:30, 11:00 and 11:30.

**Where.** `/user/[your-username]/slots`. Get there from **My profile > Slots**, or from the **Edit availability** button on your Schedule page.

**Step by step: add a slot**

1. Open `/user/[your-username]/slots`. The page title is **My availability** and it says "Times are in" followed by the platform time zone.
2. Click **Add Slot**. A new row appears.
3. In the row, pick the day (**Select day**), then the **Start Time**, then the **End Time**. Times move in 30-minute steps.
4. The slot saves by itself as soon as all three are filled in. You see "Slot added successfully".
5. Repeat for every day you are available. The header shows how many "bookable 30-minute slots per week" you offer.

To throw away a half-filled new row, click the **X** at its end.

**Step by step: change a slot**

1. On the same page, change the day, start time or end time of an existing row.
2. It saves by itself. You see "Availability updated successfully".

**Step by step: delete a slot**

1. Click the bin icon (**Delete slot**) at the end of the row.
2. Confirm **Delete slot** in the dialog "Delete this slot?".

Evaluations already booked inside that window are kept. Only future bookings stop being offered.

**Rules the system checks**

| Rule | Message you see if you break it |
|---|---|
| Start and end time are both required | "Please enter a value for Start Time" / "Please enter a value for End Time" |
| End must be after start | "Start Time cannot be greater than End Time" |
| A slot must be at least 30 minutes | "A slot must be at least 30 minutes long." |
| Two slots on the same day may not overlap | "Slot Times are overlapping for some schedules." |

**Settings that affect it**

- **Time zone.** Slot times are wall-clock times in the platform time zone, which is the server's time zone. The server administrator changes it with the `TZ` environment variable. Learners see the evaluation time in this zone, with a "Your time" hint in their own zone.
- **Certifications feature.** If an administrator turns Certifications off, learners cannot reach the booking page, but your Slots and Schedule tabs still work.

**Good to know**

- Learners can book up to **14 days ahead**. Sessions that already started today are never offered.
- A session that someone has booked is never offered to anyone else.
- Other evaluators and moderators can open your Slots page, but it is read-only for them ("Only the evaluator can change this availability."). The server does allow moderators to change anyone's slots, but the page only gives the controls to the owner.
- If a course has **no** named evaluator, every evaluator who has at least one slot can be booked for it. Adding slots therefore puts you on the booking list of every such course.

---

## 5.2 Take time off (I am unavailable)

**What it is.** A date range during which nobody can book you, for example a holiday. Your weekly slots stay as they are.

**Where.** The **I am unavailable** box at the bottom of `/user/[your-username]/slots`.

**Step by step**

1. Make sure you have at least one weekly slot. Without one, the box says "Add a weekly slot first, then you can block dates."
2. Pick the **From** date.
3. Pick the **To** date. Each date saves as soon as you pick it.
4. When both dates are set you see "Unavailable from [date] to [date]. No evaluations can be booked on these dates."
5. To remove the block, click **Clear**.

**Rules**

- From may not be after To: "Unavailable From Date cannot be greater than Unavailable To Date".
- Only one range can be active at a time. Setting a new range replaces the old one.
- With only one of the two dates filled in, nothing is blocked ("Set both dates to block bookings.").

**Good to know**

- Learners who open the booking dialog see a note that you are unavailable on those dates. If they try to book a blocked date anyway they get: "The evaluator of this course is unavailable from ... to .... Please select a date after ...".
- Bookings made **before** you blocked the dates are **not** cancelled. Your Schedule page warns you, for example "1 evaluation was booked in this range before it was blocked." Contact those learners (see 5.6).

---

## 5.3 Your evaluation schedule

**What it is.** A week calendar of every evaluation booked with you, plus counters and a list of evaluations that are over but still have no result.

**Where.** `/user/[your-username]/schedule`. Get there from **My profile > Schedule**, from **Overview > Upcoming evaluations > My schedule**, from the "Evaluations to run" line in the "Teaching at a glance" card on your dashboard, or from the link in a booking notification.

**What you see**

| Part | What it shows |
|---|---|
| Title | **My evaluation schedule**, with the hint "Click an evaluation to record the result and issue the certificate." |
| **Edit availability** button | Opens your Slots page. |
| Counters | **Upcoming** (still to happen), **Awaiting result** (time has passed, no result saved yet), **Passed**. |
| Unavailable banner | Your blocked dates, if any, with a **Show week** button. |
| "[n] evaluations waiting for a result" | A yellow box listing every evaluation that has ended but has no result. Deal with these first. |
| Week calendar | Seven days. Use **Previous**, **Today** and **Next** to move between weeks. Blocked days are hatched and marked **Unavailable**. |

Each booking shows as a card "[Learner]'s Evaluation" with the time, the course and a status badge:

| Badge | Meaning |
|---|---|
| Upcoming | Booked, not started yet. |
| Awaiting result | The 30 minutes are over and no Pass or Fail is saved. |
| Passed | You saved Pass. |
| Failed | You saved Fail. |
| Completed | Closed without a Pass or Fail evaluation row (rare). |

If a week is empty you see "No evaluations this week." and, when there is a later booking, a **Jump to the next one** link. Cancelled bookings are not shown.

**Good to know**

- You can open another evaluator's schedule (`/user/[their-username]/schedule`) because you are an evaluator. You can read their bookings but the dialog is read-only: "Only the assigned evaluator can record this evaluation." Moderators can record results for anyone.
- The **Overview** page (`/admin`) shows up to four of your upcoming evaluations as cards under **Upcoming evaluations**.

---

## 5.4 How learners book a certification evaluation

**What it is.** You do not create bookings yourself. Learners book them. Knowing how this works helps you answer their questions.

**Where (learner side).** The course's certification page, `/courses/[course-slug]/certification`. Learners reach it from the certification card on the course page.

**Who is allowed to book.** A learner can book only when all of these are true:

1. They are enrolled in the course.
2. They do not already have a certificate for that course.
3. **Either** the course has **Paid certificate** switched on and the learner has bought the certificate (button **Get certified**, which goes to `/billing/certificate/[course-id]`), **or** the learner is a member of a batch that has **Certification** switched on and contains this course.
4. They have no other upcoming evaluation for the same course.
5. For a batch with an **Evaluation End Date**, the chosen date is on or before that date. After it passes, the learner sees "Scheduling closed".

**Which evaluators they can book.**

| Course setup | Who appears in the booking dialog |
|---|---|
| The course has a named **Evaluator** | Only that person (if their account is enabled). |
| The course has no named evaluator | Every enabled evaluator (Evaluator, Moderator or Admin role) who has at least one weekly slot. The learner picks one from the **Evaluator** list. |

**How the course evaluator is set (by course staff, not by you).**

- In the course editor, **Details** tab: field **Evaluator** ("Grades certificate evaluations for this course."), with the option "No evaluator".
- In the course editor, **Settings** tab: when **Paid certificate** is switched on, the **Evaluator** field is required ("Learners book an evaluation with this person to earn the certificate.").
- Only people with the Evaluator, Moderator or Admin role can be picked. Moderators can create a new member straight from that list.
- When a paid certificate course has a named evaluator, the course page tells learners: "Finish the course, then book an evaluation with [your name] to earn a verified certificate."

**What the learner does**

1. On the certification page, under **Upcoming evaluations**, they click **Schedule**.
2. The dialog **Schedule your evaluation** opens. It shows the evaluator (or an **Evaluator** list when there are several) and **Available Slots** for the next 14 days.
3. They pick a 30-minute slot and click **Submit**.
4. They see "Your evaluation has been scheduled".

**What happens on your side**

- The booking appears on your Schedule page and Overview page.
- You get a notification: "[Learner] booked an evaluation", with the course and time, linking to your schedule.
- The booking gets a meeting link automatically. If you have ever saved your own link on a booking, that link is reused. Otherwise a placeholder room `https://meet.example.com/eval-...` is created, which is **not a real meeting room**. Replace it with your own video-call link (see 5.5).
- The same slot can never be booked twice, even if two learners click at the same moment.

**Good to know**

- If no evaluator has slots, learners see "No slots available for the selected course. No evaluator has published availability yet ...".
- Learners can cancel their own booking until it starts. You then get a notification "[Learner] cancelled an evaluation" (or "Evaluation cancelled: [course]" when they cancel from their dashboard card). The slot becomes free again.
- Free courses with a plain completion certificate (course setting **Enable certification** without **Paid certificate**) do not use evaluations at all: the learner claims the certificate after finishing 100% of the course.

---

## 5.5 Run an evaluation and record the result

**What it is.** The evaluation itself is a 30-minute call with the learner. Afterwards you record the outcome in LearnLoop. A **Pass** issues the certificate automatically.

**Where.** Your Schedule page (`/user/[your-username]/schedule`). Click the learner's card ("[Learner]'s Evaluation") to open the evaluation dialog.

**The evaluation dialog**

The left side shows the details:

| Item | Content |
|---|---|
| Email ID | The learner's email (click to write an email). |
| Course | Link to the course page. |
| Batch | Link to the batch, when the booking came through a certification batch. |
| Date, Time | The booked session. |
| Timezone | The platform time zone, plus "Your time" in your browser's zone. |
| Meeting link | A box to paste your own call link, with a **Save** button. |
| **Join Meeting** / **View Certificate** | Join Meeting opens the saved link. After a pass, View Certificate opens the certificate. |

The right side has the tabs **Evaluation** and, after a pass, **Certification**.

**Step by step: before the call, set your meeting link**

1. Open the booking.
2. Paste your video-call link (it must start with `http://` or `https://`) into **Meeting link**.
3. Click **Save**. You see "Meeting link saved".
4. The learner is notified: "Your evaluation meeting link was updated". Your future bookings will reuse this link.

**Step by step: run the call**

1. At the booked time, open the booking and click **Join Meeting**.
2. Let the learner walk you through their work.

**Step by step: record the result**

1. In the **Evaluation** tab, set the **Rating** (one to five stars).
2. Choose a **Status**:

   | Status | Use it when | Effect |
   |---|---|---|
   | Pending | Nothing decided yet | Saved as a draft. The booking stays open. |
   | In Progress | You started but have not finished | Saved as a draft. The booking stays open. |
   | Pass | The learner met the standard | Booking closes, certificate is issued at once. |
   | Fail | The learner did not meet the standard | Booking closes, learner is told they can book again. |

3. Write a **Summary** ("Strengths, gaps and next steps for the learner."). When Pass is selected the hint says "Passing issues the certificate automatically."
4. Click **Save**. You see "Evaluation saved successfully".

**Rules the system checks**

- For Pass or Fail the rating cannot be 0 ("Rating cannot be 0") and a summary is required ("Please add a summary of the evaluation.").
- The summary may be at most 5,000 characters.
- Only the assigned evaluator (or a moderator) can save: "You are not the assigned evaluator for this course and batch."
- A cancelled booking cannot be evaluated: "This evaluation was cancelled by the learner."

**What happens after Pass**

1. A certificate is created for the learner and the course (Published, template **Classic**, issue date today). It gets a code such as `LL-XXXX-XXXX`.
2. The learner gets the notification "Your certificate is ready" and, if badges are set up for it, a badge. Points are added when gamification is on.
3. The dialog switches to the **Certification** tab (see 5.6).
4. The learner's evaluation shows in **Evaluation results** on their certification page, with your name, the date, the rating and your summary.

**What happens after Fail**

- The learner gets "Your evaluation for [course] is complete" with your summary as the message (or "Unfortunately you did not pass this time. You can book another evaluation.").
- They can book a new evaluation. Each attempt keeps its own result, so the history is never overwritten.

**Settings that affect it**

- **Admin > Settings > Features > Certifications** must be on for learners to book.
- Gamification settings decide whether points are awarded for certificates.

**Good to know**

- You can change a saved result later by opening the booking again and saving a different status. Changing a Pass to Fail does **not** remove the certificate; revoke it in the Certificates area if needed (see 5.8).
- If a learner was already certified for the course (for example by hand), Pass does not create a second certificate.

---

## 5.6 Edit the certificate after a pass

**What it is.** After a pass you can adjust how the certificate is published.

**Where.** The **Certification** tab of the evaluation dialog on your Schedule page. The tab appears only after you saved Pass (or when the learner already has a certificate for the course).

**Step by step**

1. Open the passed booking and click the **Certification** tab.
2. Adjust the fields:

   | Field | Meaning |
   |---|---|
   | **Published** | On: anyone with the link can open the verification page, and the learner is listed on Certified members. Off: only the learner and staff can open it (the page shows "Unpublished · visible to you and staff"). The switch's hint reads "Let the learner see this certificate." |
   | **Template** | **Classic** (framed landscape sheet with a seal), **Modern** (bold side panel) or **Minimal** (understated, prints well in black and white). |
   | **Issue Date** | Defaults to today. |
   | **Expiry Date** | Optional. Must be after the issue date. |

3. Click **Save**. You see "Certificate saved successfully".
4. Click **View Certificate** to check the result at `/certificates/[code]`.

**Good to know**

- You cannot use this tab before a pass: "Mark the evaluation as Pass before issuing the certificate."
- The certificate shows you under "Evaluated by" on its public page.

---

## 5.7 Cancelling or moving an evaluation

**What it is.** Sometimes an evaluation cannot happen as booked.

**What you can do in the app**

- There is **no cancel button for evaluators** in the schedule or evaluation dialog. Only learners can cancel, from their certification page or their dashboard card, and only before the evaluation starts.
- To stop **new** bookings on certain dates, use **I am unavailable** (5.2). Existing bookings stay.

**Step by step: when you need to move a booking**

1. Open the booking on your Schedule page and note the learner's email.
2. Contact the learner (email, or **Messages** if direct messages are on) and ask them to cancel and book a new slot.
3. If the learner cannot do it, ask a moderator for help.

**Good to know**

- If the learner never shows up, record **Fail** with a summary that explains it, or leave the booking as it is. It then stays in the "waiting for a result" list on your schedule.

---

## 5.8 The Certificates area

**What it is.** A list of every certificate on the site, with tools to issue certificates by hand, issue them in bulk for a batch, and publish, unpublish or revoke them. Evaluators and moderators can use it. Course creators cannot.

**Where.** **Manage > Certificates** (`/admin/certificates`). The menu item needs the Certifications feature; the page itself opens even when the feature is off, and then shows a warning: "Certifications are turned off in Settings → Features. Existing certificates still verify, but learners can't earn new ones automatically."

**What you can do here applies to every certificate on the site**, not only to courses or batches you work with. Take care.

### See and filter certificates

1. Open `/admin/certificates`. The title shows the number of certificates.
2. The cards at the top show **Certificates issued**, **Issued this month** and **Certified learners**.
3. Filter with **Search** ("Search learner, email or ID"), **Course**, **Batch** and **Status** (Published, Unpublished, Expired).
4. The table shows **Learner**, **Course / Batch**, **Certificate ID**, **Issued** and **Status**.
5. Open the row menu (three dots) for:

   | Action | What it does |
   |---|---|
   | View certificate | Opens the public verification page `/certificates/[code]`. |
   | Copy link | Copies the full public link ("Link copied"). |
   | Publish / Unpublish | Shows or hides the certificate from the public and from Certified members. |
   | Revoke | Deletes the certificate. |

### Revoke a certificate

1. In the row menu choose **Revoke**.
2. Read the warning "Revoke this certificate?": the certificate "will be deleted and its verification link will stop working. This cannot be undone."
3. Click **Revoke**.

Points the learner earned for it are taken back, and the action is recorded in the audit log.

### Issue a certificate by hand

**Where.** **Issue certificate** button on `/admin/certificates`, or `/admin/certificates/new`.

1. Under **Learner**, search ("Search by name or email") and pick the person.
2. Under **Certificate for**, choose **A course** ("Requires the learner to be enrolled.") or **A batch** ("Requires the learner to be in the batch.").
3. For a course, pick the **Course**. If it is a free completion-certificate course and the learner has not finished it, tick **Issue even if the learner hasn't completed the course**.
4. For a batch, pick the **Batch**. Batches without certification are marked "(certification off)"; you can still issue for them.
5. Set the **Issue Date** (required) and, if needed, an **Expiry Date** ("Optional. Leave empty if it never expires.").
6. Optionally pick an **Evaluator** ("Shown as “Evaluated By” on the certificate."). The default is "No evaluator (show instructors)".
7. Pick a **Template**: Classic, Modern or Minimal.
8. Leave **Published** on to make it visible on the certified members page, or switch it off.
9. Click **Issue certificate**. You return to the list with the message "Certificate [code] issued to [name]".

**Messages you may see**

| Message | Meaning |
|---|---|
| "[Name] is already certified for the course [title]" | A course allows one certificate per learner. |
| "Certification cannot be issued as the member is not enrolled in this course." | Enroll the learner first. |
| "Certification cannot be issued as the member has not completed the course." | Completion-certificate course below 100%. Tick the override box if you are sure. |
| "Certification cannot be issued as the member is not enrolled in this batch." | Add the learner to the batch first. |
| "[Name] is already certified for the batch [title]" | One batch certificate per learner. |

### Issue certificates in bulk for a batch

**Where.** **Bulk issue** on `/admin/certificates`, or `/admin/certificates/bulk`. You can also start from a batch's **Generate Certificates** button.

1. On **Generate Certificates**, pick a batch card. Cards show "Certification on" or "Certification off", the dates and the number of students.
2. If the batch has certification off, you see "This batch doesn't issue certificates." Switch **Certification** on in the batch settings first (only the batch's managers can).
3. In the form, choose the **Course**: "Whole batch ([batch name])" for a batch certificate, or one of the batch's courses for a course certificate.
4. Optionally pick an **Evaluator**, set **Issue Date**, **Expiry Date**, **Template** and **Published**.
5. In **Students**, tick the learners. **Select completed only** ticks everyone at 100%. Each row shows the completion bar and a status: **Certified**, **Completed** or **In progress**.
6. Click **Generate certificates (n)**.
7. If everyone was certified you return to the list filtered on the batch. If some were skipped, the page lists who was issued and who was skipped, with the reason.

**Good to know**

- Bulk issue does not require 100% completion, so check the progress column.
- Every certificate sends the learner "Your certificate is ready" and may award a badge and points.
- The public certificate page shows staff a **Manage certificates** button that leads back here.

---

## 5.9 Grade assignment submissions

**What it is.** Assignments are tasks where learners hand in text, a link (URL) or a file. If the assignment has **Grade submissions** switched on, someone on the staff must mark each submission. As an evaluator you can grade **every** assignment submission on the site.

**Where.**

| Page | URL | Purpose |
|---|---|---|
| Assignments | `/admin/assignments` | All assignments. The description tells you how many submissions wait for grading. |
| Assignment Submissions | `/admin/assignments/submissions` | Every submission, with filters. |
| Grading queue | `/admin/assignments/submissions?status=not_graded` | Only submissions waiting for a grade. Linked from the Overview page ("Grading queue") and from "Waiting to be graded" on your dashboard. |
| One submission | `/admin/assignments/submissions/[id]` | Read and grade. |

**Step by step: work through the queue**

1. Open **Manage > Assignments** and click **Submissions**, or open the grading queue link above.
2. Filter by **Assignment**, **Member** and **Status** (Not graded, Pass, Fail, Not applicable).
3. Click a submission. The page is titled "Submission by [learner]".
4. Read the **Answer** (text, link or file). Open **Assignment: [title]** to reread the question. If the assignment has a **Model answer**, it is shown too.
5. Check the side panel: learner, **Submitted**, **Last updated**, **Evaluator** (who graded it last), **Graded**, **Course** and **Lesson**. Use **Open lesson** to see the lesson it belongs to.
6. Grade it (without a rubric, see below; with a rubric, see 5.10).
7. Click **Next to grade** to jump to the oldest submission still waiting.

**Grading without a rubric**

1. In the **Grading** box choose a **Grade**:

   | Grade | Meaning |
   |---|---|
   | Not graded | Waiting for a grade. The learner can still change their submission. |
   | Pass | Accepted. |
   | Fail | Not accepted. |
   | Not applicable | Ungraded practice. |

2. Write **Comments** in the editor ("What worked well, what to improve next time…"). Markdown formatting works.
3. Click **Save** (or press Ctrl+S / Cmd+S). You see "Grade saved". The **Save** button is greyed out until you change something; a "Not saved" badge shows unsaved changes.

**What the learner gets**

- When you set Pass or Fail: a notification "Your assignment [title] was graded: Pass" (or Fail) with your comments.
- When you only change comments or set another status: "The instructor has left a comment on your assignment [title]".
- Your comments show on the learner's assignment page under "Evaluator's comments".
- A pass can award a badge and points. Moving a grade away from Pass takes the points back.
- You are recorded as the **Evaluator** of the submission (unless it is your own submission).

**Resubmission rules**

- A learner can edit and resubmit while the status is **Not graded** or **Not applicable**.
- Once you set **Pass** or **Fail**, the learner can no longer change it: "This submission has been graded and can no longer be edited."
- To let a learner try again after a Fail, set the grade back to **Not graded** and explain why in the comments. The learner can then edit and submit again. (Only moderators can delete a submission so the learner starts fresh.)

**Settings that affect it**

- The assignment's **Grade submissions** switch ("Evaluators mark submissions Pass or Fail and leave comments. Turn this off for ungraded practice (status: Not applicable).").
- An optional submission window (start and end) on the assignment.
- Admin settings for points and badges (gamification).

**Good to know**

- New-submission notifications ("New assignment submission to grade") go to the **course's instructors**, or to the assignment's author when it has no course. A pure evaluator does not get them, so check the queue yourself every day.
- The **Assignments** menu badge counts every not-graded submission on the site. The **Pending grading** card on the Overview page only counts assignments in courses and batches linked to you, so the two numbers can differ.
- You cannot delete submissions (the **Delete submission** button is moderators only).

### Create or edit an assignment

Evaluators may also create and edit assignments.

1. Open `/admin/assignments` and click **New** (`/admin/assignments/new`, "Create an Assignment"), or click an existing assignment (`/admin/assignments/[id]`, "Edit Assignment").
2. Fill in the title, **Submission type** (what learners hand in), the optional course ("Optional. Links submissions to a course."), the **Question**, **Grade submissions**, an optional schedule, and **Show a model answer** with the **Model answer**.
3. Save.
4. The edit page also shows **Rubric & peer review** settings, the **Submissions** counts (Total, To grade, Passed, Failed) and **Used in** (lessons and batches that include it).

Deleting an assignment removes all its submissions for good ("The assignment and all of its submissions will be removed for good."). Do this only when you are sure, and preferably agree it with the course team first.

