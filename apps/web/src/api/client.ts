export const SESSION_CLIENT_ID_HEADER = "X-ChatHTML-Client-Id";

export function clientRequestHeaders(
  clientId: string,
  contentType?: string
): HeadersInit {
  return {
    ...(contentType ? { "Content-Type": contentType } : {}),
    [SESSION_CLIENT_ID_HEADER]: clientId
  };
}
