"""Read-only exporter for the preserved SQLite database. Python standard library only."""
import argparse
import json
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path

CATEGORY_MAP = {'programming': 'Computer science', 'math': 'Mathematics', 'reading': 'Reading', 'general': 'General'}

def iso(value):
    if not value:
        return datetime.now(UTC).isoformat()
    dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    return (dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt).isoformat()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path)
    parser.add_argument('--output', type=Path, default=Path('legacy-ideas.json'))
    args = parser.parse_args()
    db = sqlite3.connect(args.database.resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    result = []
    namespace = uuid.uuid5(uuid.NAMESPACE_URL, 'ideaqueue-legacy/' + args.database.name)
    for table, tag_fk in [('items', 'item_id'), ('popped_items', 'popped_item_id')]:
        if table not in tables:
            continue
        for raw in db.execute(f'SELECT * FROM {table}'):
            row = dict(raw)
            tags = []
            if {'tags', 'item_tags'} <= tables:
                tags = [r[0] for r in db.execute(f'SELECT tags.name FROM tags JOIN item_tags ON tags.id=item_tags.tag_id WHERE item_tags.{tag_fk}=?', [row['id']])]
            category = next((CATEGORY_MAP[t] for t in tags if t in CATEGORY_MAP), 'General')
            text = str(row.get('text') or '').strip()
            context = str(row.get('context') or '').strip()
            if not text or len(text) > 2000 or len(context) > 4000:
                raise ValueError(f"{table} row {row['id']} is outside the new text limits; source data was not changed")
            result.append({
                'id': str(uuid.uuid5(namespace, f"{table}/{row['id']}")), 'text': text,
                'context': context, 'category': category, 'priority': max(1, min(10, int(row.get('priority') or 5))),
                'color': 'yellow', 'created_at': iso(row.get('created_at')),
                'reviewed_at': iso(row.get('popped_at')) if table == 'popped_items' else None,
            })
    db.close()
    args.output.write_text(json.dumps({'version': 1, 'ideas': result}, indent=2), encoding='utf-8')
    print(f'Exported {len(result)} notes to {args.output}. Source database was read only.')

if __name__ == '__main__':
    main()
