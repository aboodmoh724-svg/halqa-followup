import { z } from "zod";

// Keep existing six-digit accounts valid while schools provision four-digit codes; supervisors use eight digits.
export const loginSchema = z.object({
  code: z.string().regex(/^(?:\d{4}|\d{6}|\d{8})$/),
  remember: z.boolean(),
});
