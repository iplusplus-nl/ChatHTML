import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_PROFILE_AVATAR_SOURCE_BYTES,
  PROFILE_AVATAR_TARGET_BYTES,
  compressProfileAvatar,
  fitProfileAvatarDimensions,
  profileAvatarDataBytes,
  type ProfileAvatarCompressionDependencies
} from "./profileAvatarImage";

function dataUrl(bytes: number): string {
  return `data:image/webp;base64,${Buffer.alloc(bytes).toString("base64")}`;
}

function imageBlob(size: number, type = "image/png"): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

describe("profile avatar image compression", () => {
  it("fits landscape and portrait images within the avatar bounds", () => {
    assert.deepEqual(fitProfileAvatarDimensions(4000, 2000), {
      width: 512,
      height: 256
    });
    assert.deepEqual(fitProfileAvatarDimensions(300, 600), {
      width: 256,
      height: 512
    });
  });

  it("measures base64 image payload bytes", () => {
    assert.equal(profileAvatarDataBytes(dataUrl(1234)), 1234);
    assert.equal(profileAvatarDataBytes("not-a-data-url"), Infinity);
  });

  it("accepts an original larger than 1 MB and retries until compressed", async () => {
    const calls: Array<{ width: number; height: number; quality: number }> = [];
    let disposed = false;
    const dependencies: ProfileAvatarCompressionDependencies = {
      async decode() {
        return {
          width: 2400,
          height: 1600,
          source: {},
          dispose: () => {
            disposed = true;
          }
        };
      },
      async encode(_image, width, height, quality) {
        calls.push({ width, height, quality });
        return calls.length === 1
          ? dataUrl(PROFILE_AVATAR_TARGET_BYTES + 10)
          : dataUrl(PROFILE_AVATAR_TARGET_BYTES - 10);
      }
    };

    const result = await compressProfileAvatar(imageBlob(2_000_000), dependencies);

    assert.ok(profileAvatarDataBytes(result) <= PROFILE_AVATAR_TARGET_BYTES);
    assert.deepEqual(calls[0], { width: 512, height: 341, quality: 0.9 });
    assert.equal(calls.length, 2);
    assert.equal(disposed, true);
  });

  it("rejects unsupported and unreasonably large source images", async () => {
    const dependencies: ProfileAvatarCompressionDependencies = {
      async decode() {
        throw new Error("decode should not run");
      },
      async encode() {
        throw new Error("encode should not run");
      }
    };

    await assert.rejects(
      compressProfileAvatar(imageBlob(10, "image/svg+xml"), dependencies),
      /PNG, JPEG, WebP, or GIF/
    );
    await assert.rejects(
      compressProfileAvatar(
        { size: MAX_PROFILE_AVATAR_SOURCE_BYTES + 1, type: "image/png" } as Blob,
        dependencies
      ),
      /smaller than 50 MB/
    );
  });

  it("does not return an oversized compressed result", async () => {
    let disposed = false;
    const dependencies: ProfileAvatarCompressionDependencies = {
      async decode() {
        return {
          width: 1024,
          height: 1024,
          source: {},
          dispose: () => {
            disposed = true;
          }
        };
      },
      async encode() {
        return dataUrl(PROFILE_AVATAR_TARGET_BYTES + 1);
      }
    };

    await assert.rejects(
      compressProfileAvatar(imageBlob(2_000_000), dependencies),
      /could not be compressed enough/
    );
    assert.equal(disposed, true);
  });
});
