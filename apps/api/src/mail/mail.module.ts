import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';

@Module({
  imports: [GoogleModule],
  controllers: [MailController],
  providers: [MailService],
})
export class MailModule {}
