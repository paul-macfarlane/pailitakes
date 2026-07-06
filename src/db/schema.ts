// Drizzle schema. Auth tables are managed by Better Auth via its Drizzle
// adapter; `user` is extended with `role` and `banned_at` (design §4).
// Application tables land with their epics (posts/POST, comments/CMT, ...).

import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// drizzle-orm ^0.45 has no built-in tsvector column type; define one custom
// type used by the generated `search` column on `posts` (design §4).
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const userRole = pgEnum("user_role", ["reader", "author", "admin"]);

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: userRole("role").notNull().default("reader"),
  bannedAt: timestamp("banned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Posts domain (design §4, POST-1).

export const postStatus = pgEnum("post_status", [
  "draft",
  "scheduled",
  "published",
  "archived",
]);

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // No onDelete: deleting a user with authored posts should fail loudly;
    // there is no user-deletion flow in v1.
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    title: text("title").notNull(),
    slug: text("slug").notNull().unique(),
    bodyMd: text("body_md").notNull(),
    thumbnailUrl: text("thumbnail_url").notNull(),
    // Post-page hero (POST-9); null falls back to thumbnailUrl.
    bannerUrl: text("banner_url"),
    videoUrl: text("video_url"),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    status: postStatus("status").notNull().default("draft"),
    commentsLocked: boolean("comments_locked").notNull().default(false),
    publishAt: timestamp("publish_at", { withTimezone: true }),
    archiveAt: timestamp("archive_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Better Auth maintains updatedAt on its own tables; for posts, Drizzle
    // sets it on every db.update() via $onUpdate.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    search: tsvector("search")
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`setweight(to_tsvector('english', ${posts.title}), 'A') || setweight(to_tsvector('english', ${posts.bodyMd}), 'B')`,
      ),
  },
  (table) => [
    index("posts_search_idx").using("gin", table.search),
    // Serves visiblePostsWhere(): status equality list + publish_at range.
    // Does NOT cover the revalidation cron's publish_at/archive_at crossing
    // scans — those stay seq scans until the table outgrows blog scale.
    index("posts_status_publish_at_idx").on(table.status, table.publishAt),
    // FK companion indexes: category pages filter by category_id; authors
    // are scoped to their own rows in /admin (author_id).
    index("posts_category_id_idx").on(table.categoryId),
    index("posts_author_id_idx").on(table.authorId),
  ],
);

export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const postTags = pgTable(
  "post_tags",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.tagId] }),
    // The composite PK leads with post_id; tag-side lookups (tag pages,
    // tag-delete cascade) need their own index.
    index("post_tags_tag_id_idx").on(table.tagId),
  ],
);
