import { z } from "zod";
import "./common.js";

export const HealthResponse = z
  .object({
    status: z.literal("ok"),
    service: z.string().openapi({ example: "receipt-assistant" }),
    version: z.string().openapi({ example: "1.0.0" }),
  })
  .openapi("HealthResponse");
