# Guide for instructors, course creators and evaluators

This part of the guide is for the people who teach on LearnLoop: course creators who build courses, moderators who review and manage them, and evaluators who grade work and run certificate evaluations. Admins can do everything described here too.

It explains, step by step, where each tool lives, who may use it and what learners see as a result. All addresses assume the default local address `http://localhost:3000`; on your own server, replace it with your site address.

> **Status of newer features.** The following features were added in round 3. They are built and covered by automated tests, but have not yet been tried in a browser: the course sales page builder, SEO title and share image, the AI tutor switch and the AI review queue, resumable uploads, adaptive streaming (HLS conversion), transcripts and automatic captions, scheduled publishing of courses and lessons, course duplication, lesson version history, rubrics, peer review, and the instructor marketplace (Teach and Earnings). Everything else in this section was built in earlier rounds.

## Roles: who can do what

**What it is.** Every account has one or more roles. The roles decide which tools appear in the menu and which pages open.

| Role (as shown in the app) | Internal name | In short |
|---|---|---|
| Student | `student` | Learns. No teaching tools. |
| Course Creator | `course_creator` | Creates courses and teaches the courses they are an instructor of. Builds quizzes, questions, assignments, rubrics, exercises, batches and programs. |
| Moderator | `moderator` | Manages all content: every course, batch and program. Reviews and approves courses, manages members. |
| Batch Evaluator | `batch_evaluator` | Grades assignments and exercises, runs certificate evaluations, works with batches. |
| Admin | `admin` | Everything, plus the site settings. An Admin passes every role check. |

A person can have several roles at once. In the demo data:

| Demo account (password `password123`) | Roles |
|---|---|
| `admin@learnloop.test` (Admin User) | Admin, Moderator, Course Creator, Batch Evaluator |
| `maya@learnloop.test` (Maya Chen) | Course Creator, Moderator |
| `daniel@learnloop.test` (Daniel Okafor) | Course Creator only |
| `priya@learnloop.test` (Priya Raman) | Batch Evaluator, Moderator |
| `alex@learnloop.test` (Alex Johnson) | Student |

Daniel is the best account to see what a plain Course Creator sees. Alex shows the learner side.

Roles are given by Moderators and Admins in **Manage > Members** (`/admin/members`). See the admin section of this guide.

### The rule for courses

- **Moderators and Admins** can open and edit every course.
- **Course Creators** can edit a course only when they are listed as one of its **Instructors** or they created it.
- **Batch Evaluators** cannot edit courses (unless they are also Moderators). They can be chosen as a course's **Evaluator** for certificate evaluations.

### The Manage menu

Anyone with a teaching role (Course Creator, Moderator or Batch Evaluator) gets a **Manage** section in the sidebar. Which entries you see depends on your roles and on which features the Admin has switched on (**Settings > Features**, `/admin/settings/features`).

| Menu entry | Address | Shown to |
|---|---|---|
| **Overview** | `/admin` | Course Creator, Moderator, Batch Evaluator |
| **Courses** | `/admin/courses` | Course Creator, Moderator |
| **Batches** | `/admin/batches` | Course Creator, Moderator, Batch Evaluator (when Batches is on) |
| **Programs** | `/admin/programs` | Course Creator, Moderator (when Programs is on) |
| **Quizzes** | `/admin/quizzes` | Course Creator, Moderator |
| **Question bank** | `/admin/questions` | Course Creator, Moderator |
| **Assignments** | `/admin/assignments` | Course Creator, Moderator, Batch Evaluator. A number shows submissions waiting to be graded. |
| **Rubrics** | `/admin/rubrics` | Course Creator, Moderator, Batch Evaluator |
| **Exercises** | `/admin/exercises` | Course Creator, Moderator, Batch Evaluator (when Programming exercises is on) |
| **Certificates** | `/admin/certificates` | Moderator, Batch Evaluator (when Certifications is on) |
| **Job openings** | `/admin/jobs` | Course Creator, Moderator, Batch Evaluator (when Jobs is on) |
| **Blog** | `/admin/blog` | Course Creator, Moderator |
| **AI review** | `/admin/ai` | Course Creator, Moderator (only when the AI tutor is switched on for the site) |
| **Members** | `/admin/members` | Moderator |
| **Email outbox** | `/admin/emails` | Moderator |
| **Settings** | `/admin/settings` | Admin |

Admins see every entry. In the **You** section of the sidebar you may also see **Peer reviews** (when you have peer reviews assigned) and **Teach** (when the instructor marketplace is on).

### Two-step verification for staff

If the Admin turned on "enforce two-step verification for staff" (**Settings > Security**), anyone with a teaching role who opens a page under `/admin` without two-step verification is first sent to `/settings/security?required=2fa` to set it up. After that you go on to the page you wanted.

## The admin overview

**What it is.** Your start page for teaching work.

**Who can use it.** Course Creators, Moderators, Batch Evaluators and Admins.

**Where.** `/admin`, from **Manage > Overview**.

It greets you ("Hi, <name>"), tells you what is coming up (live classes and scheduled evaluations), and shows:
- **Key numbers**: Courses (published and draft), Learners, Enrollments this week, Completions, Revenue this month, **Pending grading** (assignments and quizzes) and **Courses under review**. For non-Moderators, the numbers cover only the courses and batches you teach ("Numbers cover the courses and batches you teach.").
- Shortcut cards. Everyone gets **Assignments** and **Grading queue** (`/admin/assignments/submissions?status=not_graded`), plus **Batches** when batches are on. Course Creators and Moderators also get **Courses**, **Quizzes**, **Question bank**, **Quiz submissions** (open-ended answers that need marks), **Exercises** and **Statistics**. Moderators get **Programs**, **Job openings** and **Members**. Evaluators and Moderators get **Certificates**. Admins also get **Transactions**, **Coupons** and **Settings**. Cards for switched-off features are hidden.
- A **Create course** button.

