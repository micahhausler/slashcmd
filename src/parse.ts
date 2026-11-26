export const commands = ["squash"] as const;
export type Command = (typeof commands)[number];

export function parseCommand(body: string): Command | undefined {
  const first = body.split(/\r\n|\r|\n/, 1)[0].trimEnd();
  if (!first.startsWith("/")) return undefined;
  const name = first.slice(1);
  return (commands as readonly string[]).includes(name) ? (name as Command) : undefined;
}
