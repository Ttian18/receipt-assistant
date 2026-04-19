import { pgEnum } from "drizzle-orm/pg-core";

export const accountTypeEnum = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
]);

export const txnStatusEnum = pgEnum("txn_status", [
  "draft",
  "posted",
  "voided",
  "reconciled",
  "error",
]);

export const documentKindEnum = pgEnum("document_kind", [
  "receipt_image",
  "receipt_email",
  "receipt_pdf",
  "statement_pdf",
  "other",
]);

export const workspaceRoleEnum = pgEnum("workspace_role", [
  "owner",
  "admin",
  "member",
  "viewer",
]);
