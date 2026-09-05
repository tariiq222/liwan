import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";
import {
  HrEmployeeSchema,
  HrEmployeeListSchema,
  MeSchema,
} from "@nasq/contracts";

const ADMIN_LOGIN = process.env.E2E_ADMIN_LOGIN ?? "admin";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function login(
  page: Page,
  loginName = ADMIN_LOGIN,
  password = ADMIN_PASSWORD,
) {
  await page.goto("/login");
  await page.getByLabel("اسم المستخدم").fill(loginName);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/tasks$/);
}
async function employeeContext(
  browser: Browser,
  loginName: string,
  password: string,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    locale: "ar-SA",
  });
  const response = await context.request.post("/api/auth/login", {
    data: { login: loginName, password },
  });
  expect(response.status()).toBe(200);
  return context;
}
async function expectResponse(
  responsePromise: Promise<Response>,
  status: number,
) {
  const response = await responsePromise;
  expect(response.status()).toBe(status);
  await response.finished();
  return response;
}

test("admin manages employee access and lifecycle through routed pages", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await login(page);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const name = `E2E access ${suffix}`;
  const email = `e2e-access-${suffix}@example.test`;
  const firstPassword = `E2E-access-first-${suffix}`;
  const nextPassword = `E2E-access-next-${suffix}`;
  const departmentName = `E2E access docs ${suffix}`;
  const documentName = `E2E access document ${suffix}`;
  const departmentRes = await page.request.post('/api/v1/hr/departments', {
    data: { name: departmentName },
  });
  expect(departmentRes.status()).toBe(201);
  const department = await departmentRes.json();
  const documentRes = await page.request.post('/api/v1/hr/documents', {
    data: {
      name: documentName,
      body: 'Access lifecycle document',
      department_id: department.id,
    },
  });
  expect(documentRes.status()).toBe(201);
  await page.goto("/hr");
  await page.getByRole("button", { name: "موظف جديد" }).click();
  await expect(page).toHaveURL(/\/hr\/employees\/new/);
  await page.getByLabel("الاسم").fill(name);
  await page.getByLabel("البريد الوظيفي").fill(email);
  const createEmployeeResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/hr/employees") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "حفظ" }).click();
  await expectResponse(createEmployeeResponse, 201);
  await expect(page).toHaveURL(/\/hr\/employees\/\d+/);
  await expect(
    page.locator('[role="dialog"], [data-slot="sheet"]'),
  ).toHaveCount(0);
  const employee = HrEmployeeSchema.parse(
    await (
      await page.request.get(
        `/api/v1/hr/employees?q=${encodeURIComponent(name)}`,
      )
    )
      .json()
      .then((value) => value.items.find((item) => item.name === name)),
  );
  expect(employee).toBeDefined();
  await page.goto(`/hr/employees/${employee.id}/access`);
  await expect(page.getByRole("heading", { name: "الوصول" })).toBeVisible();
  await page.getByLabel("كلمة المرور").fill(firstPassword);
  const grantResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/access") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "منح الوصول" }).click();
  const granted = HrEmployeeSchema.parse(
    await (await expectResponse(grantResponse, 200)).json(),
  );
  expect(granted.access?.active).toBe(true);
  const linkedUserId = granted.access!.user_id;

  const employeeSession = await employeeContext(browser, email, firstPassword);
  try {
    const firstMe = MeSchema.parse(
      await (await employeeSession.request.get("/api/v1/me")).json(),
    );
    expect(firstMe.id).toBe(linkedUserId);
    const employeePage = await employeeSession.newPage();
    await employeePage.goto("/hr");
    await expect(
      employeePage.getByRole("heading", { name: "الأشخاص" }),
    ).toBeVisible();
    await expect(
      employeePage.getByRole("button", { name: "موظف جديد" }),
    ).toHaveCount(0);
    await expect(employeePage.getByTestId("hr-employee-manage")).toHaveCount(0);
    await expect(
      employeePage.getByRole("button", { name: "عرض المؤرشفين" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "رجوع" }).click();
    await page.getByRole("row", { name: new RegExp(name) }).click();
    await page.getByRole("link", { name: "الوصول" }).click();
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "مدير نظام", exact: true }).click();
    const promoteResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/access") &&
        response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "حفظ الدور" }).click();
    await expectResponse(promoteResponse, 200);
    expect(
      (await employeeSession.request.get("/api/v1/admin/branding")).status(),
    ).toBe(200);
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "موظف", exact: true }).click();
    const demoteResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/access") &&
        response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "حفظ الدور" }).click();
    await expectResponse(demoteResponse, 200);
    expect(
      (await employeeSession.request.get("/api/v1/admin/branding")).status(),
    ).toBe(403);
    const resetResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/access") &&
        response.request().method() === "PATCH",
    );
    await page.getByLabel("كلمة المرور").fill(nextPassword);
    await page.getByRole("button", { name: "تغيير كلمة المرور" }).click();
    await expectResponse(resetResponse, 200);
    expect((await employeeSession.request.get("/api/v1/me")).status()).toBe(
      403,
    );
    await employeePage.goto("/hr");
    await expect(employeePage).toHaveURL(/\/login(?:\?|$)/);
    await employeePage.close();
  } finally {
    await employeeSession.close();
  }

  const resetSession = await employeeContext(browser, email, nextPassword);
  try {
    const resetMe = MeSchema.parse(
      await (await resetSession.request.get("/api/v1/me")).json(),
    );
    expect(resetMe.id).toBe(linkedUserId);
    await page.goto(`/hr/employees/${employee.id}/access`);
    await page.getByRole("button", { name: "إلغاء الوصول" }).click();
    await expect(page.getByTestId("hr-revoke-confirmation")).toBeVisible();
    const revokeResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/access") &&
        response.request().method() === "DELETE",
    );
    await page
      .getByTestId("hr-revoke-confirmation")
      .getByRole("button", { name: "إلغاء الوصول" })
      .click();
    const revoked = HrEmployeeSchema.parse(
      await (await expectResponse(revokeResponse, 200)).json(),
    );
    expect(revoked.access).toMatchObject({
      user_id: linkedUserId,
      active: false,
    });
    expect((await resetSession.request.get("/api/v1/me")).status()).toBe(403);
  } finally {
    await resetSession.close();
  }

  await page.goto(`/hr/employees/${employee.id}/edit`);
  await page.getByRole("button", { name: "أرشفة الموظف" }).click();
  await expect(page.getByTestId("hr-archive-confirmation")).toBeVisible();
  const archiveResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/archive") &&
      response.request().method() === "POST",
  );
  await page
    .getByTestId("hr-archive-confirmation")
    .getByRole("button", { name: "أرشفة الموظف" })
    .click();
  await expectResponse(archiveResponse, 200);
  await page.getByRole("button", { name: "رجوع" }).click();
  await page.getByRole("button", { name: "عرض المؤرشفين" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
  await page
    .getByRole("row", { name: new RegExp(name) })
    .getByTestId("hr-employee-archive-row")
    .click();
  await expect(page).toHaveURL(/\/edit\?/);
  await page
    .getByTestId("hr-archive-confirmation")
    .getByRole("button", { name: "استعادة الموظف" })
    .click();
  await expect
    .poll(async () => {
      const result = await page.request.get(
        `/api/v1/hr/employees?q=${encodeURIComponent(name)}`,
      );
      return HrEmployeeListSchema.parse(await result.json()).items.some(
        (item) => item.name === name,
      );
    })
    .toBe(true);
  await expect(page.getByRole("button", { name: "رجوع" })).toBeVisible();
  const employeeRes = await page.request.get(
    `/api/v1/hr/employees?q=${encodeURIComponent(name)}`,
  );
  expect(
    HrEmployeeListSchema.parse(await employeeRes.json()).items.find(
      (item) => item.name === name,
    ),
  ).toBeDefined();
  await page.goto(`/hr/departments/${department.id}`);
  await expect(page.getByRole('heading', { name: 'مستندات القسم' })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(documentName) })).toBeVisible();
  await page.getByRole('row', { name: new RegExp(documentName) }).click();
  await expect(page.getByRole('heading', { name: documentName, level: 1 })).toBeVisible();
  await expect(page.getByText('Access lifecycle document')).toBeVisible();
});
