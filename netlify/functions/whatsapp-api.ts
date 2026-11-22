import type { Context } from '@netlify/functions';
import { createNetlifyStorageAdapter } from '../../server/netlifyStorage.ts';
import { createWhatsAppService } from '../../server/whatsappCore.ts';

const service = createWhatsAppService(createNetlifyStorageAdapter());

const parseRequestBody = async (req: Request): Promise<unknown> => {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return undefined;
  }
  const contentType = req.headers.get('content-type') || '';
  const rawText = await req.text();
  if (!rawText) return {};
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(rawText).entries());
  }
  try {
    return JSON.parse(rawText);
  } catch {
    return {};
  }
};

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method.toUpperCase() === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  const url = new URL(req.url);
  const query: Record<string, string | undefined> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const body = await parseRequestBody(req);
  const publicBaseUrl = `${url.protocol}//${url.host}`;

  const result = await service.handleRequest({
    method: req.method,
    pathname: url.pathname,
    query,
    body,
    publicBaseUrl,
  });

  if (result.buffer) {
    return new Response(new Uint8Array(result.buffer), {
      status: result.status,
      headers: result.headers,
    });
  }

  if (result.text !== undefined) {
    return new Response(result.text, {
      status: result.status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ...(result.headers || {}),
      },
    });
  }

  return Response.json(result.json ?? {}, {
    status: result.status,
    headers: result.headers,
  });
};
