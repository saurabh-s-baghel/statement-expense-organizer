import { DEFAULT_CONFIG, parseConfig } from '@/lib/config';

export function GET(): Response {
  return Response.json(parseConfig(DEFAULT_CONFIG), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
