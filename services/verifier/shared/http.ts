export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
    },
    ...init,
  });
}

export function requireBearerAuth(request: Request, token: string | null): Response | null {
  if (!token) {
    return null;
  }
  return request.headers.get("authorization") === `Bearer ${token}`
    ? null
    : json({ error: "Unauthorized" }, { status: 401 });
}
