# Instructor handbook (course creators)

This handbook is for people who build and teach courses on LearnLoop. It explains every tool a **Course creator** can use: where it is, what it does, and exactly how to use it, step by step. It also tells you what your learners see after each thing you do.

Where something works differently because you are also a **Moderator**, you will find a short note marked "If you are also a Moderator".

All addresses assume the default local address `http://localhost:3000`. On your own server, replace that part with your site address.

> **Status of newer features.** Features marked "(round 3)" in this handbook are built and covered by automated tests; not yet tried in a browser. They include: the course sales page builder, SEO title and share image, the AI tutor switch and the AI review queue, resumable uploads, adaptive streaming (HLS conversion), transcripts and automatic captions, scheduled publishing of courses and lessons, course duplication, lesson version history, rubrics, peer review, video analytics, the blog, and the instructor marketplace (Teach and Earnings).

## Contents

1. Who this is for
2. Signing in and your account
3. Your menu
4. What you can and cannot do
5. Tasks
   - The Overview page
   - The course list
   - Create a course
   - The course management page
   - Course settings
   - Review and publishing
   - Schedule a course to publish later
   - Duplicate a course
   - Export and import a course
   - Delete a course
   - Build the outline: chapters and lessons
   - Drip release schedules
   - Schedule a lesson to appear later
   - The lesson editor and its blocks
   - Video blocks
   - Lesson version history
   - Transcripts and captions
   - Course sales page builder
   - Quizzes
   - The question bank
   - Grading quiz answers
   - Assignments
   - Grading assignment submissions
   - Rubrics
   - Peer review
   - Coding exercises
   - Batches
   - Live classes
   - Programs
   - Certificates
   - The course dashboard
   - Course announcements
   - Video analytics
   - AI tutor review queue
   - Instructor marketplace: Teach and Earnings
   - Job openings
   - Blog posts
   - Talking with learners
6. Daily and weekly checklist
7. Troubleshooting and FAQ
8. URL quick reference

## Who this is for

You are a **Course creator** (internal name `course_creator`). The role's own description in the app is "Build and manage courses, chapters, and lessons".

As a Course creator you can:
- create courses, build their outline and lessons, and publish them after a Moderator approves them;
- build quizzes, questions, assignments, rubrics and programming exercises;
- grade the work your learners hand in;
- run batches (cohorts) with live classes, and build programs (learning paths);
- look after your learners: the course dashboard, announcements, video analytics, the AI tutor review queue.

You can only edit the courses you **created** or where you are listed as an **Instructor**. Other people's published courses you see as a learner would.

### How you get this role

| Who | Where | How |
|---|---|---|
| A Moderator or Admin | **Manage > Members** (`/admin/members`), then open the member | Switch on the **Course creator** role. |
| A Moderator or Admin | The member's profile, **Roles** tab (`/user/<username>/roles`) | Flip the **Course creator** switch. Changes save at once. |
| An Admin, through the instructor marketplace (round 3) | **Admin > Marketplace** (`/admin/marketplace`) | When an Admin approves your application to teach (sent from `/teach`), you automatically get the Course creator role. The marketplace is off by default. |

You can hold several roles at once. The common combination is **Course creator + Moderator**: a Moderator can manage every course, approve courses for publishing and manage members. A **Batch evaluator** ("Evaluator" in the app) grades work and runs certificate evaluations. An **Admin** passes every role check.

### Demo accounts

On a fresh install with demo data, all passwords are `password123`.

| Account | Roles | Courses they teach |
|---|---|---|
| `daniel@learnloop.test` (Daniel Okafor) | Course creator only | Python for Data Analysis (published), Startup Fundamentals (unpublished, Under review) |
| `maya@learnloop.test` (Maya Chen) | Course creator + Moderator | Modern JavaScript Fundamentals, React & Next.js: Build Production Apps (with Admin), Advanced TypeScript Patterns (Upcoming) |
| `alex@learnloop.test` (Alex Johnson) | Student | Use this to see what learners see. |

Daniel shows exactly what a plain Course creator sees. Maya shows the Course creator + Moderator combination.

## Signing in and your account

The full account guide is in the student handbook. Here is what matters for instructors.

### Sign in

1. Open `http://localhost:3000/login`.
2. Enter your email and password and sign in.
3. If you turned on two-step verification, enter the 6-digit code from your authenticator app (or a backup code) on the next screen.

### Two-step verification for staff

An Admin can switch on **enforce two-step verification for staff** at **Settings > Security** (`/admin/settings/security`). It is off by default. When it is on, and you have not set up two-step verification yet, any page under `/admin` first sends you to `/settings/security?required=2fa`. Set it up there (scan the QR code with an authenticator app, type the code, keep the backup codes), and you are taken on to the page you wanted.

