# lms

LearnLoop is a complete learning management system built with Next.js 16, React 19, TypeScript and Tailwind CSS. Everything is custom: the interface, the video player with adaptive streaming (no YouTube or Vimeo), payments, email, and the SQLite data layer.

**Full user guide:** [docs/README.md](docs/README.md) — how to use every feature, who can use it, where to find it, and how to set it up.

## Quick start

1. Install Node.js 24 or newer.
2. `npm install`
3. Copy `.env.example` to `.env` and set at least `APP_URL` and `APP_SECRET` (32+ characters).
4. `npm run dev`, then open `http://localhost:3000`.
5. Sign in with a demo account (password `password123`): `admin@learnloop.test`, `maya@learnloop.test`, `priya@learnloop.test` or `alex@learnloop.test`.

Run the automated tests with `npm test`. For a real server, see [DEPLOYMENT.md](DEPLOYMENT.md).
