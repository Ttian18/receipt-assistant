import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export const ErrorResponse = z
  .object({
    error: z.string().openapi({ example: "Not found" }),
  })
  .openapi("ErrorResponse");

export const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .openapi({ example: "2026-04-19", description: "ISO date YYYY-MM-DD" });

export const IdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "abc123" }),
});
