"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="antialiased">
        <div className="flex min-h-screen items-center justify-center bg-[#F3F3F3] p-8">
          <div className="w-full max-w-md rounded-2xl border-2 border-black bg-white p-12 text-center">
            <div className="mb-4 text-6xl font-black text-black">!</div>
            <h2 className="mb-4 text-2xl font-black text-black">Something broke</h2>
            <p className="mb-8 text-sm text-gray-600">
              {error.message || "An unexpected error occurred"}
            </p>
            <button
              type="button"
              onClick={reset}
              className="rounded-full border-2 border-black bg-[#B9FF66] px-8 py-3 font-bold text-black transition-colors hover:bg-black hover:text-[#B9FF66]"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
