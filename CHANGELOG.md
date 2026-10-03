# Changelog

All notable changes to the LearnLoop LMS platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-03

### Added
- Complete custom learning management system built with Next.js 16, React 19, and TypeScript.
- Custom video player featuring adaptive HLS bitrate streaming without third-party host dependencies.
- Resumable video upload pipeline with AWS S3 / MinIO and local disk drivers.
- Native SQLite data layer with WAL mode, automated migrations, and JSON export/import.
- Role-based access control for Admins, Instructors, Learners, and Teaching Assistants.
- Built-in multi-currency checkout, installments, order bumps, coupons, and tax calculations.
- Gamification engine with badges, points, streaks, and manual point adjustments.
- Peer review management and rubric evaluation workflows.
- AI Tutor integration with Anthropic model providers and BM25 content indexing.
- Multi-language localization support (English, Arabic, Spanish, French, Hindi).
- Progressive Web App (PWA) offline support and calendar subscription feeds (ICS).
- Automated backup, restore, and JSON data export utility scripts.
