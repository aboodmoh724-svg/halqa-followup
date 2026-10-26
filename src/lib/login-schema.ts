import { z } from "zod";

// Keep existing six-digit accounts valid while schools provision four-digit codes.
export const loginSchema = z.object({
  code: z.string().regex(/^(?:\d{4}|\d{6})$/),
  remember: z.boolean(),
});
