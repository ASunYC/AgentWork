import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ApiExceptionFilter } from './common/api-error';

async function bootstrap() {
  for (const name of ['AUTH_JWT_SECRET', 'CHALLENGE_SECRET'])
    if (!process.env[name]) throw new Error(`${name} is required`);
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(Number(process.env.PORT ?? 3001));
}

void bootstrap();
