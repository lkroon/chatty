import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

// Feature B: GET /api/search?q=. EmbeddingsModule supplies the EMBEDDER
// seam (the query must be embedded with the same model that embedded the
// stored messages).
@Module({
  imports: [DbModule, EmbeddingsModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
