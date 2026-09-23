import { createServerFn } from "@tanstack/react-start";

/** Returns the public Firebase web config. Web API keys are publishable by design. */
export const getFirebasePublicConfig = createServerFn({ method: "GET" }).handler(async () => {
  return {
    apiKey: (process.env["GOOGLE_API_KEY"] ?? "").trim() || null,
    measurementId: (process.env["GOOGLE_ANALYTICS_MEASUREMENT_ID"] ?? "").trim() || null,
  };
});
