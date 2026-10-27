import { Module } from '@nestjs/common';
import { EmbeddingClient } from './embedding-client';
import { EmbeddingsService, EMBEDDER } from './embeddings.service';

// Feature B: pgvector-backed embeddings of message content, written on
// the paths that already persist messages (ConversationsService) and read
// by the search module. Owns nothing but the provider seam.
@Module({
  providers: [
    {
      // Env is read here, once at bootstrap — the client itself stays a
      // dumb transport so its unit tests can pass any base URL.
      provide: EmbeddingClient,
      useFactory: () =>
        new EmbeddingClient(
          process.env.EMBEDDING_BASE_URL ?? '',
          process.env.EMBEDDING_API_KEY ?? '',
        ),
    },
    EmbeddingsService,
    { provide: EMBEDDER, useExisting: EmbeddingsService },
  ],
  exports: [EMBEDDER],
})
export class EmbeddingsModule {}
