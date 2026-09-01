import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { ConversationsModule } from './conversations/conversations.module';
import { ChatModule } from './chat/chat.module';
import { OpencodeModule } from './opencode/opencode.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    AuthModule,
    DbModule,
    ConversationsModule,
    ChatModule,
    OpencodeModule,
    // Serves the Angular build (copied into apps/api/public by workstream
    // F's Dockerfile). Registered LAST so its SPA fallback route doesn't
    // shadow /api and /auth routes registered above.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api/{*splat}', '/auth/{*splat}'],
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
