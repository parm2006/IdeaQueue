# IdeaQueue

--ALSO, If we can, use whisper model to STT a question to text, and then sort it into a bucket that represents each class so i have a database of all the questions i need to ask in class

> Status as of May 2, 2026: restart candidate.

IdeaQueue should become a lightweight, remote-accessible idea capture app for phone and laptop.

## Desired Product

The main use case is simple: if Parth has a thought in class or while away from the laptop, he can quickly add it from his phone. The idea is stored in a database, prioritized, and later surfaced when he wants to process ideas.

The core metaphor is a heap/priority queue:

- Add ideas quickly with minimal friction.
- Store every idea durably in a database.
- Assign or compute priority.
- Pop the highest-priority idea when ready to review.
- Work across phone and laptop.

## Current Implementation

The current implementation is considered unreliable and not worth preserving as-is.

Existing stack:

- FastAPI backend.
- SQLite/SQLAlchemy database.
- Vanilla HTML/CSS/JS frontend.
- Local database file.

Known problem: the frontend is bad and should be restarted. The backend may also be restarted if it is simpler than repairing the current design.

## Restart Direction

Recommended next build:

1. Define the minimum data model: idea text, priority, created time, optional category/status, and popped/reviewed state.
2. Rebuild the backend around a small, tested API.
3. Rebuild the frontend for fast capture first, especially mobile.
4. Add remote access/deployment after local behavior is reliable.

## Useful Ideas From The Old Version

The old `project_description.json` mentions several ideas that may still be worth reusing:

- Priority increases over time.
- Sorting by priority and creation time.
- Categories/filters.
- A pop endpoint.
- A small widget view.

Treat those as product ideas, not code that must be preserved.
