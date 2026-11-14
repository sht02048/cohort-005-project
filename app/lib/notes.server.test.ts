import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { getNote, listNotes, saveNote } from "./notes.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function minutesAfter(minutes: number) {
  return new Date(NOW.getTime() + minutes * 60_000);
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2, 3].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

describe("saving a Note", () => {
  it("creates the Note on a Lesson that has none, with the body trimmed", () => {
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();

    const result = saveNote(
      db,
      base.user.id,
      lessonIds[0],
      "  Generics are just functions for types.\n\n# not a heading  ",
      NOW
    );

    expect(result.ok).toBe(true);
    expect(getNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "Generics are just functions for types.\n\n# not a heading",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it("replaces the body and moves the last edited time on when saved again", () => {
    saveNote(db, base.user.id, lessonIds[0], "First thoughts.", NOW);
    const later = minutesAfter(30);

    saveNote(db, base.user.id, lessonIds[0], "Second thoughts.", later);

    expect(getNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "Second thoughts.",
      createdAt: NOW.toISOString(),
      updatedAt: later.toISOString(),
    });
  });

  it("never leaves a Student with two Notes on one Lesson", () => {
    saveNote(db, base.user.id, lessonIds[0], "One.", NOW);
    saveNote(db, base.user.id, lessonIds[0], "Two.", minutesAfter(1));

    expect(listNotes(db, base.user.id)).toHaveLength(1);
    expect(() =>
      db
        .insert(schema.notes)
        .values({ userId: base.user.id, lessonId: lessonIds[0], body: "Three." })
        .run()
    ).toThrow();
  });

  it("accepts a Note of exactly 2,000 characters", () => {
    const body = "a".repeat(2000);

    expect(saveNote(db, base.user.id, lessonIds[0], body, NOW).ok).toBe(true);
    expect(getNote(db, base.user.id, lessonIds[0])?.body).toBe(body);
  });

  it("measures the 2,000 characters after trimming", () => {
    const body = "a".repeat(2000);

    expect(
      saveNote(db, base.user.id, lessonIds[0], `  ${body}\n\n`, NOW).ok
    ).toBe(true);
    expect(getNote(db, base.user.id, lessonIds[0])?.body).toBe(body);
  });

  it("refuses a Note over 2,000 characters and stores nothing", () => {
    expect(
      saveNote(db, base.user.id, lessonIds[0], "a".repeat(2001), NOW)
    ).toEqual({
      ok: false,
      error: "A note must be 2,000 characters or fewer.",
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });

  it("refuses an over-long Note without touching the existing one", () => {
    saveNote(db, base.user.id, lessonIds[0], "Keep me.", NOW);

    saveNote(db, base.user.id, lessonIds[0], "a".repeat(2001), minutesAfter(1));

    expect(getNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "Keep me.",
      updatedAt: NOW.toISOString(),
    });
  });

  it("refuses a body that is only whitespace", () => {
    expect(saveNote(db, base.user.id, lessonIds[0], "   \n ", NOW)).toEqual({
      ok: false,
      error: "Write something before saving your note.",
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });

  it("keeps each Student's Note on the same Lesson separate", () => {
    const ben = addStudent("Ben");
    saveNote(db, ben.id, lessonIds[0], "Ben's note.", NOW);
    saveNote(db, base.user.id, lessonIds[0], "My note.", NOW);

    expect(getNote(db, ben.id, lessonIds[0])?.body).toBe("Ben's note.");
    expect(getNote(db, base.user.id, lessonIds[0])?.body).toBe("My note.");
  });
});

describe("listing a Student's Notes", () => {
  it("lists them most recently edited first, each with its Lesson and Course", () => {
    saveNote(db, base.user.id, lessonIds[0], "Oldest, then edited.", minutesAfter(0));
    saveNote(db, base.user.id, lessonIds[1], "Middle.", minutesAfter(1));
    saveNote(db, base.user.id, lessonIds[2], "Newest.", minutesAfter(2));
    saveNote(db, base.user.id, lessonIds[0], "Edited last.", minutesAfter(3));

    expect(listNotes(db, base.user.id)).toMatchObject([
      {
        body: "Edited last.",
        updatedAt: minutesAfter(3).toISOString(),
        lessonId: lessonIds[0],
        lessonTitle: "Lesson 1",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      },
      { body: "Newest.", lessonId: lessonIds[2] },
      { body: "Middle.", lessonId: lessonIds[1] },
    ]);
  });

  it("lists only that Student's Notes", () => {
    const ben = addStudent("Ben");
    saveNote(db, ben.id, lessonIds[0], "Ben's note.", NOW);
    saveNote(db, base.user.id, lessonIds[1], "My note.", NOW);

    expect(listNotes(db, base.user.id)).toMatchObject([{ body: "My note." }]);
  });
});