This applies to you because Course creator is a staff role.

### Your account menu

Click your picture at the top right. Staff get an extra entry:

| Menu entry | Address | What it is for |
|---|---|---|
| **Dashboard** | `/dashboard` | Your learner dashboard (courses you take). |
| **My profile** | `/user/<username>` | Your public community profile. |
| **Edit profile** | `/user/<username>/edit` | Name, picture, headline, bio, location, skills, social links. |
| **Admin** | `/admin` | Your teaching start page (only shown to staff). |
| **Account settings** | `/settings` | Password, language, theme, sessions. |
| **Security** | `/settings/security` | Two-step verification and signed-in devices. |
| **Email notifications** | `/settings/notifications` | Which emails you get. |
| **Privacy & data** | `/settings/privacy` | Download or delete your data. |
| **Orders & invoices** | `/billing/history` | Things you bought. |
| **Log out** | | Signs you out of this browser. |

### Your public instructor page

Once you teach at least one published course, you get a public page at `/instructors/<username>`. It shows your name, headline, bio, location, skills and social links (all from **Edit profile**), your published courses, your learner count, your average rating (when reviews are on), your blog articles (when the blog is on) and other instructors in the same categories. You also appear in the **Instructors** directory at `/instructors`.

Keep your headline and bio up to date: they also appear on your course pages and on the sales page's **Instructor** section.

### Notifications you will get as an instructor

These arrive in **Notifications** (`/notifications`, the bell at the top) and, for some types, by email:

| Notification | When |
|---|---|
| "<course> was approved" / "Changes requested on <course>" | A Moderator reviewed your course. The second one carries their note. |
| "<course> is now live" | Someone else published a course you teach. |
| "<learner> enrolled in <course>" | A learner joined your course on their own or by buying it. It links to the course dashboard. |
| "New assignment submission to grade" | A learner handed in an assignment (that needs grading) in your course. |
| "Video ready: <lesson>" / "Video conversion failed: <lesson>" | A video finished converting to adaptive streaming. Failures also arrive by email. |
| "Transcript ready: <lesson>" / "Transcript could not be generated: <lesson>" | An automatic transcript finished. Failures also arrive by email. |
| "New question in <course>: <topic>" / "New reply on the topic ..." | A learner asked a question under a lesson, or replied in a thread. |
| "<name> mentioned you in a comment in <topic>" | Someone @-mentioned you. |

Choose which of these also come by email at **Email notifications** (`/settings/notifications`).

## Your menu

The sidebar on the left has up to four sections. The **Manage** section is your teaching toolbox. Several entries only appear when an Admin has switched the matching feature on at **Settings > Features** (`/admin/settings/features`). On a fresh install all of those features are on, except the AI tutor and the instructor marketplace.

### Manage section (what a Course creator sees)

| Menu entry | Address | Shown when | What it is for |
|---|---|---|---|
| **Overview** | `/admin` | Always | Your teaching start page: numbers, what's coming up, shortcuts. |
| **Manage courses** | `/admin/courses` | Always | Create, edit, publish, duplicate, import and export courses. |
| **Manage batches** | `/admin/batches` | Batches feature on | Cohorts with a start and end date, live classes and a timetable. |
| **Manage programs** | `/admin/programs` | Programs feature on | Learning paths made of several courses. |
| **Quizzes** | `/admin/quizzes` | Always | Build quizzes and grade written answers. |
| **Question bank** | `/admin/questions` | Always | The shared pool of quiz questions. |
| **Assignments** | `/admin/assignments` | Always | Build assignments and grade submissions. The number on the entry counts every assignment submission on the site that is waiting to be graded. |
| **Rubrics** | `/admin/rubrics` | Always | Grading rubrics for assignments (round 3). |
| **Exercises** | `/admin/exercises` | Programming exercises feature on | Coding exercises with test cases. |
| **Job openings** | `/admin/jobs` | Jobs feature on | Post jobs and read applications. |
| **Blog** | `/admin/blog` | Always | Write blog articles (round 3). |
| **AI review** | `/admin/ai` | Only when an Admin has turned the AI tutor on for the site | Check the AI tutor's answers in your courses (round 3). |

You do **not** see **Certificates**, **Members**, **Email outbox** or **Settings**.

> **If you are also a Moderator** you additionally see **Certificates** (`/admin/certificates`, when Certifications is on), **Members** (`/admin/members`) and **Email outbox** (`/admin/emails`). **Settings** is for Admins only.

### You section

