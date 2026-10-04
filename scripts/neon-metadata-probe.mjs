import pg from "pg";
const { Client } = pg;

if (process.env.VERCEL_ENV !== "preview" || !process.env.DATABASE_URL) process.exit(0);

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  application_name: "turbolev-neon-metadata-probe",
  statement_timeout: 5000,
});
await client.connect();
try {
  const result = await client.query(`
    SELECT current_setting('neon.project_id', true) AS project_id,
           current_setting('neon.branch_id', true) AS branch_id,
           current_setting('neon.endpoint_id', true) AS endpoint_id,
           current_database() AS database
  `);
  const row = result.rows[0] || {};
  console.log("[neon-metadata-probe] " + JSON.stringify({
    projectId: row.project_id || null,
    branchId: row.branch_id || null,
    endpointId: row.endpoint_id || null,
    database: row.database || null,
  }));
} finally {
  await client.end();
}
