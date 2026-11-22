import type { Config } from '@netlify/functions';
import { createNetlifyStorageAdapter } from '../../server/netlifyStorage.ts';
import { createWhatsAppService } from '../../server/whatsappCore.ts';

const service = createWhatsAppService(createNetlifyStorageAdapter());

export default async (_req: Request): Promise<Response> => {
  await service.runSchedulerTick();
  return new Response('OK', { status: 200 });
};

export const config: Config = {
  schedule: '*/5 * * * *',
};
