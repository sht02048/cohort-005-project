import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { isBookmarked, listBookmarks, toggleBookmark } from "./bookmarks.server";

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

describe("toggling a Bookmark", () => {
  it("bookmarks a Lesson that has no Bookmark", () => {
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(false);

    expect(toggleBookmark(db, base.user.id, lessonIds[0], NOW)).toBe(true);

    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(true);
  });

  it("removes the Bookmark when toggled again", () => {
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);

    expect(toggleBookmark(db, base.user.id, lessonIds[0], NOW)).toBe(false);

    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(false);
    expect(listBookmarks(db, base.user.id)).toEqual([]);
  });

  it("never leaves a Student with two Bookmarks on one Lesson", () => {
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);

    expect(listBookmarks(db, base.user.id)).toHaveLength(1);
    expect(() =>
      db
        .insert(schema.bookmarks)
        .values({ userId: base.user.id, lessonId: lessonIds[0] })
        .run()
    ).toThrow();
  });

  it("leaves another Student's Bookmark on the same Lesson alone", () => {
    const ben = addStudent("Ben");
    toggleBookmark(db, ben.id, lessonIds[0], NOW);
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);

    toggleBookmark(db, base.user.id, lessonIds[0], NOW);

    expect(isBookmarked(db, ben.id, lessonIds[0])).toBe(true);
  });
});

describe("listing a Student's Bookmarks", () => {
  it("lists them newest first, each with its Lesson and Course", () => {
    toggleBookmark(db, base.user.id, lessonIds[0], minutesAfter(0));
    toggleBookmark(db, base.user.id, lessonIds[2], minutesAfter(2));
    toggleBookmark(db, base.user.id, lessonIds[1], minutesAfter(1));

    expect(listBookmarks(db, base.user.id)).toMatchObject([
      {
        lessonId: lessonIds[2],
        lessonTitle: "Lesson 3",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      },
      { lessonId: lessonIds[1], lessonTitle: "Lesson 2" },
      { lessonId: lessonIds[0], lessonTitle: "Lesson 1" },
    ]);
  });

  it("lists only that Student's Bookmarks", () => {
    const ben = addStudent("Ben");
    toggleBookmark(db, ben.id, lessonIds[0], NOW);
    toggleBookmark(db, base.user.id, lessonIds[1], NOW);

    expect(listBookmarks(db, base.user.id)).toMatchObject([
      { lessonId: lessonIds[1] },
    ]);
  });
});