| Menu entry | Address | Shown when |
|---|---|---|
| **Notifications** | `/notifications` | Notifications feature on (default). |
| **Messages** | `/messages` | Direct messages on (default). |
| **Peer reviews** | `/peer-reviews` | Only when someone assigned you a peer review to write. |
| **Teach** | `/teach` | The instructor marketplace is on and either applications are open or you already have an instructor profile (round 3). |
| **My profile** | `/user/<username>` | Always. |

Other entries in this section (**My team**, **Affiliate**, **Gifts**) are learner and buyer tools and are explained in the student handbook.

### Main section

The top section is the same for everyone: **Dashboard**, **Courses**, **Batches**, **Programs**, **Bundles**, **Membership**, **Certified members**, **Jobs**, **Instructors**, **Blog**, **Statistics**, **Community** and **Leaderboard** (each when its feature is on). Use them to see your work the way learners do.

### Other ways to get around

- **Search or jump to...** at the top (or Ctrl+K) opens the command palette. Type a page name or a course title.
- The **Admin** entry in your account menu also opens `/admin`.

## What you can and cannot do

"Yours" below means: a course you **created** or where you are listed as an **Instructor**. For batches the same rule applies (you created it or you are one of its instructors). For programs, only the ones you created.

| Area | As a Course creator | If you are also a Moderator |
|---|---|---|
| Create courses | Yes | Yes |
| Edit a course (details, outline, lessons, settings, sales page) | Yours only | Every course |
| See courses in **Manage courses** | Published courses plus yours. Other people's titles open the public page. | Every course |
| Submit a course for review | Yes, yours | Not needed |
| Approve a course or request changes | No | Yes |
| Publish | Yours, after a Moderator approved it | Any time (counts as approval) |
| Schedule publishing | Yours, after approval | Yes |
| Unpublish | Yours | Yes |
| Duplicate, export, delete a course | Yours | Every course |
| Import a course from JSON | Yes | Yes |
| Add a new category from the course form | Yes | Yes |
| Rename or delete categories | No (Admin, at **Settings > Categories**) | No (Admin) |
| Remove yourself as instructor | Only from a course you created | Yes |
| Enroll or remove learners in a course | Yours, from its **Dashboard** tab | Every course |
| Course announcements | Yours | Every course |
| Video analytics | Yours | Every course |
| Quizzes | Create; edit and delete quizzes you wrote or that belong to a course of yours. Delete only while nobody has taken them. | Every quiz, even with submissions |
| Question bank | Use every question; edit and delete only the ones you wrote | Every question |
| Grade quiz answers | Submissions in quizzes you manage, or made in your courses | Every submission |
| Assignments and coding exercises | Create, edit and delete **any** assignment or exercise (the library is shared by all staff) | Same |
| Grade assignments and exercises | Any submission | Any submission |
| Delete learners' submissions | No | Yes |
| Rubrics | Create; edit and delete your own; duplicate anyone's | Edit any |
| Peer review settings | Yes, on any assignment | Yes |
| Batches | Create; manage yours | Every batch |
| Live classes | In batches you manage | Every batch |
| Programs | Create; manage the ones you created | Every program |
| Issue, bulk-issue or revoke certificates | No (needs Moderator or Evaluator) | Yes |
| Be a course's certificate **Evaluator** | No (needs Evaluator or Moderator) | Yes |
| Blog | Write and edit your own articles | Every article |
| Job openings | Post jobs; manage your own | Every job |
| AI review queue | Answers in the courses you manage | Every course |
| Members, Email outbox, broadcasts, sequences | No | Yes |
| Site settings, payments, coupons, plans, marketplace admin | No (Admin only) | No (Admin only) |

**What you always can do inside your own courses:** open every lesson (even locked or scheduled ones), read private **Instructor notes**, use **Preview as student**, and see the **Add a transcript** link in the transcript panel.

## The Overview page

**What it is.** Your teaching start page. It shows your key numbers, what is coming up and shortcuts to everything you use.

**Where.** `http://localhost:3000/admin`. Click **Manage > Overview**, or **Admin** in your account menu.

**What you see.**

1. **"Hi, <your name>"** and a line about what is coming up, for example "Coming up: 2 live classes." Below it: "Numbers cover the courses and batches you teach."
2. Two buttons at the top right: **Statistics** (opens `/statistics`) and **Create course**.
3. **Key numbers**:

| Card | What it counts |
|---|---|
| **Courses** | Your courses, with "<n> published · <n> draft". |
| **Learners** | "Enrolled in your courses and batches". |
| **Enrollments this week** | New enrollments, compared with last week. |
| **Completions** | Finished courses and the completion rate. |
| **Revenue this month** | Payments this month, compared with last month. |
| **Pending grading** | Assignments and quizzes waiting for marks. Click it to open the grading queue. |
| **Courses under review** | Courses waiting for a Moderator ("Waiting for a moderator"). |
| **Published** | How many of your courses are live. |

