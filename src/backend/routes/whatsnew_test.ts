import { assertEquals } from "jsr:@std/assert@^1";
import { validatePostInput } from "./whatsnew.ts";

const page = (en: string, extra: Record<string, unknown> = {}) => ({
  body: { en },
  layoutPreset: "textOnly",
  ...extra,
});
const post = (pages: unknown[], extra: Record<string, unknown> = {}) => ({
  title: { en: "FASTR 2.0" },
  version: "2.0.0",
  pages,
  ...extra,
});

Deno.test("page audience", async (t) => {
  await t.step("an admins-only page is kept", () => {
    const r = validatePostInput(post([page("a"), page("scopes", { adminsOnly: true })]));
    if ("error" in r) throw new Error(r.error);
    assertEquals(r.post.pages.map((p) => p.adminsOnly), [undefined, true]);
  });

  await t.step("false is not stored, so the flag only ever means admins-only", () => {
    const r = validatePostInput(post([page("a", { adminsOnly: false })]));
    if ("error" in r) throw new Error(r.error);
    assertEquals("adminsOnly" in r.post.pages[0], false);
  });

  await t.step("a non-boolean flag is rejected", () => {
    const r = validatePostInput(post([page("a"), page("b", { adminsOnly: "yes" })]));
    assertEquals("error" in r, true);
  });

  await t.step("every page admins-only on an open post is rejected", () => {
    const r = validatePostInput(post([page("a", { adminsOnly: true })]));
    assertEquals("error" in r, true);
  });

  await t.step("every page admins-only is fine when the post is admins-only", () => {
    const r = validatePostInput(post([page("a", { adminsOnly: true })], { adminsOnly: true }));
    assertEquals("error" in r, false);
  });
});
