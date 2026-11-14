import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "~/db/schema";
import { courses, lessons, modules, notes } from "~/db/schema";

// ─── Notes ───
// A Student's own writing about a Lesson. See GLOSSARY.md for the language.
//
// A Note is private to the Student who wrote it: every read here is keyed on
// the owning Student's id, and nothing outside that Student's own Lesson page
// and Saved page may read a Note body.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

export type Db = BetterSQLite3Database<typeof schema>;

type Note = typeof notes.$inferSelect;

const MAX_NOTE_LENGTH = 2000;

const noteBodySchema = z
  .string()
  .trim()
  .min(1, "Write something before saving your note.")
  .max(
    MAX_NOTE_LENGTH,
    `A note must be ${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters or fewer.`
  );

/** The Student's own Note on the Lesson, if they have written one. */
export function getNote(db: Db, userId: number, lessonId: number) {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.lessonId, lessonId)))
    .get();
}

export type SaveNoteResult =
  { ok: true; note: Note } | { ok: false; error: string };

/**
 * Stores the Student's Note on the Lesson. Saving again replaces the body and
 * moves the "last edited" time on; the creation time stays put. The body is
 * trimmed, and an empty or over-long one is refused rather than truncated.
 */
export function saveNote(
  db: Db,
  userId: number,
  lessonId: number,
  body: string,
  now: Date
): SaveNoteResult {
  const parsed = noteBodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const savedAt = now.toISOString();
  const note = db
    .insert(notes)
    .values({
      userId,
      lessonId,
      body: parsed.data,
      createdAt: savedAt,
      updatedAt: savedAt,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: parsed.data, updatedAt: savedAt },
    })
    .returning()
    .get();

  return { ok: true, note };
}

/**
 * The Student's own Notes, most recently edited first, each with the Lesson
 * and Course it belongs to.
 */
export function listNotes(db: Db, userId: number) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(notes)
    .innerJoin(lessons, eq(lessons.id, notes.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}
