# Contributing to LearnLoop

Thank you for your interest in contributing to LearnLoop!

## Code of Conduct

Please treat everyone with respect and empathy. We are committed to providing a welcoming, inclusive, and harassment-free experience for everyone.

## Getting Started

1. **Fork the repository** on GitHub.
2. **Clone your fork**:
   ```bash
   git clone https://github.com/<your-username>/LMSA.git
   cd LMSA
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Environment setup**:
   ```bash
   cp .env.example .env
   ```
   Ensure `APP_URL` and `APP_SECRET` are configured.

5. **Start development server**:
   ```bash
   npm run dev
   ```

## Development Standards

- **TypeScript**: Strict type checking is enabled. Avoid using `any`.
- **Testing**: Run test suite before opening a pull request with `npm test`.
- **Linting**: Ensure code adheres to ESLint rules via `npm run lint`.
- **Git Commits**: Follow [Conventional Commits](https://www.conventionalcommits.org/) format:
  - `feat:` for new features
  - `fix:` for bug fixes
  - `docs:` for documentation changes
  - `test:` for adding or updating tests
  - `refactor:` for code changes that neither fix bugs nor add features
  - `chore:` for updating build tasks, package manager configs, etc.

## Pull Request Process

1. Create a descriptive branch name (e.g. `feat/user-preferences` or `fix/video-buffering`).
2. Make atomic commits with clear commit messages.
3. Verify that all automated tests pass.
4. Submit a Pull Request targeting the `main` branch with a summary of changes.
