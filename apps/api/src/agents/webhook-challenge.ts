import { BadGatewayException, Injectable } from '@nestjs/common';

export abstract class WebhookChallengePort {
  abstract send(webhookUrl: string, challenge: string): Promise<void>;
}

@Injectable()
export class FetchWebhookChallengeAdapter extends WebhookChallengePort {
  async send(webhookUrl: string, challenge: string) {
    let response: Response;
    try {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'agent.verification_challenge',
          challenge,
        }),
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
    } catch {
      throw new BadGatewayException(
        'Agent webhook did not accept the challenge',
      );
    }
    if (!response.ok) {
      throw new BadGatewayException(
        'Agent webhook did not accept the challenge',
      );
    }
  }
}
