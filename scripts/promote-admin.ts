// One-time bootstrap: promote the first admin (design §7 — there is
// deliberately no in-app path to self-promote).
//
//   pnpm db:promote-admin you@example.com
//
// Refuses if an admin already exists; later role changes go through the
// in-app admin user management screens.
import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";

import * as schema from "../src/db/schema";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: pnpm db:promote-admin <email>");
    process.exit(1);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle({ client: pool, schema });

  try {
    const existingAdmin = await db.query.user.findFirst({
      where: eq(schema.user.role, "admin"),
      columns: { email: true },
    });
    if (existingAdmin) {
      console.error(
        `An admin already exists (${existingAdmin.email}). ` +
          "Use the in-app user management to change roles.",
      );
      process.exit(1);
    }

    const [promoted] = await db
      .update(schema.user)
      .set({ role: "admin", updatedAt: new Date() })
      .where(eq(schema.user.email, email))
      .returning({ email: schema.user.email });

    if (!promoted) {
      console.error(
        `No user with email ${email}. Sign in once first, then re-run.`,
      );
      process.exit(1);
    }
    console.log(`Promoted ${promoted.email} to admin.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
