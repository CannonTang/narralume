import { expect, test, type Locator } from "@playwright/test";

async function selectEditorRange(editor: Locator, start: number, end: number) {
  await editor.evaluate(
    (element, range) => {
      const textarea = element as HTMLTextAreaElement;
      textarea.focus();
      textarea.setSelectionRange(range.start, range.end);
      textarea.ownerDocument.dispatchEvent(new Event("selectionchange"));
    },
    { start, end },
  );
}

test("主链只经由 UI：设置 → 建书 → 大纲 → 写作 → AI 接续 → 交付", async ({
  page,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const providerName = `E2E 模型服务 ${suffix}`;
  const modelName = `e2e-writer-${suffix}`;
  const title = `潮汐回归-${suffix}`;
  const chapterTitle = `雾港失灯-${suffix}`;
  const body =
    "林昇回港当夜，灯塔突然熄灭。退潮前，他在石阶下找到一封没有署名的信。";
  const comment = "这里要保留失灯发生的突然感。";
  const backupLabel = `交付验收-${suffix}`;

  await page.goto("/settings");
  await expect(
    page.getByRole("main").getByText("设置", { exact: true }),
  ).toBeVisible();

  // 供给管理收纳在 <details> 里，先展开再进“模型渠道”列。
  await page
    .getByRole("group", { name: "渠道与模型管理" })
    .locator("summary")
    .click();
  const providerSection = page.getByRole("region", { name: "模型渠道" });
  await providerSection.getByRole("button", { name: "新建" }).click();
  const providerForm = providerSection.locator("form.supply__editor");
  await providerForm.getByLabel("渠道名称").fill(providerName);
  await providerForm.getByLabel("Base URL").fill("https://e2e.example.com/v1");
  await providerForm.getByLabel("密钥或 env:NAME").fill("e2e-placeholder-key");
  await providerForm.getByRole("button", { name: "保存" }).click();
  await expect(
    providerSection.getByText(providerName, { exact: true }),
  ).toBeVisible();

  const modelSection = page.getByRole("region", { name: "模型", exact: true });
  await modelSection.getByRole("button", { name: "新建" }).click();
  const modelForm = modelSection.locator("form.supply__editor");
  await modelForm.getByLabel("上游模型名").fill(modelName);
  await modelForm.getByLabel("上下文上限").fill("16000");
  await modelForm.getByLabel("输出上限").fill("2000");
  await modelForm.getByRole("button", { name: "保存" }).click();
  await expect(
    modelSection.getByText(modelName, { exact: true }),
  ).toBeVisible();

  const writingRole = page.locator(".supply__role", {
    hasText: "默认生成模型",
  });
  await writingRole
    .getByRole("button", { name: new RegExp(modelName) })
    .click();
  await expect(writingRole.getByText("已派", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "前往书架" }).click();
  await expect(
    page.getByRole("heading", { name: "藏书室", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: /空白建书/ }).click();
  await page.getByLabel("书名").fill(title);
  await page.getByLabel(/卷首语/).fill("失灯的守塔人必须在退潮前找回一封信。");
  await page.getByRole("button", { name: "创建并入藏" }).click();

  await expect(page).toHaveURL(/\/projects\/[^/]+\/overview$/);
  const projectUrl = new URL(page.url());
  const projectId = projectUrl.pathname.split("/")[2];
  expect(projectId).toBeTruthy();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  const storyLink = page.getByRole("link", { name: "前往故事" });
  await expect(storyLink).toHaveAttribute(
    "href",
    `/projects/${projectId}/bible`,
  );
  await storyLink.click();
  await page.getByRole("button", { name: "查看大纲" }).click();
  await page.getByLabel("类型").selectOption({ label: "章节" });
  await page.getByLabel("标题").fill(chapterTitle);
  await page.getByLabel("摘要").fill("林昇回港当夜，灯塔突然熄灭。");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("status")).toContainText("已写入服务端");
  await page.getByLabel("编辑对象").selectOption({ label: chapterTitle });
  await page.getByRole("link", { name: "去写作台写本章" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/projects/${projectId}/studio\\?outline=`),
  );
  await page.getByRole("button", { name: "创建" }).click();
  const editor = page.getByLabel("Markdown 正文编辑器");
  await expect(editor).toBeVisible();
  await editor.fill(body);
  await selectEditorRange(editor, 0, 8);
  await page.getByRole("tab", { name: "选区" }).click();
  await page.getByLabel("批注").fill(comment);
  const saveCommentButton = page.getByRole("button", {
    name: "保存版本并批注",
  });
  await expect(saveCommentButton).toBeEnabled();
  await saveCommentButton.click();
  await page.getByRole("tab", { name: "批注" }).click();
  await expect(page.getByText(comment, { exact: true })).toBeVisible();

  await selectEditorRange(editor, 9, 17);
  await page.getByRole("tab", { name: "选区" }).click();
  await page.getByLabel("AI 编辑指令").fill("让这句话更克制。 ");
  const createProposalButton = page.getByRole("button", {
    name: "生成编辑提案",
  });
  await expect(createProposalButton).toBeEnabled();
  await createProposalButton.click();
  await expect(page.getByRole("link", { name: "查看运行进度" })).toBeVisible();

  await page.getByRole("button", { name: "交给 AI" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${projectId}/studio\\?.*run=`),
  );
  await expect(page.getByRole("region", { name: "AI 写作任务" })).toBeVisible();
  await expect(page.getByText("AI 候选稿", { exact: true })).toBeVisible();

  if (testInfo.project.name === "mobile-375") {
    const railBox = await page.locator(".rail").boundingBox();
    expect(railBox?.height ?? 999).toBeLessThanOrEqual(80);
    const links = page.locator(".rail__nav .rail__item");
    await expect(links).toHaveCount(5);
    for (let index = 0; index < 5; index += 1) {
      const box = await links.nth(index).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator(".rail__nav .rail__item-label")).toHaveCount(5);
  }

  await page.getByRole("link", { name: "前往交付" }).click();
  await expect(
    page.getByRole("main").getByText("交付", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/质量检查只提供提醒/)).toBeVisible();
  await page.getByLabel("备份标签").fill(backupLabel);
  await page.getByRole("button", { name: "创建内容快照" }).click();
  await expect(page.getByText(backupLabel, { exact: true })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "以 Markdown 导出当前作品" }).click();
  await expect((await download).suggestedFilename()).toMatch(/\.md$/);

  const backupRow = page.locator(".delivery__backup-row", {
    hasText: backupLabel,
  });
  await backupRow.getByRole("button", { name: "恢复内容副本" }).click();
  await page
    .getByRole("alertdialog", { name: "恢复创作内容快照" })
    .getByRole("button", { name: "恢复内容副本" })
    .click();
  await expect(page.getByRole("status")).toContainText("已恢复为新项目");
  await expect(page.getByRole("link", { name: "打开恢复副本" })).toBeVisible();

  if (testInfo.project.name === "desktop-1440") {
    await page.getByRole("link", { name: "前往设置" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/settings\\?project=${projectId}`),
    );
    await expect(page.getByRole("link", { name: "返回项目" })).toBeVisible();
    await page.getByRole("link", { name: "返回项目" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/delivery`));
  }
});