4. **Quick links**: cards for **Courses**, **Batches**, **Quizzes**, **Question bank**, **Assignments**, **Grading queue** (`/admin/assignments/submissions?status=not_graded`), **Quiz submissions** ("Open-ended answers that need marks"), **Exercises** and **Statistics**. Cards for switched-off features are hidden.
5. **Upcoming live classes** (when you have any, with a **Manage batches** link), **Recent enrollments**, **Newest learners** and **Recent activity**.
6. **Courses created** and **Upcoming batches**. If you have neither, you see "No courses yet" with a **Create course** button.

> **If you are also a Moderator**: the numbers cover the whole site (the Learners card then shows new signups), **Courses under review** links to the review list, and you get extra quick links for **Programs**, **Certificates**, **Job openings** and **Members**.

## The course list

**What it is.** The list of courses you can work on.

**Where.** `/admin/courses`, from **Manage > Manage courses**.

**What you see.**

- Tabs: **All**, **Published**, **Unpublished**, **Under review** and **Mine** (courses you created or teach), each with a count.
- A search box: "Search by title, tag or instructor".
- A table (cards on a phone) with **Course**, **Status**, **Instructors**, **Lessons**, **Students**, **Price** and **Updated**.
- Status badges: **Published** or **Draft**, the review status (**In progress**, **Under review** or **Approved**), a schedule badge when a publish time is set, **Upcoming** and **Featured**.
- Buttons at the top right: **Import** and **New course**.

As a Course creator you see published courses plus your own. Click the title of your own course to manage it. The title of someone else's course opens its public page instead.

**The ... menu on each row** (you only see the items you may use):

| Item | What it does |
|---|---|
| **Edit details** | Opens the course's **Details** tab. |
| **Outline** | Opens the **Outline** tab. |
| **Dashboard** | Opens the **Dashboard** tab (learners and progress). |
| **Settings** | Opens the **Settings** tab. |
| **View course** | Opens the public course page `/courses/<slug>`. |
| **Export JSON** | Downloads the course as a file. |
| **Duplicate...** | Makes an editable copy. |
| **Publish** | Publishes the course (after approval). |
| **Schedule publish...** | Picks a time to publish automatically (unpublished courses only). |
| **Unpublish** | Takes a live course out of the catalog. |

> **If you are also a Moderator**: you see every course, every title opens its management page, and the menu also has **Approve** for courses under review.

## Create a course

**What it is.** A course is a set of chapters, and each chapter holds lessons. You first create the course "shell" (title, description, picture, instructors). Then you set prices and rules, build the outline and send it for review.

**Where.** `http://localhost:3000/admin/courses/new`. From the menu: **Manage > Manage courses**, then **New course**. The **Create course** button on `/admin` goes to the same page.

**Step by step.**

1. Click **New course**. The page is called "New Course".
2. Fill in **Course details** ("The basics learners see on the catalog card and course page"):
   - **Title** (required, up to 140 characters). Example: "Modern JavaScript Fundamentals".
   - **Slug**: the last part of the course address, `/courses/<slug>`. It is made from the title until you type your own. Use lowercase letters, numbers and single hyphens, up to 80 characters. The words `new`, `import`, `edit` and `learn` are reserved. If you leave it empty, a free slug is picked for you.
   - **Short introduction** (required, up to 300 characters): one or two sentences for the course card.
   - **Category**: pick one from **Select category**. To add a new one, click the **+** button ("New category"), type a **Category name** (2 to 50 characters) and click **Create**. It is selected straight away.
   - **Tags**: up to 12 tags, each up to 32 characters. Tags already used on other courses are suggested.
3. Write the **Course description** (required, up to 50,000 characters): "The long-form overview on the course page. Markdown is supported." The toolbar has **Bold** (Ctrl+B), **Italic** (Ctrl+I), **Heading**, **Bulleted list**, **Numbered list**, **Quote**, **Link** (Ctrl+K) and **Code** (Ctrl+E), plus a **Write** / **Preview** switch.
4. Fill in **Media**:
   - **Course thumbnail**: upload a PNG, JPG, GIF or WebP image, or paste an image link. The hint says: "Use a 750×422 JPG, GIF or PNG. It appears on the catalog card and at the top of lessons."
   - **Color**: the background colour of the card when there is no thumbnail. The **Card preview** shows how it will look.
   - **Preview video**: "Self-hosted MP4/WebM or a direct video file URL. YouTube and Vimeo links are not supported."
