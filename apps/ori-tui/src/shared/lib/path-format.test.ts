import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { type FormattedFilePath, formatFilePath } from "./path-format"

const originalHome = process.env.HOME

beforeAll(() => {
  process.env.HOME = "/Users/test"
})

afterAll(() => {
  process.env.HOME = originalHome
})

function runTest(input: string, expected: FormattedFilePath, maxLength?: number) {
  const result = formatFilePath(input, maxLength)
  expect(result.dirPath).toEqual(expected.dirPath)
  expect(result.fileName).toEqual(expected.fileName)
}

describe("formatFilePath", () => {
  describe("basic paths", () => {
    test("file in home dir", () => runTest("/Users/test/file.txt", { dirPath: "~/", fileName: "file.txt" }))

    test("nested under home dir", () =>
      runTest("/Users/test/Documents/file.txt", { dirPath: "~/Documents/", fileName: "file.txt" }))

    test("truncated under home dir", () =>
      runTest(
        "/Users/test/Library/Application Support/ori/connections/mydb/.console.sql",
        {
          dirPath: "~/Library/…/mydb/",
          fileName: ".console.sql",
        },
        40,
      ))

    test("non-home path", () => runTest("/var/log/app/error.log", { dirPath: "/var/log/app/", fileName: "error.log" }))

    test("truncated non-home path", () =>
      runTest(
        "/var/test/Library/Application Support/ori/connections/mydb/.console.sql",
        {
          dirPath: "/var/test/Library/…/mydb/",
          fileName: ".console.sql",
        },
        50,
      ))

    test("filename only", () => runTest("file.txt", { dirPath: "", fileName: "file.txt" }))

    test("truncated filename", () =>
      runTest("/Users/test/a/b/c/d/e/f/g/filllllllllllllle.txt", { dirPath: "…/", fileName: "filllllll…llle.txt" }, 20))
  })

  test("deep path", () =>
    runTest("/Users/test/a/b/c/d/e/f/g/file.txt", { dirPath: "~/a/b/c/…/g/", fileName: "file.txt" }, 20))

  test("empty string", () => runTest("", { dirPath: "", fileName: "" }))
})
