import { z } from 'zod';

const publicEnvironmentSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url().transform((url) => url.replace(/\/$/, '')),
});

export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>;

export function parsePublicEnvironment(
  environment: Record<string, string | undefined>,
): PublicEnvironment {
  return publicEnvironmentSchema.parse(environment);
}

export const publicEnvironment = parsePublicEnvironment({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});
