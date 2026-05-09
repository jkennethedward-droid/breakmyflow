import * as screenshotone from "screenshotone-api-sdk";

const SCREENSHOT_TIMEOUT_MS = 15000; // 15 seconds

function getScreenshotOneClient(): screenshotone.Client {
  const raw = process.env.SCREENSHOTONE_API_KEY;
  if (!raw) {
    throw new Error(
      "Missing SCREENSHOTONE_API_KEY. Expected format: '<accessKey>:<secretKey>'.",
    );
  }

  const [accessKey, secretKey] = raw.split(":", 2);
  if (!accessKey || !secretKey) {
    throw new Error(
      "Invalid SCREENSHOTONE_API_KEY. Expected format: '<accessKey>:<secretKey>'.",
    );
  }

  return new screenshotone.Client(accessKey, secretKey);
}

export async function captureScreenshot(url: string): Promise<string> {
  try {
    const client = getScreenshotOneClient();

    const options = screenshotone.TakeOptions.url(url)
      .viewportWidth(1280)
      .viewportHeight(800)
      .fullPage(false)
      .format("jpg")
      .cache(false);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Screenshot timed out after 15 seconds")),
        SCREENSHOT_TIMEOUT_MS,
      );
    });

    try {
      const imageBlob = await Promise.race([
        client.take(options),
        timeoutPromise,
      ]);
      const buffer = Buffer.from(await imageBlob.arrayBuffer());
      return buffer.toString("base64");
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown ScreenshotOne error";
    throw new Error(`Failed to capture screenshot for "${url}": ${message}`);
  }
}
