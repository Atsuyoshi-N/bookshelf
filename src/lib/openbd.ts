interface OpenBDResponse {
  summary?: {
    cover?: string;
  };
}

async function fetchFromOpenBD(
  isbns: string[]
): Promise<Map<string, string>> {
  const coverMap = new Map<string, string>();
  if (isbns.length === 0) return coverMap;

  try {
    const response = await fetch(
      `https://api.openbd.jp/v1/get?isbn=${isbns.join(",")}`
    );
    const data: (OpenBDResponse | null)[] = await response.json();

    data.forEach((item, index) => {
      const cover = item?.summary?.cover;
      if (cover) {
        coverMap.set(isbns[index], cover);
      }
    });
  } catch (error) {
    console.warn("OpenBD API request failed:", error);
  }

  return coverMap;
}

function buildNdlCoverUrl(isbn: string): string {
  return `https://ndlsearch.ndl.go.jp/thumbnail/${isbn}.jpg`;
}

export async function fetchCoverUrls(
  isbns: string[]
): Promise<Map<string, string>> {
  // 1. Try OpenBD first (batch request, may have higher-res covers)
  const coverMap = await fetchFromOpenBD(isbns);

  // 2. For ISBNs not found in OpenBD, use NDL thumbnail
  //    NDL doesn't need an API call to resolve — the URL pattern is deterministic
  for (const isbn of isbns) {
    if (!coverMap.has(isbn)) {
      coverMap.set(isbn, buildNdlCoverUrl(isbn));
    }
  }

  return coverMap;
}
