import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { GoogleConnectController } from './google-connect.controller';
import { GoogleConnectionController } from './google-connection.controller';
import { GoogleConnectionsRepository } from './google-connections.repository';
import { GoogleTokenService } from './google-token.service';

// The opt-in Calendar/Gmail grant. Exports GoogleTokenService because
// BriefingModule needs an access token; the repository stays private.
@Module({
  imports: [DbModule],
  controllers: [GoogleConnectController, GoogleConnectionController],
  providers: [GoogleConnectionsRepository, GoogleTokenService],
  exports: [GoogleTokenService],
})
export class GoogleModule {}
