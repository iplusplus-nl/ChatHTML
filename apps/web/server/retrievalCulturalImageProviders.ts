import {
  clip,
  compactParts,
  mapLimited,
  parseAbsoluteUrl
} from "./retrievalPrimitives.js";
import {
  fetchRetrievalJson,
  retrievalImageProviderLimit,
  RETRIEVAL_USER_AGENT
} from "./retrievalProviderClient.js";
import type { RetrievalConfig, SearchResult } from "./retrievalTypes.js";

export async function searchNasaImages(
  query: string,
  config: RetrievalConfig
): Promise<SearchResult[]> {
  const url = new URL("https://images-api.nasa.gov/search");
  url.searchParams.set("q", query);
  url.searchParams.set("media_type", "image");
  url.searchParams.set("page_size", String(retrievalImageProviderLimit(config)));

  const data = (await fetchRetrievalJson(
    url.toString(),
    {
      headers: {
        Accept: "application/json",
        "User-Agent": RETRIEVAL_USER_AGENT
      }
    },
    config.timeoutMs,
    config.signal
  )) as {
    collection?: {
      items?: Array<{
        data?: Array<{
          title?: string;
          description?: string;
          nasa_id?: string;
        }>;
        links?: Array<{ href?: string; rel?: string; render?: string }>;
      }>;
    };
  };

  return (data.collection?.items ?? [])
    .map((item, index) => {
      const metadata = item.data?.[0] ?? {};
      const preview =
        item.links?.find(
          (link) => link.rel === "preview" || link.render === "image"
        )?.href ?? item.links?.[0]?.href;
      const sourceUrl = metadata.nasa_id
        ? `https://images.nasa.gov/details/${encodeURIComponent(metadata.nasa_id)}`
        : "https://images.nasa.gov/";

      return {
        url: sourceUrl,
        title: clip(metadata.title, 220),
        snippet: compactParts([
          clip(metadata.description, 320),
          "NASA Image and Video Library"
        ]),
        imageUrl: parseAbsoluteUrl(preview ?? ""),
        imageAlt: clip(metadata.title, 160),
        imageCredit: "NASA Image and Video Library",
        imageLicense: "NASA media guidelines",
        imageLicenseUrl:
          "https://www.nasa.gov/nasa-brand-center/images-and-media/",
        provider: "nasa",
        rank: index + 1
      };
    })
    .filter((result) => result.url && result.imageUrl);
}

export async function searchLibraryOfCongressImages(
  query: string,
  config: RetrievalConfig
): Promise<SearchResult[]> {
  const url = new URL("https://www.loc.gov/photos/");
  url.searchParams.set("fo", "json");
  url.searchParams.set("q", query);
  url.searchParams.set("c", String(retrievalImageProviderLimit(config)));

  const data = (await fetchRetrievalJson(
    url.toString(),
    {
      headers: {
        Accept: "application/json",
        "User-Agent": RETRIEVAL_USER_AGENT
      }
    },
    config.timeoutMs,
    config.signal
  )) as {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string | string[];
      contributor_names?: string[];
      image_url?: string[];
    }>;
  };

  return (data.results ?? [])
    .map((item, index) => {
      const imageUrls = item.image_url ?? [];
      const imageUrl = imageUrls[imageUrls.length - 1] ?? imageUrls[0];
      const description = Array.isArray(item.description)
        ? item.description.join(" ")
        : item.description;

      return {
        url: parseAbsoluteUrl(item.url ?? "") ?? "",
        title: clip(item.title, 220),
        snippet: compactParts([
          clip(description, 320),
          item.contributor_names?.[0]
            ? `Contributor: ${item.contributor_names[0]}`
            : undefined,
          "Library of Congress"
        ]),
        imageUrl: parseAbsoluteUrl(imageUrl ?? ""),
        imageAlt: clip(item.title, 160),
        imageCreator: clip(item.contributor_names?.[0], 160),
        imageCredit: "Library of Congress",
        imageLicense: "Library of Congress rights advisory",
        imageLicenseUrl: "https://www.loc.gov/free-to-use/",
        provider: "loc",
        rank: index + 1
      };
    })
    .filter((result) => result.url && result.imageUrl);
}

