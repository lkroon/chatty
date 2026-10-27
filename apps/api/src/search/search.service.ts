import { Inject, ServiceUnavailableException } from '@nestjs/common';import { sql } from 'drizzle-orm';
import type { SearchHit } from '@contracts/search';
import { DB, type Db } from '../db/tokens';
import { EMBEDDER, type Embedder } from '../embeddings/embeddings.service';
import { toVectorLiteral } from './vector-literal';

const RESULT_LIMIT = 20;

interface SearchRow {
  [key: string]: unknown;
  message_id: string;
  conversation_id: string;
  conversation_title: string | null;
  role: string;
  snippet: string | null;
  score: string | number;
  created_at: Date | string;
}

/**
 * Feature B: semantic search over message embeddings. The query is
 * embedded with the same model that embedded the stored messages, then
 * ranked by pgvector cosine distance (`<=>`) — cosine is
 * magnitude-invariant, so un-normalized truncated-dimension vectors are
 * fine (the "normalize non-3072 dims" warning applies to dot-product
 * similarity, not cosine).
 */
export class SearchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EMBEDDER) private readonly embedder: Embedder,
  ) {}

  async search(accountId: string, query: string): Promise<SearchHit[]> {
    if (!this.embedder.enabled) {
      throw new ServiceUnavailableException('search is not available');
    }

    const queryVector = await this.embedder.embedText(query);
    const vectorLiteral = toVectorLiteral(queryVector);

    const result = await this.db.execute<SearchRow>(sql`
      select m.id as message_id,
             m.role as role,
             left(m.content, 200) as snippet,
             m.created_at as created_at,
             c.id as conversation_id,
             c.title as conversation_title,
             1 - (me.embedding <=> ${vectorLiteral}::vector) as score
      from message_embeddings me
      join messages m on m.id = me.message_id
      join conversations c on c.id = m.conversation_id
      where c.account_id = ${Number(accountId)}
      order by me.embedding <=> ${vectorLiteral}::vector
      limit ${RESULT_LIMIT}`);

    return result.rows.map((row) => ({
      conversationId: row.conversation_id,
      conversationTitle: row.conversation_title ?? '',
      messageId: row.message_id,
      role: row.role as SearchHit['role'],
      snippet: row.snippet ?? '',
      score: Number(row.score),
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
}
