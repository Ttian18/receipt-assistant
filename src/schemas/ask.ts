import { z } from "zod";
import "./common.js";

export const AskRequest = z
  .object({
    question: z.string().openapi({ example: "How much did I spend on groceries last month?" }),
  })
  .openapi("AskRequest");

export const AskResponse = z
  .object({
    answer: z.string(),
  })
  .openapi("AskResponse");