export async function searchMetImages(
  query: string,
  config: RetrievalConfig
): Promise<SearchResult[]> {
  const searchUrl = new URL(
    "https://collectionapi.metmuseum.org/public/collection/v1/search"
  );
  searchUrl.searchParams.set("hasImages", "true");
  searchUrl.searchParams.set("q", query);

  const searchData = (await fetchRetrievalJson(
    searchUrl.toString(),
    {
      headers: {
        Accept: "application/json",
        "User-Agent": RETRIEVAL_USER_AGENT
      }
    },
    config.timeoutMs,
    config.signal
  )) as { objectIDs?: number[] };

  const objectIds = (searchData.objectIDs ?? []).slice(
    0,
    retrievalImageProviderLimit(config)
  );
  const objects = await mapLimited(objectIds, 4, async (objectId) => {
    const objectUrl = `https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`;
    return fetchRetrievalJson(
      objectUrl,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": RETRIEVAL_USER_AGENT
        }
      },
      config.timeoutMs,
      config.signal
    ) as Promise<{
      objectID?: number;
      title?: string;
      artistDisplayName?: string;
      objectDate?: string;
      objectURL?: string;
      primaryImage?: string;
      primaryImageSmall?: string;
      isPublicDomain?: boolean;
    }>;
  });

  return objects
    .map((object, index) => ({
      url:
        parseAbsoluteUrl(object.objectURL ?? "") ??
        `https://www.metmuseum.org/art/collection/search/${object.objectID ?? ""}`,
      title: clip(object.title, 220),
      snippet: compactParts([
        object.artistDisplayName
          ? `Artist: ${object.artistDisplayName}`
          : undefined,
        object.objectDate,
        object.isPublicDomain
          ? "Public domain image from The Met Open Access"
          : "The Met Collection"
      ]),
      imageUrl: parseAbsoluteUrl(
        object.primaryImageSmall ?? object.primaryImage ?? ""
      ),
      imageAlt: clip(object.title, 160),
      imageCreator: clip(object.artistDisplayName, 160),
      imageCredit: "The Metropolitan Museum of Art",
      imageLicense: object.isPublicDomain
        ? "Public domain"
        : "The Met image terms",
      imageLicenseUrl: "https://www.metmuseum.org/hubs/open-access",
      provider: "met",
      rank: index + 1
    }))
    .filter((result) => result.url && result.imageUrl);
}

export async function searchArtInstituteImages(
  query: string,
  config: RetrievalConfig
): Promise<SearchResult[]> {
  const url = new URL("https://api.artic.edu/api/v1/artworks/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(retrievalImageProviderLimit(config)));
  url.searchParams.set(
    "fields",
    "id,title,artist_display,date_display,image_id,thumbnail"
  );

  const data = (await fetchRetrievalJson(
    url.toString(),
    {
      headers: {
        Accept: "application/json",
        "User-Agent": RETRIEVAL_USER_AGENT
      }
    },
    config.timeoutMs,
    config.signal
  )) as {
    config?: { iiif_url?: string };
    data?: Array<{
      id?: number;
      title?: string;
      artist_display?: string;
      date_display?: string;
      image_id?: string;
      thumbnail?: { alt_text?: string };
    }>;
  };

  const iiifBase = data.config?.iiif_url || "https://www.artic.edu/iiif/2";
  return (data.data ?? [])
    .map((artwork, index) => ({
      url: artwork.id ? `https://www.artic.edu/artworks/${artwork.id}` : "",
      title: clip(artwork.title, 220),
      snippet: compactParts([
        artwork.artist_display ? `Artist: ${artwork.artist_display}` : undefined,
        artwork.date_display,
        "Art Institute of Chicago"
      ]),
      imageUrl: artwork.image_id
        ? `${iiifBase}/${encodeURIComponent(artwork.image_id)}/full/843,/0/default.jpg`
        : undefined,
      imageAlt: clip(artwork.thumbnail?.alt_text || artwork.title, 160),
      imageCreator: clip(artwork.artist_display, 160),
      imageCredit: "Art Institute of Chicago",
      imageLicense: "Art Institute of Chicago Open Access",
      imageLicenseUrl:
        "https://www.artic.edu/open-access/open-access-images",
      provider: "artic",
      rank: index + 1
    }))
    .filter((result) => result.url && result.imageUrl);
}

export async function searchRijksmuseumImages(
  query: string,
  config: RetrievalConfig
): Promise<SearchResult[]> {
  const apiKey =
    process.env.RIJKSMUSEUM_API_KEY?.trim() || process.env.RIJKS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RIJKSMUSEUM_API_KEY is not set.");
  }

  const url = new URL("https://www.rijksmuseum.nl/api/en/collection");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("q", query);
  url.searchParams.set("imgonly", "True");
  url.searchParams.set("ps", String(retrievalImageProviderLimit(config)));

  const data = (await fetchRetrievalJson(
    url.toString(),
    {
      headers: {
        Accept: "application/json",
        "User-Agent": RETRIEVAL_USER_AGENT
      }
    },
    config.timeoutMs,
    config.signal
  )) as {
    artObjects?: Array<{
      title?: string;
      longTitle?: string;
      principalOrFirstMaker?: string;
      links?: { web?: string };
      webImage?: { url?: string; width?: number; height?: number };
    }>;
  };

  return (data.artObjects ?? [])
    .map((object, index) => ({
      url: parseAbsoluteUrl(object.links?.web ?? "") ?? "",
      title: clip(object.title || object.longTitle, 220),
      snippet: compactParts([
        object.principalOrFirstMaker
          ? `Maker: ${object.principalOrFirstMaker}`
          : undefined,
        object.longTitle,
        "Rijksmuseum"
      ]),
      imageUrl: parseAbsoluteUrl(object.webImage?.url ?? ""),
      imageAlt: clip(object.longTitle || object.title, 160),
      imageWidth: object.webImage?.width,
      imageHeight: object.webImage?.height,
      imageCreator: clip(object.principalOrFirstMaker, 160),
      imageCredit: "Rijksmuseum",
      imageLicense: "Rijksmuseum collection image terms",
      imageLicenseUrl: "https://data.rijksmuseum.nl/",
      provider: "rijksmuseum",
      rank: index + 1
    }))
    .filter((result) => result.url && result.imageUrl);
}
