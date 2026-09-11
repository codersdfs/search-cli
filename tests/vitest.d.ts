/**
 * Tests execute under `bun test`, whose runner exposes the vitest API
 * surface (describe/expect/test/vi/...) without `vitest` being installed.
 * This shim lets tsc resolve those imports to `bun:test` instead of
 * requiring a real `vitest` dependency for typechecking only.
 */
declare module "vitest" {
  export * from "bun:test";
}
