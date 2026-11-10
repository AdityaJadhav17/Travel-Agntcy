import { test, expect } from "@playwright/test"

for (const [name, wire, expected] of [
  [
    "malformed event",
    '{"type":"status","component":"flights","message":{}}\n',
    "invalid event",
  ],
  [
    "premature EOF",
    '{"type":"text","text":"Only a draft"}\n',
    "ended before sending a complete result",
  ],
  [
    "request failure",
    '{"type":"error","component":"request","message":"Search unavailable. Please retry."}\n{"type":"done","result":{"response":"Wrong answer"}}\n',
    "Search unavailable. Please retry.",
  ],
]) {
  test(`${name} gives a readable failure and releases the composer`, async ({
    page,
  }) => {
    await page.route("**/agent/prompt/stream", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: wire,
      }),
    )
    await page.goto("/")
    await page.getByRole("textbox").fill("Find flights")
    await page.getByRole("textbox").press("Enter")
    await expect(page.getByText(expected, { exact: false })).toBeVisible()
    await expect(page.getByRole("textbox")).toBeEnabled()
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toHaveCount(0)
    await expect(page.getByText("Only a draft", { exact: true })).toHaveCount(0)
    await expect(page.getByText("Wrong answer", { exact: true })).toHaveCount(0)
  })
}

test("duplicate done and late events cannot replace the saved answer", async ({
  page,
}) => {
  await page.route("**/agent/prompt/stream", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body:
        [
          { type: "done", result: { response: "The first complete answer" } },
          { type: "done", result: { response: "Wrong duplicate answer" } },
          { type: "error", component: "request", message: "Late failure" },
          { type: "text", text: "Late text" },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n") + "\n{invalid\n",
    }),
  )
  await page.goto("/")
  await page.getByRole("textbox").fill("Find flights")
  await page.getByRole("textbox").press("Enter")
  await expect(page.getByText("The first complete answer")).toBeVisible()
  await expect(
    page.getByText(/Wrong duplicate answer|Late failure|Late text/),
  ).toHaveCount(0)
  await page.reload()
  await page.getByRole("button", { name: "Find flights", exact: true }).click()
  await expect(page.getByText("The first complete answer")).toBeVisible()
})
