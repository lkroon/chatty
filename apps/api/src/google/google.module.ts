import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { GoogleConnectController } from './google-connect.controller';
import { GoogleConnectionController } from './google-connection.controller';
import { GoogleConnectionsRepository } from './google-connections.repository';
import { GoogleTokenService } from './google-token.service';

// The opt-in Calendar/Gmail grant. Exports GoogleTokenService because
// BriefingModule needs an access token.
@Module({
  imports: [DbModule],
  controllers: [GoogleConnectController, GoogleConnectionController],
  providers: [GoogleConnectionsRepository, GoogleTokenService],
  // ProposalsModule needs the granted scopes to tell "not connected" apart
  // from "connected before write tools existed".
  exports: [GoogleTokenService, GoogleConnectionsRepository],
})
export class GoogleModule {}
