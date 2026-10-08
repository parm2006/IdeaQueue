export type Category = 'General' | 'Projects' | 'Computer science' | 'Mathematics' | 'Reading' | 'Personal';
export type NoteColor = 'yellow' | 'pink' | 'green' | 'blue' | 'purple';

export interface Idea {
  id: string;
  text: string;
  context: string;
  category: Category;
  priority: number;
  color: NoteColor;
  created_at: string;
  reviewed_at: string | null;
}

export const categories: Category[] = ['General', 'Projects', 'Computer science', 'Mathematics', 'Reading', 'Personal'];
export const colors: NoteColor[] = ['yellow', 'pink', 'green', 'blue', 'purple'];

export const DAY_MS = 86400000;

/** Priority backdates the UTC creation day; stored timestamps and priorities stay intact. */
export function effectiveDay(idea: Idea): number {
  return Math.floor(Date.parse(idea.created_at) / DAY_MS) - idea.priority;
}

/** The virtual UTC midnight of the adjusted ranking day, never persisted. */
export function effectiveDate(idea: Idea): number {
  return effectiveDay(idea) * DAY_MS;
}

/** UTC calendar days since the ranking day, calculated on demand without a cap. */
export function effectivePriority(idea: Idea, now = Date.now()): number {
  return Math.floor(now / DAY_MS) - effectiveDay(idea);
}

function compareIdeas(a: Idea, b: Idea): number {
  const adjustedDay = effectiveDay(b) - effectiveDay(a);
  if (adjustedDay !== 0) return adjustedDay;
  const basePriority = a.priority - b.priority;
  if (basePriority !== 0) return basePriority;
  const created = Date.parse(b.created_at) - Date.parse(a.created_at);
  if (Number.isFinite(created) && created !== 0) return created;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** A binary max heap: oldest adjusted UTC day, highest base priority, then timestamp/id FIFO. */
export class PriorityQueue {
  private heap: Idea[];

  // The optional clock argument is retained for compatibility; date ordering does not use it.
  constructor(ideas: Idea[] = [], _now = Date.now()) {
    this.heap = [...ideas];
    for (let i = Math.floor(this.heap.length / 2) - 1; i >= 0; i--) this.siftDown(i);
  }

  get size(): number {
    return this.heap.length;
  }

  peek(): Idea | undefined {
    return this.heap[0];
  }

  push(idea: Idea): void {
    this.heap.push(idea);
    let index = this.heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareIdeas(this.heap[index], this.heap[parent]) <= 0) break;
      [this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]];
      index = parent;
    }
  }

  pop(): Idea | undefined {
    if (this.heap.length === 0) return undefined;
    const first = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return first;
  }

  private siftDown(index: number): void {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < this.heap.length && compareIdeas(this.heap[left], this.heap[best]) > 0) best = left;
      if (right < this.heap.length && compareIdeas(this.heap[right], this.heap[best]) > 0) best = right;
      if (best === index) return;
      [this.heap[index], this.heap[best]] = [this.heap[best], this.heap[index]];
      index = best;
    }
  }
}

export function orderIdeas(ideas: Idea[], now = Date.now()): Idea[] {
  const queue = new PriorityQueue(ideas, now);
  const ordered: Idea[] = [];
  while (queue.size > 0) ordered.push(queue.pop()!);
  return ordered;
}

const categoryKeywords: [Category, RegExp][] = [
  ['Mathematics', /\b(math|mathematics|calculus|algebra|theorem|geometry|probability|integral|derivative|proof)\b/i],
  ['Computer science', /\b(computer science|code|coding|python|javascript|typescript|database|algorithm|algorithms|programming|compiler|software)\b/i],
  ['Projects', /\b(project|projects|prototype|app|website|startup|side project|build)\b/i],
  ['Reading', /\b(read|reading|book|books|novel|article|essay|literature)\b/i],
  ['Personal', /\b(personal|family|friend|friends|health|exercise|workout|journal|holiday|vacation|birthday)\b/i],
];

export function inferCategory(text: string): Category {
  return categoryKeywords.find(([, keywords]) => keywords.test(text))?.[0] ?? 'General';
}

export function createIdea(input: {
  text: string;
  context?: string;
  category?: Category;
  priority?: number;
  color?: NoteColor;
}, now = Date.now()): Idea {
  const text = input.text.trim();
  const context = (input.context ?? '').trim();
  const category = input.category ?? inferCategory(text);
  const priority = input.priority ?? 5;
  const color = input.color ?? 'yellow';
  if (!text || text.length > 2000) throw new Error('Idea text must contain 1–2000 characters.');
  if (context.length > 4000) throw new Error('Context must contain at most 4000 characters.');
  if (!Number.isInteger(priority) || priority < 1 || priority > 10) throw new Error('Priority must be an integer from 1 to 10.');
  if (!categories.includes(category)) throw new Error('Choose a valid category.');
  if (!colors.includes(color)) throw new Error('Choose a valid note color.');
  return { id: crypto.randomUUID(), text, context, category, priority, color, created_at: new Date(now).toISOString(), reviewed_at: null };
}

export function seedIdeas(now = Date.now()): Idea[] {
  const examples: Parameters<typeof createIdea>[0][] = [
    { text: 'Why does the quadratic formula work?', context: 'Try deriving it by completing the square, then sketch what the discriminant tells us.', category: 'Mathematics', priority: 7, color: 'yellow' },
    { text: 'Build a tiny neighborhood book exchange', context: 'Start with a simple page where neighbors can list books they are happy to lend.', category: 'Projects', priority: 6, color: 'pink' },
    { text: 'Call Grandma this weekend', context: 'Ask about the garden and the old family photos.', category: 'Personal', priority: 8, color: 'green' },
    { text: 'Understand how database indexes work', context: 'Compare a full table scan with a B-tree lookup using a small example.', category: 'Computer science', priority: 6, color: 'blue' },
    { text: 'Read a chapter before bed', context: 'Leave the phone in another room and keep the book on the nightstand.', category: 'Reading', priority: 4, color: 'purple' },
    { text: 'Make a playlist for rainy walks', context: '', category: 'General', priority: 3, color: 'yellow' },
    { text: 'Try a Sunday meal prep routine', context: 'Pick two easy lunches and write a short shopping list.', category: 'Personal', priority: 5, color: 'pink' },
  ];
  return examples.map((example, index) => createIdea(example, now - index * 12 * 60 * 60 * 1000));
}
