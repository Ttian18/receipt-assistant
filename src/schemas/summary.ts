import { z } from "zod";
import { DateString } from "./common.js";

export const SummaryQuery = z.object({
  from: DateString.optional().openapi({ param: { name: "from", in: "query" } }),
  to: DateString.optional().openapi({ param: { name: "to", in: "query" } }),
});

export const SpendingSummaryItem = z
  .object({
    category: z.string().nullable(),
    count: z.number().int(),
    total_spent: z.number(),
    avg_per_receipt: z.number(),
  })
  .openapi("SpendingSummaryItem");

export const SpendingSummary = z.array(SpendingSummaryItem).openapi("SpendingSummary");
