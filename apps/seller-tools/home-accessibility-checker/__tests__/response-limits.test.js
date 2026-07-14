const {
  readResponseBuffer,
  readResponseText,
} = require("../services/response-limits");

describe("remote response limits", () => {
  test("stops a streamed response as soon as it exceeds the byte limit", async () => {
    const reader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({ done: false, value: Uint8Array.from([1, 2]) })
        .mockResolvedValueOnce({ done: false, value: Uint8Array.from([3, 4]) }),
      cancel: jest.fn().mockResolvedValue(undefined),
      releaseLock: jest.fn(),
    };

    await expect(
      readResponseBuffer(
        {
          headers: { get: () => null },
          body: { getReader: () => reader },
        },
        3,
      ),
    ).rejects.toThrow("Remote response exceeds size limit (4 bytes)");
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  test("bounds text responses when a stream is unavailable", async () => {
    const response = {
      headers: { get: () => null },
      text: jest.fn().mockResolvedValue("abcd"),
    };

    await expect(readResponseText(response, 3)).rejects.toThrow(
      "Remote response exceeds size limit",
    );
  });
});
