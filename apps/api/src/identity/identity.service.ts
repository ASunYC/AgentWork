import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient } from '@agentwork/database';
import { argon2id, hash, verify } from 'argon2';
import { createHash } from 'node:crypto';
import { sign } from 'jsonwebtoken';
import { PRISMA } from '../common/database';
import { SignupGrantPort } from '../common/signup-grant.port';

@Injectable()
export class IdentityService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly grants: SignupGrantPort,
  ) {}

  async register(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    const passwordHash = await hash(password, {
      type: argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    let user;
    try {
      user = await this.db.user.create({
        data: { email, passwordHash, status: 'ACTIVE' },
        select: { id: true, email: true, status: true, createdAt: true },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
    await this.grants.request({
      subjectType: 'USER',
      subjectId: user.id,
      fingerprint: createHash('sha256').update(`user:${email}`).digest('hex'),
      amount: 1000n,
    });
    return { user, token: this.token(user.id, user.email) };
  }

  async login(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || !(await verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return {
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        createdAt: user.createdAt,
      },
      token: this.token(user.id, user.email),
    };
  }

  async me(id: string) {
    return this.db.user.findUniqueOrThrow({
      where: { id },
      select: { id: true, email: true, status: true, createdAt: true },
    });
  }

  private token(id: string, email: string): string {
    return sign(
      { id, email, role: 'USER' satisfies HumanRole },
      process.env.AUTH_JWT_SECRET ?? 'development-only-change-me',
      { expiresIn: '7d', subject: id },
    );
  }
}

type HumanRole = 'USER' | 'ADMIN';
