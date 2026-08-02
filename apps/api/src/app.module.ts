import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { IdentityModule } from './identity/identity.module';

@Module({
  imports: [IdentityModule],
  controllers: [AppController],
})
export class AppModule {}
