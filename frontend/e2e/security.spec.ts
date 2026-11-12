import { test, expect } from "@playwright/test"

test("local access key unlocks the travel app without being persisted", async ({
  page,
}) => {
  let authenticated = false
  let submittedKey = ""
  await page.route("**/api/auth/status", async (route) => {
    const cookie = route.request().headers().cookie || ""
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated:
          authenticated && cookie.includes("local_session=fixture"),
      }),
    })
  })
  await page.route("**/api/auth/login", async (route) => {
    submittedKey = route.request().postDataJSON().access_key
    authenticated = submittedKey === "local-test-key"
    await route.fulfill({
      status: authenticated ? 200 : 401,
      contentType: "application/json",
      headers: authenticated
        ? {
            "Set-Cookie":
              "local_session=fixture; HttpOnly; SameSite=Lax; Path=/",
          }
        : undefined,
      body: JSON.stringify({ success: authenticated }),
    })
  })
  await page.route("**/api/auth/logout", async (route) => {
    authenticated = false
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Set-Cookie":
          "local_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      },
      body: JSON.stringify({ success: true }),
    })
  })

  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "Unlock Travel AGNTCY" }),
  ).toBeVisible()
  await expect(page.getByText(/provider API keys/i)).toBeVisible()

  const keyField = page.getByLabel("Local access key")
  await keyField.fill("local-test-key")
  await page.getByRole("button", { name: "Unlock app" }).click()
  await expect(
    page.getByRole("heading", { name: "How can I help you plan your trip?" }),
  ).toBeVisible()
  expect(submittedKey).toBe("local-test-key")
  const browserStorage = await page.evaluate(() =>
    JSON.stringify({ local: localStorage, session: sessionStorage }),
  )
  expect(browserStorage).not.toContain("local-test-key")

  await page.reload()
  await expect(
    page.getByRole("heading", { name: "How can I help you plan your trip?" }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page.getByLabel("Local access key")).toBeVisible()
})

test("login errors explain wrong keys, throttling, and paused access", async ({
  page,
}) => {
  let status = 401
  await page.route("**/api/auth/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: false }),
    })
  })
  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({ status, contentType: "application/json", body: "{}" })
  })

  await page.goto("/")
  const keyField = page.getByLabel("Local access key")
  await keyField.fill("incorrect")
  await page.getByRole("button", { name: "Unlock app" }).click()
  await expect(page.getByRole("alert")).toContainText("did not unlock")

  status = 429
  await page.getByRole("button", { name: "Unlock app" }).click()
  await expect(page.getByRole("alert")).toContainText("Too many attempts")

  status = 503
  await page.getByRole("button", { name: "Unlock app" }).click()
  await expect(page.getByRole("alert")).toContainText("temporarily paused")
})

test("auth status network errors fail closed and can be retried", async ({
  page,
}) => {
  let online = false
  await page.route("**/api/auth/status", async (route) => {
    if (!online) {
      await route.abort()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: false }),
    })
  })

  await page.goto("/")
  await expect(page.getByRole("alert")).toContainText("Could not check access")
  await expect(page.getByLabel("Local access key")).not.toBeVisible()
  online = true
  await page.getByRole("button", { name: "Try again" }).click()
  await expect(page.getByLabel("Local access key")).toBeVisible()
})
