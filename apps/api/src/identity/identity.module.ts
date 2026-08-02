import { Module } from '@nestjs/common';
import { DatabaseModule } from '../common/database';
import {
  SignupGrantPort,
  UnconfiguredSignupGrantAdapter,
} from '../common/signup-grant.port';
import { HumanAuthGuard } from './auth';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

@Module({
  imports: [DatabaseModule],
  controllers: [IdentityController],
  providers: [
    IdentityService,
    HumanAuthGuard,
    { provide: SignupGrantPort, useClass: UnconfiguredSignupGrantAdapter },
  ],
  exports: [HumanAuthGuard, SignupGrantPort],
})
export class IdentityModule {}
