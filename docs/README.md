# LearnLoop LMS — documentation

There is one handbook per role. Each one explains everything that role can do on the platform: where to find it, and how to do it step by step.

| You are… | Your handbook |
|---|---|
| A student (or a visitor deciding to join) | [Student handbook](roles/student.md) |
| An instructor or course creator | [Instructor handbook](roles/instructor.md) |
| An evaluator who grades and runs evaluations | [Evaluator handbook](roles/evaluator.md) |
| An administrator or moderator running the platform | [Administrator handbook](roles/admin.md) |

> **Status of the software.** Rounds 1 and 2 are finished and were tested page by page as guest, student, instructor and admin. Round 3 features (marked in each handbook) are built and covered by automated tests, but have not yet been tried in a browser. Page text is in English; the menus and sign-in pages can also switch to Hindi, Arabic (right-to-left), Spanish and French.

## Quick facts

- **Local address:** `http://localhost:3000` after `npm run dev` (set by `APP_URL` in `.env`).
- **Demo accounts** (password `password123`): `admin@learnloop.test` (admin), `maya@learnloop.test` (instructor and moderator), `priya@learnloop.test` (evaluator), `alex@learnloop.test` (student).
- **Data:** stored in `storage/lms.sqlite`; uploaded files in the uploads folder (`UPLOAD_DIR`). Neither is pushed to GitHub.
- **Settings:** secrets and server options live in `.env` (template: `.env.example`); everything else is under **Admin → Settings** (`/admin/settings`).
- **Going live:** see the administrator handbook, then [DEPLOYMENT.md](../DEPLOYMENT.md).

The older topic-based drafts in [guide/](guide/) were the starting material for these handbooks and are not maintained.
