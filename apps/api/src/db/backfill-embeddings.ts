import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, type SQL } from 'drizzle-orm';
import { Pool } from 'pg';
import { EmbeddingClient } from '../embeddings/embedding-client';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { toVectorLiteral } from '../search/vector-literal';

const BATCH_SIZE = 64;

// Feature B backfill: embed every message that has no embedding row yet.
// Modeled on run-migrations.ts — run directly against a Postgres instance:
//
//   DATABASE_URL=postgresql://... npx ts-node src/db/backfill-embeddings.ts
//
// (with the EMBEDDING_* env set). Deliberately imports no @contracts/*
// module: run-migrations must work under plain ts-node with no
// tsconfig-paths shim, and this script keeps the same property. That is
// also why the insert is raw SQL with toVectorLiteral, not a Drizzle
// schema insert (schema.ts imports @contracts/chat).
//
// Re-runnable: ON CONFLICT DO NOTHING, and the WHERE NOT EXISTS selection
// makes already-embedded batches fall out of the loop immediately.
export async function backfillEmbeddings(
  databaseUrl: string,
  embeddings: EmbeddingsService,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  let embedded = 0;

  for (;;) {
    const batch = await db.execute<{ id: string; content: string }>(sql`
      select m.id, m.content
      from messages m
      where m.content <> ''
        and not exists (
          select 1 from message_embeddings me where me.message_id = m.id
        )
      order by m.sequence
      limit ${BATCH_SIZE}`);

    if (batch.rows.length === 0) {
      break;
    }

    const vectors = await embeddings.embedTexts(
      batch.rows.map((row) => row.content),
    );

    const values: SQL[] = batch.rows.map(
      (row, i) =>
        sql`(${row.id}, ${toVectorLiteral(vectors[i] ?? [])}::vector, ${embeddings.model})`,
    );
    await db.execute(sql`
      insert into message_embeddings (message_id, embedding, model)
      values ${sql.join(values, sql`, `)}
      on conflict (message_id) do nothing`);

    embedded += batch.rows.length;
    console.log(`embedded ${embedded} messages`);
  }

  await pool.end();
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const embeddings = new EmbeddingsService(
    new EmbeddingClient(
      process.env.EMBEDDING_BASE_URL ?? '',
      process.env.EMBEDDING_API_KEY ?? '',
    ),
  );
  if (!embeddings.enabled) {
    console.error(
      'embedding env is required: EMBEDDING_API_KEY, EMBEDDING_BASE_URL, EMBEDDING_MODEL',
    );
    process.exit(1);
  }

  backfillEmbeddings(url, embeddings)
    .then(() => {
      console.log('backfill complete');
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
