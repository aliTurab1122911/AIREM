import { expect, test } from "@playwright/test";

async function register(page: import("@playwright/test").Page) {
  const seed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.goto("/register", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Full name").fill("Orchestration E2E");
  await page.getByLabel("Email address").fill(`orchestration-${seed}@example.test`);
  await page.getByLabel("Password").fill("E2e-password-2026!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function apiFetch<T>(page: import("@playwright/test").Page, path: string, init?: { method?: string; headers?: Record<string,string>; body?: unknown }) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, {
      method: init?.method ?? "GET",
      headers: { ...(init?.body === undefined ? {} : { "content-type": "application/json" }), ...(init?.headers ?? {}) },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "include",
    });
    let body: any;
    try { body = await response.json(); } catch { body = null; }
    return { status: response.status, body };
  }, { path, init });
}

test("BullMQ produces the same deterministic result as synchronous processing and idempotent replay returns one job", async ({ page }) => {
  await register(page);
  const payload = {
    text: "The research team carefully reviewed the available evidence and prepared a concise explanation of the observed result for the final report.",
    profile: "natural",
    engine: "linguistic",
    style_profile: "natural_student",
    preserve_line_breaks: true,
  };

  const direct = await apiFetch<any>(page, "/api/text/rewrite", { method: "POST", body: payload });
  expect(direct.status).toBe(200);
  expect(direct.body.ok).toBe(true);

  const key = `orchestration-${Date.now()}`;
  const queued = await apiFetch<any>(page, "/api/jobs", {
    method: "POST",
    headers: { "idempotency-key": key },
    body: { operation: "text_rewrite", payload },
  });
  expect(queued.status).toBe(202);
  const jobId = queued.body.job.id as string;
  expect(jobId).toBeTruthy();

  let completed: any;
  for (let attempt = 0; attempt < 80; attempt++) {
    const current = await apiFetch<any>(page, `/api/jobs/${jobId}`);
    expect(current.status).toBe(200);
    if (["completed", "review_required", "failed"].includes(current.body.job.state)) {
      completed = current.body.job;
      break;
    }
    await page.waitForTimeout(250);
  }
  expect(completed?.state).toBe("completed");
  expect(completed.progress).toBe(100);
  expect(completed.result.rewritten_text).toBe(direct.body.rewritten_text);
  expect(completed.result.original_words).toBe(direct.body.original_words);
  expect(completed.result.rewritten_words).toBe(direct.body.rewritten_words);
  expect(completed.result.score_after).toBe(direct.body.score_after);

  const replay = await apiFetch<any>(page, "/api/jobs", {
    method: "POST",
    headers: { "idempotency-key": key },
    body: { operation: "text_rewrite", payload },
  });
  expect(replay.status).toBe(200);
  expect(replay.body.idempotentReplay).toBe(true);
  expect(replay.body.job.id).toBe(jobId);

  const conflict = await apiFetch<any>(page, "/api/jobs", {
    method: "POST",
    headers: { "idempotency-key": key },
    body: { operation: "text_rewrite", payload: { ...payload, text: payload.text + " Different request." } },
  });
  expect(conflict.status).toBe(409);
  expect(conflict.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
});