5. Fill in **Instructors & evaluation**:
   - **Instructors** (required): "Instructors can edit this course and see its dashboard." Only Course creators, Moderators and Admins are listed. If you leave it empty when creating, you are added automatically.
   - **Evaluator** (optional): "Grades certificate evaluations for this course." Only Evaluators, Moderators and Admins are listed. A paid certificate needs one.
6. Add **What learners will learn** ("Shown as a checklist on the course page") and **Requirements** ("What learners should know or have before starting"). Up to 20 lines each, 200 characters per line.
7. Pick **Related courses** (up to 12): "Suggested on the course page. Only published courses are shown to learners."
8. Click **Create course** in the bar at the bottom (or press Ctrl+S).

You land on the new course's **Settings** tab with the message "Course created successfully".

**Settings that affect it.**
- A new course starts as **Draft**, status **In progress**: free, not featured, not upcoming, self enrollment on, no certificate.
- Its currency starts as the site's default currency (set by an Admin).

**Good to know.**
- While you have unsaved changes, a **Not Saved** badge shows in the bottom bar and the browser asks before you leave.
- You can change everything later on the **Details** tab; press **Save** there.
- Changing the slug later is safe: the old address redirects to the new one.
- On a course you did not create, you cannot remove yourself from the instructors ("You can't remove yourself from the instructors of this course.").

> **If you are also a Moderator**: the Instructors and Evaluator pickers have **+ Add New Member...**, which creates an account on the spot and adds that person to the course.

**What learners see.** Nothing yet. A new course is a draft and is not in the catalog until it is published.

## The course management page

**What it is.** One page per course where you edit everything about it.

**Where.** `/admin/courses/<course id>`. Click a course title in **Manage courses**.

**The header** shows the title, the badges (**Published** or **Draft**, the review status, **Upcoming**, **Featured**), the address `/courses/<slug>` and these buttons:

| Button | What it does |
|---|---|
| **View course** | Opens the public course page. |
| **Sales page** | Opens the sales page builder (round 3). |
| **Submit for review**, **Publish**, **Unpublish** | The review and publishing steps you may take right now. |

**The tabs.** The tab is part of the address, so you can bookmark it.

| Tab | Address | What you do there |
|---|---|---|
| **Details** | `/admin/courses/<id>` | The same form as "New course". |
| **Outline** | `?tab=outline` | Chapters and lessons. Shows the lesson count. |
| **Settings** | `?tab=settings` | Visibility, prerequisites, AI tutor, pricing, certificates and meta tags, plus the review, schedule, duplicate and delete cards. |
| **Dashboard** | `?tab=dashboard` | Learners and their progress. Shows the learner count. |
| **Announcements** | `?tab=announcements` | Messages to the course's learners. |
| **Export** | `?tab=export` | Download the course as a JSON file. |

**Good to know.** If you open a course that is not yours, you are sent to the "forbidden" page.

## Course settings

**What it is.** The rules of a course: who can find it and enroll, which courses come first, the AI tutor, the price, certificates and search engine tags.

**Where.** Course management page > **Settings** tab (`/admin/courses/<id>?tab=settings`).

**Step by step.**

1. Open the **Settings** tab.
2. Change what you need in the sections below.
3. Click **Save** in the bar at the bottom (or press Ctrl+S). It stays greyed out ("No changes to save") until something changed. You see "Course settings saved".

### Visibility

"Control how learners find and enroll in this course."

| Switch | What it does for learners |
|---|---|
| **Upcoming** | "Not yet open for enrollment." The course is listed as upcoming and nobody can enroll yet. |
| **Featured** | "Highlight on the homepage." |
| **Self enrollment** | On (default): learners enroll themselves. Off: only staff (from the **Dashboard** tab) or a batch can enroll learners. |
| **Enforce Lesson Completion** | "Each lesson opens only after the one before it is finished." |

### Prerequisites

**Required courses**: "Learners must complete every selected course before they can enroll in or buy this one. Joining through a batch skips this check. Up to 10."

1. Open the picker and type in **Search courses...**.
2. Select the courses. Only published courses can be picked. A course that was already a prerequisite and was later unpublished stays, marked "Unpublished: learners can't take it".
3. Save.

Rules: a course can't be its own prerequisite, and you can't make a loop. If course B already requires this course, you get: "<B> already requires this course (directly or through other courses), so it can't be a prerequisite too."

**What learners see.** The course page lists the courses to finish first. Enrolling or buying is blocked until they are complete.

### AI tutor (round 3)

"A course-grounded teaching assistant learners can ask while they study."

The **AI tutor** switch lets enrolled learners ask an AI teaching assistant about this course. "It answers only from the lessons, transcripts and quiz explanations, links to the lessons it used and never gives away quiz answers."

