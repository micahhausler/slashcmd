import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/parse";

describe("parseCommand", () => {
  it.each([
    ["/squash", "squash"],
    ["/squash  ", "squash"],
    ["/squash\r\nplease", "squash"],
    ["/squash\nmore text", "squash"],
    ["/squash\t\r", "squash"],
  ])("matches %j", (body, want) => {
    expect(parseCommand(body)).toBe(want);
  });

  it.each([
    "",
    "/",
    "  /squash",
    "\t/squash",
    "\n/squash",
    "/squash now",
    "/Squash",
    "-n /squash",
    "please /squash",
    '"/squash"',
    "'/squash'",
    "`/squash`",
    "/unknown",
    "lgtm\n/squash",
  ])("ignores %j", (body) => {
    expect(parseCommand(body)).toBeUndefined();
  });
});
