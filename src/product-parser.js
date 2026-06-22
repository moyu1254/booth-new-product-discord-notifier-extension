function parseProductsFromHtml(html) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const cards = document.querySelectorAll("li[class*='item-card'], div[class*='item-card']");

  return Array.from(cards)
    .map(parseProductCard)
    .filter(Boolean);
}

function parseProductCard(card) {
  const link =
    card.querySelector("a[class*='item-card__title'][href]") ||
    card.querySelector("a[class*='pc--item-card__title'][href]") ||
    card.querySelector("a[href*='/items/']");

  if (!link) {
    return null;
  }

  const itemMatch = link.href.match(/\/items\/(\d+)/);
  if (!itemMatch) {
    return null;
  }

  const image = card.querySelector("img");
  const price = card.querySelector("[class*='price']");
  const id = itemMatch[1];
  const title = cleanText(link.textContent) || cleanText(image?.alt) || "無題の商品";
  const imageUrl = getImageUrlFromElement(image);
  const badgeTexts = Array.from(
    card.querySelectorAll("span, div, p, a, li")
  ).map((element) => cleanText(element.textContent));
  const isAdult = badgeTexts.some((text) => /(^|[^A-Z])R-18(G)?([^A-Z]|$)|成人向け|18禁/i.test(text));

  return {
    id,
    title,
    url: `https://booth.pm/ja/items/${id}`,
    price: cleanText(price?.textContent) || "価格不明",
    imageUrl,
    isAdult
  };
}

function parseProductDetailImageFromHtml(html) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const selectors = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]'
  ];

  for (const selector of selectors) {
    const imageUrl = document.querySelector(selector)?.getAttribute("content") || "";
    if (imageUrl) {
      return normalizeImageUrl(imageUrl);
    }
  }

  return "";
}

function getImageUrlFromElement(image) {
  if (!image) {
    return "";
  }

  for (const attr of ["src", "data-src", "data-original", "data-lazy-src"]) {
    const imageUrl = image.getAttribute(attr);
    if (imageUrl) {
      return normalizeImageUrl(imageUrl);
    }
  }

  const srcset = image.getAttribute("srcset") || "";
  if (srcset) {
    const firstCandidate = srcset.split(",")[0]?.trim().split(/\s+/)[0] || "";
    if (firstCandidate) {
      return normalizeImageUrl(firstCandidate);
    }
  }

  return "";
}

function cleanText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function normalizeImageUrl(url) {
  if (!url) {
    return "";
  }

  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  if (url.startsWith("/")) {
    return `https://booth.pm${url}`;
  }

  return url;
}