1. Turn on **AI tutor** and save.
2. Read the badge:
   - **Live for learners**: it works now.
   - **Waiting for site setup**: the switch is saved as on, but the site is not ready (see below).
   - **Turns on when you save**: you flipped it but have not saved yet.
3. The line next to it says how much the tutor knows, for example "Indexed 84 passages from 12 lessons, incl. 20 from video transcripts and 3 instructor clarifications."
4. **Review answers** opens the AI review queue for this course.

**Settings that affect it.** The tutor is **off by default** for the whole site. An Admin must turn it on at **Settings > AI tutor** (`/admin/settings/ai`), and the server needs an `ANTHROPIC_API_KEY` in its `.env` file. Until then you see a warning such as "The AI tutor is turned off for the whole site." or "The server has no ANTHROPIC_API_KEY yet.", followed by "Ask an administrator to finish the setup."

**What learners see.** Enrolled learners get an **Ask AI about this course** link on the course page and a full tutor page at `/courses/<slug>/ask`.

### Pricing and certification

"Charge for the course or its certificate, and choose how certificates are issued."

| Setting | What it means |
|---|---|
| **Paid course** | "Learners pay a fee to join this course." Then pick a **Currency** (USD, EUR, GBP, INR, AUD, CAD, SGD, AED or JPY) and a **Course price** ("Learners pay this once to enroll"). The price must be more than 0. |
| **Completion certificate** | "Learners receive a free certificate once they finish the course." It is issued automatically. |
| **Paid certificate** | Only shown for free courses. "Offer a paid certificate, graded by an evaluator, with this free course." Needs a **Currency**, a **Certificate price** and an **Evaluator** ("Learners book an evaluation with this person to earn the certificate"). |

Rules the form follows:
- A course can't have both a completion certificate and a paid certificate. Turning one on turns the other off.
- Turning on **Paid course** turns off **Paid certificate**.
- Selling needs a payment gateway. If an Admin set the gateway to "none", turning on a paid option opens **Payments not configured**: "Ask an administrator to configure one, then turn on pricing here." A fresh install uses the "manual" gateway, so you only see this box if an Admin changed it.
- When a certificate is on, a note explains that certificates use a design template (**Classic**, **Modern** or **Minimal**) chosen when they are issued; automatic certificates use **Classic**. Every certificate can be checked publicly with its code. The **Manage certificates** link in that note only opens for Moderators and Evaluators.

**Only an Admin can set** instalment plans (**Settings > Plans**), fixed prices in other currencies (**Settings > Taxes**, when multi-currency is on) and coupons (**Settings > Coupons**).

**What learners see.** A paid course shows its price and a buy button; learners are enrolled after paying. With a completion certificate, learners get their certificate when they finish. With a paid certificate, learners see a certification page (`/courses/<slug>/certification`) where they pay and book an evaluation.

### Meta Tags

"Search engines use these tags to describe your course and decide where it appears."

- **Meta description**: up to 160 characters. "A brief description that search engines can show for this course." The same field is on the sales page builder.
- **Meta keywords**: "Separate keywords with commas." Up to 500 characters. Duplicates are removed.

### The cards on the right

| Card | What it is for |
|---|---|
| **Review & publishing** | The progress bar (In progress, Under review, Approved, Published) and the buttons you may use. See "Review and publishing". |
| **Scheduled publishing** | Publish automatically at a set time. See "Schedule a course to publish later". |
| **Duplicate course** | Make a copy. See "Duplicate a course". |
| **Danger zone** | Delete the course. See "Delete a course". |

### Site settings that change how your course behaves

Only Admins change these, but you should know about them.

| Admin page | Setting | Effect on your course |
|---|---|---|
| `/admin/settings/learning` | **Lesson completion time (seconds)** | How long a learner stays on a text lesson before it counts as done (default 30). |
| `/admin/settings/learning` | **Video completion threshold (%)**, **Enforce video completion**, **Prevent skipping in videos** | When a video counts as watched (default 90%), whether that is required, and whether learners may skip ahead (off by default). |
| `/admin/settings/learning` | **Enforce quiz completion**, **Enforce assignment completion** | Whether a lesson with a quiz or assignment is complete only after it is done (both on by default). |
| `/admin/settings/learning` | **Announce new courses** | Whether members are told when a course is published for the first time (default: in-app). |
| `/admin/settings/video` | **Protect uploaded videos**, **Signed link lifetime (minutes)**, **Show a viewer watermark**, **Seek-bar previews**, **Autoplay the next lesson** | Protection and player behaviour for all lesson videos. |
| `/admin/settings/storage` | **Convert uploaded videos to HLS**, **Qualities to produce**, **Generate captions automatically** | Adaptive streaming and automatic captions. |
| `/admin/settings/features` | Batches, Programs, Certifications, Programming exercises, Jobs and more | A feature that is off hides its menu entries. |

