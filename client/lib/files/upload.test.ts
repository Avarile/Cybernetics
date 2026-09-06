import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ApiClient } from "@/lib/api/client"
import {
  INGESTABLE_MIMES,
  isIngestable,
  pollUntilAvailable,
  postToPresignedTarget,
  sha256Hex,
  uploadFile,
  type FileMetadata,
  type UploadProgress,
} from "./upload"

function stubClient() {
  const mocks = {
    request: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  }
  return { mocks, client: mocks as unknown as ApiClient }
}

function meta(over: Partial<FileMetadata> = {}): FileMetadata {
  return {
    id: "f1",
    ownerId: "u1",
    filename: "a.pdf",
    mimeType: "application/pdf",
    size: 10,
    checksumSha256: null,
    status: "AVAILABLE",
    metadata: {},
    createdAt: "t",
    updatedAt: "t",
    ...over,
  }
}

const noSleep = () => Promise.resolve()

/** jsdom has no real File constructor quirks; this is enough for the flow. */
function fakeFile(name = "a.pdf", type = "application/pdf", body = "hello") {
  return new File([body], name, { type })
}

describe("isIngestable", () => {
  it("accepts exactly the four types document-ingest extracts", () => {
    for (const m of INGESTABLE_MIMES) expect(isIngestable(m)).toBe(true)
    expect(INGESTABLE_MIMES).toHaveLength(4)
  })

  it("rejects anything else", () => {
    expect(isIngestable("image/png")).toBe(false)
    expect(isIngestable("application/zip")).toBe(false)
    expect(isIngestable("")).toBe(false)
  })

  it("includes docx under its full openxml type", () => {
    expect(
      isIngestable(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true)
  })
})

describe("sha256Hex", () => {
  it("produces the known digest of an empty blob", async () => {
    expect(await sha256Hex(new Blob([]))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    )
  })

  it("produces 64 lowercase hex characters", async () => {
    expect(await sha256Hex(new Blob(["hello"]))).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("postToPresignedTarget", () => {
  it("appends every policy field BEFORE the file part", async () => {
    // The ordering S3/MinIO POST policies require. Getting it wrong fails the
    // policy with an opaque 403.
    const appended: string[] = []
    class FakeXHR {
      upload = { onprogress: null as ((e: ProgressEvent) => void) | null }
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      status = 204
      open() {}
      send() {
        this.onload?.()
      }
      abort() {}
    }
    const origXHR = globalThis.XMLHttpRequest
    const origAppend = FormData.prototype.append
    FormData.prototype.append = function (name: string, ...rest: unknown[]) {
      appended.push(name)
      return origAppend.apply(this, [name, ...rest] as never)
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR)

    try {
      await postToPresignedTarget(
        { url: "https://minio.test/bucket", fields: { key: "k", policy: "p" }, expiresIn: 60 },
        fakeFile(),
        () => {},
      )
    } finally {
      FormData.prototype.append = origAppend
      globalThis.XMLHttpRequest = origXHR
    }

    expect(appended).toEqual(["key", "policy", "file"])
    expect(appended.indexOf("file")).toBe(appended.length - 1)
  })

  it("rejects on a non-2xx from storage", async () => {
    class FailXHR {
      upload = { onprogress: null }
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      status = 403
      open() {}
      send() {
        this.onload?.()
      }
      abort() {}
    }
    vi.stubGlobal("XMLHttpRequest", FailXHR)
    await expect(
      postToPresignedTarget(
        { url: "https://minio.test", expiresIn: 60 },
        fakeFile(),
        () => {},
      ),
    ).rejects.toThrow(/403/)
  })
})

describe("pollUntilAvailable", () => {
  it("returns as soon as the file is AVAILABLE", async () => {
    const { mocks, client } = stubClient()
    mocks.get.mockResolvedValueOnce(meta({ status: "AVAILABLE" }))
    expect(await pollUntilAvailable(client, "f1", 10_000, noSleep)).toMatchObject({
      status: "AVAILABLE",
    })
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it("keeps polling while PENDING", async () => {
    const { mocks, client } = stubClient()
    mocks.get
      .mockResolvedValueOnce(meta({ status: "PENDING" }))
      .mockResolvedValueOnce(meta({ status: "PENDING" }))
      .mockResolvedValueOnce(meta({ status: "AVAILABLE" }))
    await pollUntilAvailable(client, "f1", 10_000, noSleep)
    expect(mocks.get).toHaveBeenCalledTimes(3)
  })

  it("throws on QUARANTINED rather than polling forever", async () => {
    const { mocks, client } = stubClient()
    mocks.get.mockResolvedValueOnce(meta({ status: "QUARANTINED" }))
    await expect(pollUntilAvailable(client, "f1", 10_000, noSleep)).rejects.toThrow(
      /quarantined/i,
    )
  })

  it("gives up once the budget is spent", async () => {
    const { mocks, client } = stubClient()
    mocks.get.mockResolvedValue(meta({ status: "PENDING" }))
    expect(await pollUntilAvailable(client, "f1", 0, noSleep)).toBeNull()
  })

  it("stops when aborted", async () => {
    const { mocks, client } = stubClient()
    const c = new AbortController()
    c.abort()
    mocks.get.mockResolvedValue(meta({ status: "PENDING" }))
    expect(await pollUntilAvailable(client, "f1", 10_000, noSleep, c.signal)).toBeNull()
    expect(mocks.get).not.toHaveBeenCalled()
  })
})

describe("uploadFile", () => {
  beforeEach(() => {
    class OkXHR {
      upload = { onprogress: null as ((e: ProgressEvent) => void) | null }
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      status = 204
      open() {}
      send() {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent)
        this.onload?.()
      }
      abort() {}
    }
    vi.stubGlobal("XMLHttpRequest", OkXHR)
  })

  it("runs initiate → upload → complete → poll", async () => {
    const { mocks, client } = stubClient()
    mocks.post
      .mockResolvedValueOnce({
        fileId: "f1",
        deduplicated: false,
        upload: { url: "https://minio.test", fields: { key: "k" }, expiresIn: 60 },
      })
      .mockResolvedValueOnce(null) // complete
    mocks.get.mockResolvedValueOnce(meta({ status: "AVAILABLE" }))

    const phases: string[] = []
    const result = await uploadFile({
      client,
      file: fakeFile(),
      onProgress: (p: UploadProgress) => phases.push(p.phase),
      sleep: noSleep,
    })

    expect(result).toMatchObject({ status: "AVAILABLE" })
    expect(phases).toEqual([
      "hashing",
      "uploading",
      "uploading",
      "completing",
      "processing",
      "indexed",
    ])
    expect(mocks.post.mock.calls[0][0]).toBe("/files")
    expect(mocks.post.mock.calls[1][0]).toBe("/files/f1/complete")
  })

  it("sends the computed sha256 on initiate and on complete", async () => {
    const { mocks, client } = stubClient()
    mocks.post
      .mockResolvedValueOnce({
        fileId: "f1",
        deduplicated: false,
        upload: { url: "https://minio.test", expiresIn: 60 },
      })
      .mockResolvedValueOnce(null)
    mocks.get.mockResolvedValueOnce(meta())

    await uploadFile({ client, file: fakeFile(), onProgress: () => {}, sleep: noSleep })

    const initiateBody = mocks.post.mock.calls[0][1]
    const completeBody = mocks.post.mock.calls[1][1]
    expect(initiateBody.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(completeBody.sha256).toBe(initiateBody.sha256)
  })

  it("short-circuits on dedup — no upload, no complete", async () => {
    // The trap: a deduplicated response has NO `upload` key. Treating that as
    // an error would break every re-upload of existing content.
    const { mocks, client } = stubClient()
    mocks.post.mockResolvedValueOnce({ fileId: "f-existing", deduplicated: true })
    mocks.get.mockResolvedValueOnce(meta({ id: "f-existing", status: "AVAILABLE" }))

    const phases: string[] = []
    const result = await uploadFile({
      client,
      file: fakeFile(),
      onProgress: (p) => phases.push(p.phase),
      sleep: noSleep,
    })

    expect(result).toMatchObject({ id: "f-existing" })
    expect(mocks.post).toHaveBeenCalledTimes(1) // initiate only
    expect(phases).toEqual(["hashing", "processing", "indexed"])
  })

  it("treats a missing upload target as dedup even without the flag", async () => {
    const { mocks, client } = stubClient()
    mocks.post.mockResolvedValueOnce({ fileId: "f2", deduplicated: false })
    mocks.get.mockResolvedValueOnce(meta({ id: "f2" }))
    await uploadFile({ client, file: fakeFile(), onProgress: () => {}, sleep: noSleep })
    expect(mocks.post).toHaveBeenCalledTimes(1)
  })

  it("reports failure without throwing when initiate is rejected", async () => {
    const { mocks, client } = stubClient()
    mocks.post.mockRejectedValueOnce(new Error("File type not allowed"))

    let last: UploadProgress | null = null
    const result = await uploadFile({
      client,
      file: fakeFile(),
      onProgress: (p) => (last = p),
      sleep: noSleep,
    })

    expect(result).toBeNull()
    expect(last).toMatchObject({ phase: "failed", error: "File type not allowed" })
  })

  it("reports a processing timeout as failed rather than hanging", async () => {
    const { mocks, client } = stubClient()
    mocks.post
      .mockResolvedValueOnce({
        fileId: "f1",
        deduplicated: false,
        upload: { url: "https://minio.test", expiresIn: 60 },
      })
      .mockResolvedValueOnce(null)
    mocks.get.mockResolvedValue(meta({ status: "PENDING" }))

    let last: UploadProgress | null = null
    const result = await uploadFile({
      client,
      file: fakeFile(),
      onProgress: (p) => (last = p),
      sleep: noSleep,
      pollTimeoutMs: 0,
    })

    expect(result).toBeNull()
    expect(last).toMatchObject({ phase: "failed" })
  })
})