## Create a course

**What it is.** A course is a set of chapters, and each chapter holds lessons. You create the course shell first (title, description, media, instructors), then set prices and rules, then build the outline.

**Who can use it.** Course Creators, Moderators and Admins. Anyone else who opens `/admin/courses/new` sees "Your role can't create courses."

**Where.** `http://localhost:3000/admin/courses/new`. From the menu: **Manage > Courses**, then the **New course** button at the top right. The admin overview at `/admin` also has a **Create course** button.

### Step by step

1. Open **Manage > Courses** and click **New course**.
2. Fill in the **Course details** card:
   - **Title** (required, up to 140 characters), for example "Modern JavaScript Fundamentals".
   - **Slug**: the last part of the course address, `/courses/<slug>`. It is made from the title until you type your own. Only lowercase letters, numbers and hyphens. The words `new`, `import`, `edit` and `learn` are reserved. If the slug is taken, a number is added when you save.
   - **Short introduction** (required, up to 300 characters): one or two sentences shown on course cards.
   - **Category**: pick one, or click the **+** button next to the list, type a name (2 to 50 characters) and press **Create** to add a new category on the spot.
   - **Tags**: up to 12 tags, each up to 32 characters. Existing tags are suggested as you type.
3. Write the **Course description** (required, up to 50,000 characters). This is the long overview on the course page. The editor has a toolbar (Bold, Italic, Heading, Bulleted list, Numbered list, Quote, Link, Code) and a **Write / Preview** switch.
4. Add **Media**:
   - **Course thumbnail**: upload a PNG, JPG, GIF or WebP, or switch to **Link** and paste an image URL. The hint suggests 750×422 pixels. It appears on the catalog card and at the top of lessons.
   - **Color**: the gradient used on the card when there is no thumbnail. The **Card preview** shows the result.
   - **Preview video**: upload a video or paste a direct link to an MP4/WebM file. YouTube and Vimeo links are refused ("YouTube and Vimeo links can't be used...").
5. Choose **Instructors & evaluation**:
   - **Instructors** (required): pick from members who are Course Creators, Moderators or Admins. You are added automatically when you create a course. Instructors can edit the course and see its dashboard.
   - **Evaluator**: optional. This person grades certificate evaluations for the course. Only Batch Evaluators, Moderators and Admins are listed.
   - Moderators also see **Add New Member** in both pickers. It opens a small form (Email, First name, Last name, Password, Roles) that creates an account and adds it straight to the course.
6. Fill in **What learners will learn** (outcomes) and **Requirements**: up to 20 lines each, 200 characters per line. Outcomes appear as a checklist on the course page.
7. Pick **Related courses** (up to 12). Learners only see the ones that are published.
8. Click **Create course** (or press Ctrl+S). You land on the new course's management page.

> While you have unsaved changes, a **Not Saved** badge shows in the bar at the bottom, and the browser asks before you leave the page.

**What learners see.** Nothing yet. A new course is a draft ("In progress") and is not in the catalog until it is published.