## Review and publishing

**What it is.** A short approval flow: a Moderator checks your course before it goes live. A course moves through four steps: **In progress** > **Under review** > **Approved** > **Published**.

**Where.** Three places show the same buttons:
- the header of the course management page;
- the **Review & publishing** card on the **Settings** tab (with the progress bar and a short explanation);
- the **...** menu on the course list.

**Who does what.**

| Action | You (Course creator, own course) | A Moderator |
|---|---|---|
| **Submit for review** | Yes, when the course is In progress and has at least one lesson | Not needed |
| **Approve** | No | Yes, when the course is Under review |
| **Request changes** | No | Yes, when the course is Under review |
| **Publish** | Only after approval | Any time (publishing counts as approval) |
| **Schedule publish** | Only after approval | Any time |
| **Unpublish** | Yes | Yes |

### Step by step (Course creator)

1. Build the outline. **Submit for review** stays greyed out ("Add at least one lesson first") until the course has a lesson.
2. Click **Submit for review**. You see "Submitted for review. Moderators have been notified." Every Moderator gets a notification "<your name> submitted <course> for review".
3. Wait. The card says "A moderator is reviewing this course. You'll get a notification when it's approved."
4. You get one of two notifications:
   - "<course> was approved": "Your course passed review. You can publish it whenever you're ready."
   - "Changes requested on <course>", with the Moderator's note. The course is back to **In progress**. Make the changes and submit again.
5. When approved, click **Publish**. Confirm in "Publish this course?" ("The course will appear in the catalog and learners can enroll right away. The first time a course is published, members are notified."). Or schedule it (next chapter).

If the course has no lessons, the confirmation warns: "This course has no lessons yet. Learners will see an empty outline until you add some. Publish anyway?"

If you try to publish before approval, you get: "Only approved courses can be published. Submit the course for review and wait for a moderator to approve it."

### Unpublish

1. Click **Unpublish**.
2. Confirm "Unpublish this course?": "It will be hidden from the catalog and new learners can't enroll. Enrolled learners keep their progress, and you can publish it again later."

### What publishing does

- The course appears in the catalog, and learners can enroll (or buy) right away.
- The first time only: members are notified "<instructor> has published a new course <title>" (unless an Admin set **Announce new courses** to "Don't notify"), and the other instructors get "<course> is now live".
- When an Admin has set up IndexNow (**Settings > SEO**), search engines are told about the new page automatically.

### Editing after approval sends the course back

If you (a Course creator) edit an **unpublished** course that is **Under review** or **Approved**, it goes back to **In progress** and must be submitted again. This applies to the details, the outline, lessons, drip schedules and lesson schedules.

- On the **Details** tab you see a yellow notice: "Saving changes moves this course back to In progress. Submit it for review again once you are done editing."
- Save messages end with "The course moved back to In progress, so submit it for review again when you're ready."

Edits to a course that is already **published** never reset the review, and neither do a Moderator's edits.

> **If you are also a Moderator**: you never need to submit your own course. **Publish** works at any time. On someone else's course under review you get **Approve** and **Request changes**. **Request changes** opens a box "Note for the instructors" ("Optional, but specific feedback speeds up the next review."); click **Send to instructors**. Find courses waiting for you at **Manage courses > Under review** or the **Courses under review** card on `/admin`.

**What learners see.** Nothing until the course is published. After that the course is in the catalog at `/courses`, on category and tag pages, in search and on your instructor page.

## Schedule a course to publish later

**What it is.** Pick a date and time; the course is published automatically then, exactly as if you had clicked **Publish** (round 3).

**Where.** **Settings** tab > **Scheduled publishing** card ("Publish the course automatically at a date and time you choose."), or **Schedule publish...** in the course list's **...** menu.

**Who can use it.** You, once a Moderator has approved the course. Before that the card says "A moderator must approve the course before it can be scheduled. Submit it for review first."

**Step by step.**

1. In **Publish on**, pick a date and time, or click a quick choice: **Tomorrow, 9:00** or **In one week**. Times are in your own time zone ("Times are in your time zone (<zone>)."), and the hint tells you how long until it goes live.
2. Click **Schedule publish**. You see "Course scheduled".
3. To move it, pick a new time and click **Change publish time**.
4. To stop it, click **Cancel schedule** and confirm "Cancel the publish schedule?". "The course stays unpublished until you publish it or schedule it again."

**The states you may see.**

| State | Meaning |
|---|---|
| **Draft** | "Not published. Pick a time to publish it automatically." |
| **Scheduled** | It will go live at the chosen time. |
| **Publishing now** | "The publish time has passed; the course is going live now." |
| **On hold** | It has a time but is no longer approved (for example you edited it after approval). It waits until it is approved again. |
| **Published** | "Learners can find and enroll in this course." |

