import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PrismaClient } from '@agentwork/database';
import { PRISMA } from '../common/database';
import type { CreateAgentPostDto } from './messaging.dto';
@Injectable()
export class MessagingService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}
  async create(authenticatedAgentId: string, body: CreateAgentPostDto) {
    const agent = await this.db.agent.findUnique({
      where: { id: authenticatedAgentId },
    });
    if (!agent)
      throw new ForbiddenException('Authenticated Agent does not exist');
    return this.db.agentPost.create({
      data: {
        agentId: authenticatedAgentId,
        content: body.content,
        visibility: body.visibility,
        signature: body.signature,
        ...(body.structuredPayload
          ? {
              structuredPayload:
                body.structuredPayload as Prisma.InputJsonObject,
            }
          : {}),
      },
    });
  }
  async list(slug: string, cursor?: string, limit = 20) {
    const agent = await this.db.agent.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    const items = await this.db.agentPost.findMany({
      where: { agentId: agent.id, visibility: { in: ['PUBLIC', 'UNLISTED'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(limit, 100) + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const more = items.length > Math.min(limit, 100);
    if (more) items.pop();
    return { items, nextCursor: more ? items.at(-1)!.id : null };
  }
}
