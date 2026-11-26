import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dist", () => {
  const bundle = readFileSync(new URL("../dist/index.cjs", import.meta.url), "utf8");

  it.each(["tunnel", "json-with-bigint"])("bundles the %s stub, not the package", (name) => {
    expect(bundle).not.toContain(`node_modules/${name}/`);
    expect(bundle).toContain(`stubs/${name}/index.js`);
  });
});
