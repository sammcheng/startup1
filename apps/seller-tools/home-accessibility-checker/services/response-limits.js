"use strict";

function assertContentLength(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(
      `Remote response exceeds size limit (${contentLength} bytes)`,
    );
  }
}

async function readResponseBuffer(response, maxBytes) {
  assertContentLength(response, maxBytes);

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    let streamComplete = false;
    try {
      while (!streamComplete) {
        const { done, value } = await reader.read();
        if (done) {
          streamComplete = true;
          continue;
        }
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error(`Remote response exceeds size limit (${size} bytes)`);
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, size);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error(
      `Remote response exceeds size limit (${buffer.length} bytes)`,
    );
  }
  return buffer;
}

async function readResponseText(response, maxBytes) {
  if (response.body?.getReader || typeof response.arrayBuffer === "function") {
    return (await readResponseBuffer(response, maxBytes)).toString("utf8");
  }

  assertContentLength(response, maxBytes);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new Error("Remote response exceeds size limit");
  }
  return text;
}

module.exports = {
  readResponseBuffer,
  readResponseText,
};
