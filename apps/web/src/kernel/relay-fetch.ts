type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createRelayFetch(
  relayOrigin: string,
  fetcher: FetchLike = fetch,
): FetchLike {
  return (input, init) => {
    const target = input instanceof Request ? input.url : input.toString();
    if (
      new URL(target, globalThis.location?.origin ?? relayOrigin).origin !==
      relayOrigin
    ) {
      return fetcher(input, init);
    }
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    // relay:demo 只是本地非空凭据占位符，不能成为公网协议的一部分。
    headers.delete("authorization");
    return fetcher(input, {
      ...init,
      credentials: "include",
      headers,
    });
  };
}
