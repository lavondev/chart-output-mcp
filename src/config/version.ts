import { createRequire } from "node:module";

// Read from package.json so the version clients see can never drift from the published one.
export const PACKAGE_VERSION = (createRequire(import.meta.url)("../../package.json") as { version: string }).version;
