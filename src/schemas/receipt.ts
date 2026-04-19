import { z } from "zod";
import { DateString } from "./common.js";

export const ExtractionMeta = z
  .object({
    quality: z.object({
      confidence_score: z.number(),
      missing_fields: z.array(z.string()),
      warnings: z.array(z.string()),
    }),
    business: z.object({
      is_reimbursable: z.boolean(),
      is_tax_deductible: z.boolean(),
      is_recurring: z.boolean(),
      is_split_bill: z.boolean(),
    }),
  })
  .openapi("ExtractionMeta");

export const ReceiptItem = z
  .object({
    name: z.string(),
    quantity: z.number().nullable().optional(),
    unit_price: z.number().nullable().optional(),
    total_price: z.number().nullable().optional(),
    category: z.string().nullable().optional(),
  })
  .openapi("ReceiptItem");

export const Receipt = z
  .object({
    id: z.string(),
    merchant: z.string(),
    date: DateString,
    total: z.number(),
    currency: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    payment_method: z.string().nullable().optional(),
    tax: z.number().nullable().optional(),
    tip: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
    raw_text: z.string().nullable().optional(),
    image_path: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    place_id: z.string().nullable().optional(),
    status: z.enum(["processing", "done", "error"]).optional(),
    extraction_meta: ExtractionMeta.nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .openapi("Receipt");

export const ReceiptWithItems = Receipt.extend({
  items: z.array(ReceiptItem),
}).openapi("ReceiptWithItems");

export const ListReceiptsQuery = z.object({
  from: DateString.optional().openapi({ param: { name: "from", in: "query" } }),
  to: DateString.optional().openapi({ param: { name: "to", in: "query" } }),
  category: z
    .string()
    .optional()
    .openapi({ param: { name: "category", in: "query" } }),
  limit: z
    .coerce.number()
    .int()
    .positive()
    .optional()
    .openapi({ param: { name: "limit", in: "query" }, example: 50 }),
});

export const UploadReceiptForm = z
  .object({
    image: z.string().openapi({ type: "string", format: "binary" }),
    notes: z.string().optional(),
  })
  .openapi("UploadReceiptForm");

export const DeleteReceiptResponse = z
  .object({
    success: z.literal(true),
    id: z.string(),
  })
  .openapi("DeleteReceiptResponse");
