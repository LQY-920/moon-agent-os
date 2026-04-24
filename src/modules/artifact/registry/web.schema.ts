import { z } from 'zod';

export const WebArtifactPayload = z.object({
  entryHtml: z.string().min(1),
  assets: z.record(z.string(), z.string()).optional(),
  metadata: z.object({
    generatedBy: z.string().min(1),
    generatedAt: z.string().datetime({ message: 'Invalid ISO 8601 datetime' }),
  }),
});

export type WebArtifactPayload = z.infer<typeof WebArtifactPayload>;