The card also lists **Lessons hidden until a set time**, each with **Publish now**. "Schedule a lesson from its editor. Learners of a published course are notified when it appears."

**Good to know.**
- The time must be at least a minute in the future and within the next two years.
- No background job needs to be set up. The site checks publish times whenever pages load, and a timer wakes it up while the server runs.
- When it goes live, the other instructors get "<course> is now live: Your course was published at its scheduled time."

## Duplicate a course

**What it is.** An editable copy of a course, for a new run, a translation or a variant (round 3).

**Where.** **Settings** tab > **Duplicate course** card > **Duplicate course...**, or **Duplicate...** in the course list's **...** menu.

**Step by step.**

1. Open the dialog "Duplicate course" ("Make an editable copy of <title>").
2. Read **Copied** and **Not copied**.
3. Change **Title of the copy** if you like. It starts as "Copy of <title>" (then "(2)", "(3)" if that is taken), up to 140 characters. "You can change it later in the course details."
4. Click **Duplicate**. You see "Created <title>. It is an unpublished draft."

**Copied:** details, settings, prices, the sales page, all chapters, lessons and blocks, every quiz (with its questions), assignment and exercise the lessons use or that belongs to the course, and finished video transcripts. The copied quizzes, assignments, exercises and questions are new items, so editing them never changes the original. The instructors stay the same; you become the copy's creator.

**Not copied:** learners, progress, submissions, reviews, discussions, announcements, certificates, payments, lesson history, publish times and an offer countdown that is set on the sales page.

**Good to know.**
- The copy starts as an unpublished, not featured draft, status **In progress**, with its own address (`<old slug>-copy`). Submit it for review like any new course.
- Copied videos play the uploaded file until they are converted again. Open the lesson and use **Convert again** in the video's **Adaptive streaming** panel if you want adaptive streaming on the copy.

## Export and import a course

**What it is.** Download a course as a JSON file, and create a new course from such a file, on this site or another site running this platform.

**Where.**
- Export: course page > **Export** tab > **Download JSON**, or **Export JSON** in the course list's **...** menu. The file is `<slug>.json`.
- Import: `/admin/courses/import` ("Import Course from JSON"). Get there with the **Import** button on the course list, or **Import from JSON** on the Export tab.

### Export

1. Open the **Export** tab. The **Export as JSON** card shows counts: **Chapters**, **Lessons**, **Content blocks**, **Quizzes**, **Questions**, **Assignments** and **Exercises**, plus the file size.
2. Click **Download JSON**.

The file contains the course details, outline and every lesson block, and the quizzes (with questions), assignments and programming exercises the course uses. It never contains learner data. Uploaded files are referenced by their `/uploads/...` address only: "Copy the storage folder along if you move to another server."

### Import

1. Open `/admin/courses/import`.
2. Drag and drop a course JSON file onto the box, or click **Device** to pick one. Maximum 5 MB.
3. Check the **Ready to import** summary.
4. Click **Import course**.

You land on the new course's **Outline** tab with "Course imported successfully!". Warnings are added in brackets, for example "2 lessons had unreadable content and were imported empty" or "paid certificate was turned off because the evaluator is not available here".

**Good to know.**
- The new course gets fresh ids and a free slug, and starts unpublished, **In progress**.
- "Instructors, categories and related courses are kept when they exist here; otherwise you become the instructor."
- Media in the file must still be reachable by URL from this site.
- Errors you may see: "This file is not valid JSON.", "This is not a course export file. Export a course from its Export tab first.", "Unsupported export version", "This file is too large (max 5 MB).", or "Error importing course: the outline is too large." (more than 200 chapters or 2,000 lessons).

## Delete a course

**What it is.** Removes a course for good.

**Where.** **Settings** tab > **Danger zone** > **Delete course**.

**Step by step.**

1. Click **Delete course**. The "Delete Course" box opens: "Deleting the course will also delete all its chapters and lessons. Are you sure you want to delete this course?" and "This action cannot be undone."
2. Type the exact course title where it says "Type <title> to confirm".
3. Click **Delete**. You go back to the course list with "Course deleted successfully".

**What is removed:** chapters, lessons, enrollments, progress, video watch data, notes, reviews, certificates and certificate requests and evaluations, announcements and discussions for the course. The course is taken out of batches (and their timetables), programs, coupons, other courses' related lists and prerequisites.

**What is kept:** quizzes, assignments and exercises and their submissions. They are only unlinked from the course.

**Good to know.** Unpublishing is usually the better choice: it hides the course but keeps learners' progress.