**Good to know.**
- A Course Creator who is not a Moderator cannot remove themselves from the instructors of a course they did not create.
- You can change all of these fields later on the **Details** tab. If you change the slug of an existing course, the old address keeps working (it redirects to the new one).
- Prefer to start from an existing course? See [Duplicate a course](#duplicate-a-course) and [Export and import a course](#export-and-import-a-course).

## The course management page

**What it is.** One page per course where you edit everything about it.

**Who can use it.** Moderators and Admins can open every course. A Course Creator can open a course only if they are one of its instructors or they created it. Others are sent to the "forbidden" page.

**Where.** `/admin/courses/<course id>`. From **Manage > Courses**, click the course title, or use the **...** menu on its row.

The header shows the course status badges (**Published** or **Draft**, the review status, **Upcoming**, **Featured**) and these buttons:

| Button | What it does |
|---|---|
| **View course** | Opens the public course page `/courses/<slug>`. |
| **Sales page** | Opens the sales page builder (see [Course sales page builder](#course-sales-page-builder)). |
| **Submit for review**, **Approve**, **Request changes**, **Publish**, **Unpublish** | Review and publishing actions. Only the ones you may use right now are shown (see [Review and publishing](#review-and-publishing)). |

The page has six tabs. The tab is part of the address, so you can bookmark it:

| Tab | Address | What you do there |
|---|---|---|
| **Details** | `/admin/courses/<id>` | The same form as "New course". |
| **Outline** | `?tab=outline` | Chapters and lessons. |
| **Settings** | `?tab=settings` | Visibility, prerequisites, AI tutor, pricing, certificates, meta tags, publishing, scheduling, duplicate, delete. |
| **Dashboard** | `?tab=dashboard` | Learners and their progress. |
| **Announcements** | `?tab=announcements` | Messages to the learners of this course. |
| **Export** | `?tab=export` | Download the course as JSON, or go to the importer. |

### The course list

`/admin/courses` lists courses in a table (cards on phones) with tabs **All**, **Published**, **Unpublished**, **Under review** and **Mine**, plus a search box ("Search by title, tag or instructor").

- Moderators and Admins see every course.
- Course Creators see published courses plus the courses they teach or created. They can only edit their own; other titles open the public course page.

The **...** menu on each row offers, depending on your rights: **Edit details**, **Outline**, **Dashboard**, **Settings**, **View course**, **Export JSON**, **Duplicate...**, **Approve**, **Publish**, **Schedule publish...** and **Unpublish**.

The top of the list also has **Import** and **New course** buttons.

## Course settings

**What it is.** The rules for a course: who can find it and enroll, what it costs, which courses come first, whether it has an AI tutor and a certificate, and its search engine tags.

**Who can use it.** Anyone who can manage the course (its instructors who are Course Creators, Moderators, Admins).

**Where.** Course management page > **Settings** tab (`/admin/courses/<id>?tab=settings`). Press **Save settings** (or Ctrl+S) when done. The button stays grey until something changed.

### Visibility

| Switch | What it does for learners |
|---|---|
| **Upcoming** | "Not yet open for enrollment." The course shows as Upcoming and learners cannot enroll. |
| **Featured** | "Highlight on the homepage." |
| **Self enrollment** | On: learners can enroll themselves. Off: only staff (from the Dashboard tab) or a batch can enroll learners. |
| **Enforce Lesson Completion** | Each lesson opens only after the one before it is finished. Lessons a learner already completed never lock again. |

### Prerequisites

**Required courses**: learners must complete every selected course before they can enroll in or buy this one. Up to 10 courses. Rules:
- Only published courses can be picked (a prerequisite that was already set may stay even if it is later unpublished).
- A course cannot require itself, and you cannot create a loop (A requires B, B requires A). You get an error naming the course that causes the loop.
- Joining through a batch skips this check.

**What learners see.** On the course page they see which courses to finish first. In the player, locked lessons say "Complete the prerequisite courses, then enroll to unlock this lesson".

### AI tutor

The **AI tutor** switch lets enrolled learners ask an AI teaching assistant about this course. It answers only from the lessons, transcripts and quiz explanations, links to the lessons it used and never gives away quiz answers.

- The switch only works when an Admin has turned on the tutor for the whole site at **Settings > AI tutor** (`/admin/settings/ai`) and the server has an `ANTHROPIC_API_KEY` in its `.env` file. If not, a warning tells you which part is missing ("The AI tutor is turned off for the whole site." or "The server has no ANTHROPIC_API_KEY yet."). The AI tutor is off by default.
- When the switch is on you see a badge (**Live for learners**, **Waiting for site setup** or **Turns on when you save**), how many passages were indexed from how many lessons (including video transcripts and instructor clarifications), and a **Review answers** link to `/admin/ai`.
- See [AI tutor review queue](#ai-tutor-review-queue) for checking answers.

### Pricing and certification

| Setting | Notes |
|---|---|
| **Paid course** | "Learners pay a fee to join this course." When on, pick a **Currency** (USD, EUR, GBP, INR, AUD, CAD, SGD, AED or JPY) and a **Course price** (must be more than 0). Learners pay once to enroll. |
| **Completion certificate** | "Learners receive a free certificate once they finish the course." Issued automatically on completion. |
| **Paid certificate** | Only shown for free courses. "Offer a paid certificate, graded by an evaluator, with this free course." Needs a **Currency**, a **Certificate price** and an **Evaluator**. Learners book an evaluation with that person to earn the certificate. |

Rules the form enforces:
- A course cannot have both a paid certificate and a completion certificate. Turning one on turns the other off.
- Turning on a paid course turns off the paid certificate.
- Selling anything needs a payment gateway. If the Admin set the gateway to "none", turning on **Paid course** or **Paid certificate** opens a "Payments not configured" box. Admins get an **Open payment settings** button (to `/admin/settings/payments`); others are told to ask an administrator. The default gateway on a fresh install is "manual", so this box does not appear until an Admin changes it.
- Certificates are rendered from a template chosen when they are issued or evaluated; automatic certificates use the first template. Every certificate can be checked publicly with its code. The **Manage certificates** link goes to `/admin/certificates`.

**Things only an Admin can set for a course's price** (not on this tab):
- Paying in installments: **Settings > Plans** (`/admin/settings/plans`), when installments are switched on.
- Fixed prices in other currencies: **Settings > Taxes** (`/admin/settings/taxes`), used when multi-currency is switched on.
- Coupons: **Settings > Coupons**.

### Meta Tags

- **Meta description**: up to 160 characters, "Shown under the course title in search results."
- **Meta keywords**: comma-separated, up to 500 characters.

The same meta description is also editable on the sales page builder, together with an SEO title and a share image (see [Search and sharing](#search-and-sharing)).

### The side cards on the Settings tab

- **Review & publishing**: progress bar (In progress, Under review, Approved, Published) and the workflow buttons.
- **Scheduled publishing**: see [Schedule a course to publish later](#schedule-a-course-to-publish-later).
- **Duplicate course**: see [Duplicate a course](#duplicate-a-course). Shown to Course Creators, Moderators and Admins.
- **Danger zone**: see [Delete a course](#delete-a-course).

### Site-wide settings that change how your course behaves

These live in the Admin settings. Only Admins can change them, but you should know about them:

| Admin page | Setting | Effect on your course |
|---|---|---|
| `/admin/settings/learning` | **Lesson completion time (seconds)** | How long a learner stays on a text lesson before it counts as complete (default 30). |
| `/admin/settings/learning` | **Video completion threshold (%)**, **Enforce video completion**, **Prevent skipping in videos** | When a video lesson counts as watched (default 90%), and whether learners may skip ahead. |
| `/admin/settings/learning` | **Enforce quiz completion**, **Enforce assignment completion** | Whether a lesson with a quiz or assignment is complete only after it is done. |
| `/admin/settings/learning` | **Announce new courses** | Don't notify / In-app / Email, when a course is published for the first time (default In-app). |
| `/admin/settings/video` | **Protect uploaded videos**, **Signed link lifetime (minutes)**, **Show a viewer watermark**, **Watermark opacity**, **Seek-bar previews**, **Autoplay the next lesson** | Protection and player behaviour for every lesson video. |
| `/admin/settings/storage` (Storage & video) | **Convert uploaded videos to HLS**, **Qualities to produce**, **Generate captions automatically** | Adaptive streaming and automatic captions (see [Video blocks](#video-blocks)). |
| `/admin/settings/features` | Courses, Batches, Programs, Certifications, Programming exercises, Jobs and others | Turning a feature off hides its menu entries. |

## Review and publishing

**What it is.** A simple approval flow so that a Moderator checks a course before it goes live.

The four steps are: **In progress** > **Under review** > **Approved** > **Published**.

**Who can use it.**

| Action | Course Creator (own course) | Moderator / Admin |
|---|---|---|
| **Submit for review** | Yes, when the course is In progress and has at least one lesson | Not needed |
| **Approve** | No | Yes, when the course is Under review |
| **Request changes** | No | Yes, when the course is Under review |
| **Publish** | Only after approval | Yes, any time (publishing counts as approval) |
| **Schedule publish** | Only after approval | Yes |
| **Unpublish** | Yes | Yes |

**Where.** The header of the course management page, the **Review & publishing** card on the Settings tab, and the **...** menu on the course list.

### Steps for a Course Creator

1. Build the outline. You need at least one lesson; until then **Submit for review** is greyed out ("Add at least one lesson first").
2. Click **Submit for review**. All Moderators get a notification linking to the course settings.
3. Wait. When a Moderator approves, you get a notification "<course> was approved". If they press **Request changes**, the course goes back to In progress and you get their note as a notification.
4. When approved, click **Publish** and confirm, or schedule it.

### Steps for a Moderator

1. Open **Manage > Courses > Under review**, or the **Courses under review** number on `/admin`.
2. Look through the course (**View course**, the Outline tab, "Preview as student").
3. Click **Approve**, or **Request changes** and write a note for the instructors (up to 2,000 characters), then **Send to instructors**.
4. You can also publish straight away.

### What publishing does

- The course appears in the catalog and learners can enroll right away.
- The first time a course is published, members are notified (depending on **Announce new courses**), the other instructors get a "<course> is now live" notification, and search engines are pinged when IndexNow is set up by the Admin.

**Unpublish** hides the course from the catalog. New learners cannot enroll; enrolled learners keep their progress. You can publish again later.

**Good to know.**
- If a Course Creator edits an unpublished course that is Under review or Approved (details, outline, lessons, schedules), the course goes back to **In progress** and must be submitted again. You see a yellow notice "Saving changes moves this course back to In progress" on the Details tab, and save messages end with "The course moved back to In progress, so submit it for review again when you're ready." Edits by Moderators, and edits to a course that is already published, do not reset the review.

### Schedule a course to publish later

**What it is.** Pick a date and time; the course is published automatically then, exactly as if you pressed **Publish**.

**Who can use it.** Moderators and Admins on any course; Course Creators once their course is approved.

**Where.** Settings tab > **Scheduled publishing** card, or **Schedule publish...** in the course list's **...** menu (only for unpublished courses).

1. Pick the time in **Publish on**, or click a quick choice (**Tomorrow, 9:00** or **In one week**). Times are in your own time zone; the hint shows which one and how long until it goes live.
2. Click **Schedule publish**. To change it later, pick a new time and click **Change publish time**. To stop it, click **Cancel schedule** and confirm (the course stays unpublished).

States you may see: **Draft**, **Scheduled**, **Publishing now** (the time has passed and it is going live), **On hold** (an instructor edited the course after approval, so it waits for a new approval) and **Published**.

The card also lists **Lessons hidden until a set time**, each with a **Publish now** button.

**Good to know.** The time must be at least a minute in the future and within two years, and is stored to the whole minute. No cron job is needed: the site checks publish times whenever pages load, and a timer wakes it up while the server runs.

### Duplicate a course

**What it is.** Makes an editable copy of a course, for a new run, a translation or a variant.

**Who can use it.** Course Creators, Moderators and Admins who can manage the source course.

**Where.** Settings tab > **Duplicate course** card > **Duplicate course...**, or **Duplicate...** in the course list's **...** menu.

1. Open the dialog. It shows what will be copied and what will not.
2. Change **Title of the copy** if you like (default "Copy of <title>", then "(2)", "(3)" if that is taken; up to 140 characters).
3. Click **Duplicate**.

**Copied:** details, settings, prices, the sales page, chapters, lessons and all blocks, and every quiz (with its questions), assignment and exercise that the lessons use or that is linked to the course, plus finished video transcripts. The copied quizzes, assignments and exercises are new items, so editing them never changes the original.

**Not copied:** learners, progress, submissions, reviews, discussions, announcements, certificates, payments and lesson history.

The copy starts as an unpublished, unfeatured draft (status In progress) with its own address (`<old slug>-copy`), and you become its creator.

### Export and import a course

**What it is.** Download a course as a JSON file, and create a new course from such a file (on this site or another site running this platform).

**Who can use it.** Export: anyone who can manage the course. Import: Course Creators, Moderators and Admins.

**Where.**
- Export: course page > **Export** tab > **Download JSON**, or **Export JSON** in the course list's **...** menu. The file comes from `/admin/courses/<id>/export` and is named `<slug>.json`.
- Import: `/admin/courses/import` ("Import Course from JSON"), from the **Import** button on the course list or **Import from JSON** on the Export tab.

**Export** contains the course details, outline, every lesson block, and the quizzes (with questions), assignments and programming exercises the course uses. It never contains learner data (enrollments, progress, submissions, reviews). Uploaded files are referenced by their `/uploads/...` URL only; copy the storage folder along if you move to another server. The tab shows counts (Chapters, Lessons, Content blocks, Quizzes, Questions, Assignments, Exercises) and the file size.

**Import steps:**
1. Open `/admin/courses/import`.
2. Choose a course JSON file (or drop it on the box). Maximum 5 MB.
3. Check the "Ready to import" summary.
4. Click **Import course**. You land on the new course's Outline tab with the message "Course imported successfully!" (plus any warnings, for example lessons with unreadable content that were imported empty).

**Good to know.**
- The import gets fresh ids, a free slug and starts unpublished, In progress.
- Instructors, categories and related courses are kept when they exist on this site; otherwise you become the instructor.
- Media in the file must still be reachable by URL from this site.
- Errors you may see: "this is not a course export file", "unsupported export version", "the outline is too large" (more than 200 chapters or 2,000 lessons).

### Delete a course

**Who can use it.** Anyone who can manage the course.

**Where.** Settings tab > **Danger zone** > **Delete course**.

1. Read the summary: it removes the chapters, lessons, enrollments with their progress, and reviews. Quizzes, assignments and exercises are kept but unlinked.
2. Type the exact course title in the box.
3. Click **Delete**. This cannot be undone.

Also removed: notes, certificates and certificate requests for the course, announcements and discussions. The course is taken out of batches, programs, coupons, other courses' related lists and prerequisites. You go back to the course list with "Course deleted successfully".

## Build the outline: chapters and lessons

**What it is.** The structure of the course: ordered chapters, each with ordered lessons.

**Who can use it.** Anyone who can manage the course.

**Where.** Course page > **Outline** tab (`/admin/courses/<id>?tab=outline`).

### Chapters

1. Click **Add chapter** (or **Create chapter** on an empty course).
2. Enter a **Title** (required, up to 120 characters) and an optional **Description** shown under the chapter title.
3. Optionally open **Release schedule** to drip the whole chapter (see [Drip release](#drip-release-schedules)).
4. Save. Use the chapter's **...** menu for **Edit chapter**, **Release schedule...**, **Add lesson**, **Move up**, **Move down** and **Delete chapter**.

Deleting a chapter also deletes its lessons and the learner progress on them. You are asked to confirm.

### Lessons

1. Click **Add lesson** under a chapter.
2. Type a title (up to 160 characters; leave it empty for "Untitled lesson") and click **Add lesson**. The lesson editor opens.

Each lesson row shows its number (for example 1.2), its block types, the estimated duration and badges for schedules. Row controls:
- **Preview / Enrolled** pill: click it to switch the lesson between a free preview (anyone can open it without enrolling) and enrolled-only.
- Eye icon: **Preview as student** (opens the lesson in a new tab).
- Pencil: rename in place.
- **...** menu: **Rename**, **Move up**, **Move down**, **Move to chapter...** (moves it to the end of another chapter), **Release schedule...**, **Delete lesson**.

Deleting a lesson removes it with the learner progress and notes on it.

### Reordering

Drag chapters and lessons by their handle. Drop a lesson on another chapter to move it there. You can also use the **Move up / Move down** menu items. While a change is being saved, dragging is paused.

Other controls at the top of the outline: **Expand all / Collapse all**, and the **Outline / Schedule** switch. **Schedule** shows a **Release timeline** of all drip rules.

**Preview as student** at the top opens the first lesson as learners see it.

**What learners see.** Lessons marked Preview can be opened by anyone (guests too, if the Admin allows guest access). Other lessons ask them to enroll.

## Drip release schedules

**What it is.** Keep chapters or lessons locked until some days after a learner enrolls, until a date, or both.

**Who can use it.** Anyone who can manage the course.

**Where.**
- A chapter: **Add Chapter / Edit Chapter** dialog > **Release schedule**.
- A lesson: lesson row **...** > **Release schedule...**, or the **Release schedule** section in the lesson editor.
- Overview: Outline tab > **Schedule** view.

**How to use it.**
1. Choose **Available immediately** or **Scheduled**.
2. For **Scheduled**, tick one or both:
   - **Days after enrollment**: 1 to 3,650 days. Counted from each learner's enrollment; batch learners count from the batch start.
   - **On a date**: opens for everyone at 00:00 UTC on that day, free previews included.
3. Read the summary line, for example "This lesson unlocks 7 days after a learner enrolls, but not before <date> (00:00 UTC)." It also tells you when a learner enrolling now would get it.
4. Save.

**Good to know.**
- A chapter schedule applies to every lesson in it. A lesson can add its own later schedule; learners get the lesson at whichever time is later.
- A free preview lesson ignores day-based schedules; only a date holds it back.
- If **Enforce Lesson Completion** is on, learners must also finish the previous lessons.
- Learners see a locked card with a countdown until the lesson opens. Instructors and Moderators can always open every lesson.

## Schedule a lesson to appear later

**What it is.** Hide a single lesson from learners until a date and time (different from drip: the lesson is invisible to everyone, not just locked).

**Who can use it.** Anyone who can manage the course.

**Where.** Lesson editor > **Publishing** card on the right.

1. Click **Schedule for later**.
2. Pick the time in **Hide until** (or a quick choice) and click **Schedule**.
3. To change it, click **Change time**; to release it now, click **Publish now**.

If learners already opened the lesson, you are asked "Hide this lesson for now?" first.

**What learners see.** Nothing until the time comes. Then the lesson appears, and if the course is live, its learners get a notification once. A scheduled lesson shows a schedule badge in the outline, and the course's **Scheduled publishing** card lists it with **Publish now**.

## The lesson editor

**What it is.** Where you write a lesson as a list of content blocks.

**Who can use it.** Anyone who can manage the course.

**Where.** `/admin/courses/<id>/lessons/<lessonId>`. Click a lesson title on the Outline tab.

### The parts of the page

- **Toolbar** (top): previous/next lesson arrows, **Not Saved** badge or "Saved <time ago>", **History**, **Video Statistics** (only when the lesson has a video), a **?** button for "How to edit a lesson", **View lesson** (opens the last saved version as a learner sees it) and **Save**.
- **Lesson title**, shown as "Lesson 1.2 · <chapter>" above it (up to 160 characters).
- **Slug**: unique within the course, used for reference and exports. Lowercase letters, numbers and single hyphens, up to 80 characters.
- **Include in preview**: "When on, visitors can open this lesson as a free preview."
- **Instructor notes** (marked private): Markdown, up to 50,000 characters. Only instructors and moderators see them on the lesson page.
- **Release schedule**: drip settings for this lesson.
- **Content**: the blocks, with **Expand all / Collapse all**.
- Right side: block count and estimated duration, the **Publishing** card, and a list of all lessons with **Edit outline**.

### Working with blocks

1. Click **Add block** at the bottom, or **Insert block below** under any block.
2. Pick a block type from the grid.
3. Fill in the block. Each block has buttons to drag, **Move up**, **Move down**, **Duplicate** and **Delete**. Deleting a block with content asks first; it is removed when you save.
4. Click **Save** or press Ctrl+S.

If a block has a problem, saving stops with "N blocks need attention before saving." and the block is outlined in red with the reason. A lesson can hold up to 200 blocks.

Saving also recalculates the lesson's estimated time (video and audio lengths plus reading time of text).

### Block types

| Block | Use it for | Main fields |
|---|---|---|
| **Markdown** | Rich text with headings, lists, links and code | Markdown editor with toolbar and Write/Preview |
| **Video** | Upload an MP4/WebM or paste a direct video URL | See [Video blocks](#video-blocks) |
| **Audio** | Podcast-style audio clip | File or link (MP3, M4A, OGG, WAV or WebM), **Title**; duration is detected |
| **PDF** | Readable document shown inline | Upload (max 25 MB) or link, **Title**, **Show preview** |
| **Image** | Picture with alt text and caption | Upload or link (PNG, JPG, GIF, WebP or SVG), **Alt text**, **Caption** |
| **File** | Downloadable attachment | Upload (PDF, Office documents, ZIP, text or audio, max 25 MB) or link, **Title** (shown on the download button) |
| **Code** | Syntax-labelled code snippet | **Language** (28 choices, from Plain text and Bash to TypeScript and YAML), the code |
| **Embed** | Any page that allows being framed (not video) | **Page URL**, **Height (px)** 150 to 1600 (default 480), **Title** for screen readers, **Show preview** |
| **Quiz** | Link a quiz from the question bank | **Choose quiz** or **Create new** |
| **Assignment** | Collect a submission for grading | **Choose assignment** or **Create new** |
| **Exercise** | Programming exercise with test cases | **Choose programming exercise** or **Create new** |
| **Callout** | Highlighted tip, warning or note | Tone (**Note**, **Tip**, **Warning**, **Important**) and Markdown text |

Rules worth knowing:
- Embeds must be full `http(s)` addresses on another website. Pages and files from this site cannot be embedded ("Use an Image, PDF or File block for uploads"), and YouTube/Vimeo are refused.
- The file size limit for images, PDFs, audio and documents is 25 MB by default. The server owner can change it with `MAX_FILE_UPLOAD_MB` in `.env`.
- The Markdown toolbar has keyboard shortcuts: Ctrl+B bold, Ctrl+I italic, Ctrl+K link, Ctrl+E code.

### Quiz, assignment and exercise blocks

These blocks link to items you build in their own editors.

1. Click **Choose quiz** (or assignment / programming exercise). A searchable list opens; use **Filter by course** to narrow it.
2. If the item does not exist yet, click **Create new**. Its editor opens in a new tab (`/admin/quizzes/new`, `/admin/assignments/new` or `/admin/exercises/new`). Save it there, come back and click **Refresh list**.
3. Pick the item. The block shows its title with **Edit** (opens its editor in a new tab) and **Change**.

If a linked item was deleted, the block shows "The selected ... no longer exists" and you must pick another before saving.

**What learners see.** The quiz, assignment or exercise appears inside the lesson where you placed the block. See [Quizzes](#quizzes), [Assignments](#assignments) and [Coding exercises](#coding-exercises).

## Video blocks

**What it is.** A lesson video that plays in the platform's own player, which tracks how much each learner watched.

**Who can use it.** Anyone who can manage the course. Uploading videos and files larger than 25 MB is limited to staff (Course Creators, Moderators, Batch Evaluators and Admins).

**Where.** Lesson editor > **Add block** > **Video**.

### Add the video

1. Under **Video**, choose **Upload** or **Link**.
   - **Upload**: pick or drag an MP4, WebM or OGG file. Large files are sent in pieces with a progress bar, speed and time left. You can **Pause** and **Resume**. If the connection drops it retries by itself; if you close the tab or the browser crashes, choose the same file again and it continues where it stopped (the server keeps a partial upload for a day). The default limit is 10 GB, set by `MAX_VIDEO_UPLOAD_MB` in `.env`.
   - **Link**: paste a direct link to a video file (`https://example.com/lesson.mp4`). YouTube and Vimeo links are not allowed, because every video must play in the platform's player.
2. **Duration** is detected automatically. If it says "Couldn't read the duration. Enter it manually.", type it as `mm:ss`. Use **Detect** to try again. The duration feeds the estimated time and completion tracking.
3. Optional **Title**.
4. **Save** the lesson.

### Adaptive streaming (HLS conversion)

After you save a lesson with an uploaded video, the **Adaptive streaming** panel under the video shows its conversion. Uploaded videos are converted to several qualities (by default 1080p, 720p and 480p) so the player can match each learner's connection.

| Status shown | Meaning |
|---|---|
| **Not saved yet** / **New video not saved** | Save the lesson to start the conversion. Learners see the saved video until then. |
| **Queued, starting soon** / **Queued (number N in line)** | Videos are converted one at a time in the background. You can leave the page. |
| **Processing 42% (1080p/720p/480p)** | Converting. Learners get the original file (or the previous stream) until it finishes. **Cancel conversion** is available. |
| **Ready** | Adaptive streaming is on, with the qualities listed. **Convert again** is available. |
| **Failed** | With the first line of the error. **Retry**. Learners still get the original file. |
| **Plays as linked** | Linked videos are never converted; they play exactly as they are. |
| **Converter not installed** | ffmpeg is missing on the server. The original file plays. |
| **Adaptive streaming is off** | An Admin switched off conversion in Settings > Storage & video. |

You get a notification when a conversion finishes ("Video ready: <lesson>") and a notification plus an email if it fails.

**What the server needs.** ffmpeg and ffprobe installed on the server (`winget install Gyan.FFmpeg` on Windows, `apt install ffmpeg` on Linux), or their paths in `FFMPEG_PATH` and `FFPROBE_PATH`. The Admin controls conversion at `/admin/settings/storage` (**Convert uploaded videos to HLS**, on by default, and **Qualities to produce**).

### Captions, poster, qualities, chapters and in-video quizzes

- **Poster image**: shown before playback starts.
- **Captions (.vtt)**: a WebVTT file learners can turn on in the player. For a full transcript editor, see [Transcripts and captions](#transcripts-and-captions); the **Transcript** / **Edit transcript** link sits at the top right of the Adaptive streaming panel.
- **Video qualities**: optional extra versions of the same video (for example a 480p file for slow connections). Click **Add quality**, give it a **Label** like "720p" and optionally a **Height (px)**, then upload or link the file. Learners pick one in the player's Quality menu or leave it on Auto.
- **Chapters**: named sections on the seek bar. Click **Add chapter**, enter the start time (`mm:ss`) and a title. A chapter cannot start after the end of the video.
- **Quizzes in this video**: click **Add Quiz to Video**, set a time and pick a quiz. Playback pauses at that time and the quiz opens. You need at least one quiz first ("Create a quiz first").
- **Preview in player**: plays the video in the editor. Pause where you want a chapter or quiz and the add buttons change to "Add at 2:15", so the marker lands at the current time.

**Good to know.**
- When the Admin turns on **Protect uploaded videos** (on by default), uploaded videos only play through signed links that expire and work for one signed-in account. Videos hosted elsewhere are not affected. In production this needs a long random `APP_SECRET` in `.env`.
- The **Video Statistics** button in the toolbar shows how learners watched the videos of this lesson. For a full report per course, see [Video analytics](#video-analytics).

## Lesson version history

**What it is.** Every time you save a lesson, the version it replaces is kept, so you can compare and go back.

**Who can use it.** Anyone who can manage the course.

**Where.** Lesson editor > **History** button (clock icon).

1. Click **History**. The "Version history" window lists versions, newest first, with who saved them and when.
2. Click a version. Choose **Changes in this version** (what that save changed) or **Compare with current** (how it differs from the lesson now).
3. Optional: **Add a note** to a version (up to 200 characters), for example "Rewrote the introduction".
4. To go back, click **Restore** and confirm **Restore version**. The lesson gets the title, instructor notes and blocks of that version. The current content is kept in the history first, so you can switch back. Unsaved edits in the editor are replaced.

**Good to know.**
- Up to 50 versions are kept per lesson. Very large lessons keep fewer (but always at least the 5 newest).
- The slug and the preview switch are not part of the history. Video conversion results and transcripts stay with the video when you restore.
- Nothing is stored when you save without changing anything.

## Transcripts and captions

**What it is.** A timed transcript for each lesson video. Learners see it as captions in the player and as an interactive transcript panel under the video (click a line to jump there, download it as text, WebVTT or SubRip). The AI tutor and the transcript search also use it.

**Who can use it.** Anyone who can manage the course.

**Where.** `/admin/courses/<id>/lessons/<lessonId>/transcript?block=<video block id>`. Easiest way in: the **Transcript** (or **Edit transcript**) link in a video block's Adaptive streaming panel. If a lesson has several videos, tabs at the top switch between them (a tick marks videos that already have a transcript). Learners' transcript panel also shows managers an **Add a transcript** / **Open the transcript editor** link.

The page needs a saved video block with a file. Otherwise you see "This lesson has no video" or "This video block has no file yet" with a link back to the lesson editor.

### The editor

- Left: a **preview player** showing the current caption, a **Transcript details** box (status **Published to learners**, **Not available to learners** or **Being generated**; the source and when it was saved; **Language of the captions** as a code such as `en`, `hi` or `pt-BR`; **Delete transcript**), the **Automatic transcript** box and a **Keyboard shortcuts** list.
- Right: the list of captions, each with a **Start** and **End** time, the text and a play button ("Play from here"). Each caption's menu has **Split in two**, **Merge with next**, **Insert caption after**, **Start at the playhead**, **End at the playhead** and **Delete caption**.
- Toolbar: Undo, Redo, **Add** (new caption at the playhead), **Import**, **Export**, and a tools menu with **Adjust timing...**, **Close short gaps** (joins captions less than half a second apart) and **Discard unsaved changes**. A **Find in captions** box and filters **All**, **To check** and **Empty**. Select several captions to merge or shift them together.
- **Save transcript** at the bottom (or Ctrl+S). Saving publishes the transcript to learners.

Useful shortcuts: Alt+K play/pause, Alt+J / Alt+L jump back/forward, Alt+N new caption, Alt+[ / Alt+] set start/end at the playhead, Ctrl+Enter split at the cursor, Ctrl+Z undo. In a time box, the arrow keys nudge by 0.1 s (Shift: 1 s).

### Write captions by hand

1. Play the preview and press **Add** (Alt+N) where a sentence starts.
2. Type the text, set the end with Alt+].
3. Repeat, then **Save transcript**.

### Import a VTT or SRT file

1. Click **Import** and choose (or drop) a WebVTT (`.vtt`) or SubRip (`.srt`) file. Formatting tags are removed; speaker tags become "Name:".
2. If captions already exist, pick **Replace them** or **Add to them**.
3. Optional: **Move the imported captions by** a time such as `+2.5` or `-0:01.200`, for a file made for a cut with a different intro.
4. Confirm, review, then **Save transcript**. Nothing is saved before that, and you can undo the import.

### Export

**Export** downloads **WebVTT (.vtt)**, **SubRip (.srt)** or **Plain text (.txt)**, including unsaved edits.

### Fix timing

**Adjust timing...** moves all captions, the selected ones, or everything from a caption number on, by a time you type (positive = later). The **Frame rate** tab stretches captions made for another frame rate (for example "Made at 23.976 fps, video is 25 fps").

### Generate a transcript automatically

1. In **Automatic transcript**, choose the **Spoken language** or leave **Detect automatically**.
2. Click **Generate transcript** (or **Generate again**). If captions exist you are asked to confirm, because the result replaces them when it finishes.
3. You can leave the page; you get a notification when it is done. **Cancel** stops it.
4. Review the result against the video and save any fixes.

**What it needs.** Two things on the server, set up by whoever runs it:
- A speech-to-text service that speaks the OpenAI transcription format: `TRANSCRIBE_API_URL` (for example `https://api.openai.com/v1/audio/transcriptions`), `TRANSCRIBE_API_KEY` and optionally `TRANSCRIBE_MODEL` (default `whisper-1`) in `.env`, then restart.
- ffmpeg, to extract the audio.

If either is missing, the button is greyed out and the reason is shown. Admins can also switch on **Generate captions automatically** in Settings > Storage & video (off by default), so new video uploads are transcribed without anyone pressing the button.

**Good to know.** Up to 8,000 captions per transcript and 600 characters per caption. If someone else (or an automatic job) saved the transcript after you opened it, the editor asks which version to keep.

## Course sales page builder

**What it is.** A long-form landing page for a course: a hero with a headline, ordered sections, testimonials, an FAQ, a guarantee and an optional offer countdown. When a sales page exists, the public course page `/courses/<slug>` shows it; otherwise the course page keeps its standard layout. Reviews and related courses always follow the sections.

**Who can use it.** Anyone who can manage the course.

**Where.** `/admin/courses/<id>/sales-page`, from the **Sales page** button in the header of the course management page. The header shows **Live on the course page** or **Standard layout**, and **Course not published** if the course is still a draft.

### Start

The first time, choose:
- **Start from a template**: builds a page from the course's outcomes, outline and instructors.
- **Start blank**: an empty page with the course title as headline.

Until you add a headline or at least one section, the course page keeps the standard layout.

### Hero

- **Headline** (up to 120 characters): the promise of the course in one line; the page's main heading.
- **Subheadline** (up to 300 characters): who it is for and what they will be able to do.
- **Show course stats**: rating, number of learners, lessons and total length under the headline.

### Sections

Click **Add section** and pick a type. Sections show in the order you set (use the up/down arrows); up to 20 sections.

| Section | What it shows | Can repeat |
|---|---|---|
| **Text** | A heading and a few paragraphs of Markdown | Yes |
| **What you get** | A grid of benefits with icons (up to 12 items, each with an icon, a title and optional details) | Yes |
| **Curriculum** | The course outline: chapters, lessons, durations and free previews | No |
| **Instructor** | The instructors with their bio and teaching stats | No |
| **Testimonials** | The quotes from the Testimonials panel | No |
| **FAQ** | The questions from the FAQ panel | No |
| **Pricing** | The price, what is included, the guarantee and an enroll button | No |
| **Preview video** | The course's preview video (set in the course Details). Hidden if the course has none. | No |
| **Call to action** | A closing **Pitch** with the enroll button | Yes |

Every section has an optional **Heading**.

### Testimonials

Click **Add a testimonial**. Each has a name, an optional role ("Role (optional), e.g. Data analyst"), the quote (up to 800 characters), an optional rating (1 to 5 stars) and an optional square photo. Up to 12. Ask learners for permission before you publish a quote.

### Frequently asked questions

Click **Add a question**, then type the question and the answer (Markdown allowed). The FAQ is marked up for rich results in Google.

### Offer

- **Guarantee** (up to 1,000 characters, Markdown): shown with the price, for example "30-day money-back guarantee, no questions asked." It is text only; refunds are handled by an Admin.
- **Offer ends**: a date and time in your local time. Shows a live countdown in the hero and the pricing section until then; after it passes the countdown hides. **Remove the countdown** clears it. The countdown does not change the price; use a coupon (Admin) for a real discount.

### Search and sharing

How the course page appears in Google and in link previews, with a live snippet preview:
- **SEO title**: empty means the course title is used.
- **Meta description**: empty means it is generated from the short introduction. This is the same field as **Meta description** on the Settings tab.
- **Share image**: 1200×630. Empty means a card with the course title, instructor and rating is generated.

### Save, view, remove

- **Save sales page** in the bar at the bottom. **View course page** opens the public page.
- **Remove** returns the course page to the standard layout. Sections, testimonials, FAQ, guarantee and countdown are deleted; the SEO title, description and share image are kept.
- **Start over > Apply the template** replaces everything with a fresh template page.

**What learners see.** Visitors to `/courses/<slug>` see your landing page next to the enroll card, with your sections, quotes, FAQ, guarantee and countdown.
