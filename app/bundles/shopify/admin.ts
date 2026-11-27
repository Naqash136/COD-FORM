export type AdminGraphql = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<{ json: () => Promise<unknown> }>;
};

export type GraphqlFailure = {
  ok: false;
  code: "graphql_error" | "throttled" | "invalid_response";
  message: string;
};

type GraphqlBody = {
  data?: unknown;
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
  extensions?: { cost?: { throttleStatus?: { currentlyAvailable?: number; restoreRate?: number } } };
};

export async function adminQuery<T>(
  admin: AdminGraphql,
  query: string,
  variables: Record<string, unknown>,
  sleep: (ms: number) => Promise<void> = delay,
): Promise<{ ok: true; data: T } | GraphqlFailure> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let body: GraphqlBody;
    try {
      const response = await admin.graphql(query, { variables });
      body = (await response.json()) as GraphqlBody;
    } catch {
      return { ok: false, code: "invalid_response", message: "Shopify did not return a response." };
    }
    const throttled = body.errors?.some((error) => error.extensions?.code === "THROTTLED");
    if (throttled && attempt < 3) {
      const available = body.extensions?.cost?.throttleStatus?.currentlyAvailable ?? 0;
      const restore = body.extensions?.cost?.throttleStatus?.restoreRate ?? 50;
      const wait = available > 0 ? 250 : Math.min(2000, Math.ceil(1000 / Math.max(restore, 1)));
      await sleep(wait);
      continue;
    }
    if (body.errors?.length) {
      return {
        ok: false,
        code: throttled ? "throttled" : "graphql_error",
        message: body.errors.map((error) => error.message).filter(Boolean).join(" ") || "Shopify query failed.",
      };
    }
    if (!body.data) return { ok: false, code: "invalid_response", message: "Shopify returned no data." };
    return { ok: true, data: body.data as T };
  }
  return { ok: false, code: "throttled", message: "Shopify throttled the request." };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
