import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

describe("production deployment configuration", () => {
  it("keeps the server private behind the same-origin web proxy", () => {
    const compose = readFileSync(resolve(root, "docker-compose.yml"), "utf8");
    expect(compose).toContain("NARRATIVE_SERVER_HOST: 0.0.0.0");
    expect(compose).toContain('NARRATIVE_ALLOW_REMOTE: "true"');
    expect(compose).toContain("NARRATIVE_AUTH_TOKEN:");
    expect(compose).not.toMatch(/4317\s*:/u);
    expect(compose).toContain(
      '"${NARRATIVE_WEB_BIND_HOST:-127.0.0.1}:4318:80"',
    );
    expect(compose).toContain("NARRATIVE_BACKUP_DIR: /app/backups");
  });

  it("injects the service token only at the nginx upstream boundary", () => {
    const nginx = readFileSync(resolve(root, "deploy/nginx.conf"), "utf8");
    expect(nginx).toContain(
      'proxy_set_header Authorization "Bearer ${NARRATIVE_AUTH_TOKEN}";',
    );
    expect(nginx).toContain("proxy_buffering off;");
    expect(nginx).toContain("proxy_read_timeout 1h;");
  });

  it("uses the official nginx template entrypoint", () => {
    const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("NGINX_ENVSUBST_FILTER");
    expect(dockerfile).toContain(
      "deploy/nginx.conf /etc/nginx/templates/default.conf.template",
    );
  });
});
