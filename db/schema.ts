import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const ideas = sqliteTable('ideas', {
  id: text('id').primaryKey(),
  text: text('text').notNull(),
  context: text('context').notNull().default(''),
  category: text('category').notNull(),
  priority: integer('priority').notNull().default(5),
  color: text('color').notNull().default('yellow'),
  created_at: text('created_at').notNull(),
  reviewed_at: text('reviewed_at'),
}, (table) => [
  index('ideas_reviewed_category_idx').on(table.reviewed_at, table.category),
]);
