chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "PARSE_PRODUCTS") {
    return false;
  }

  try {
    const products = parseProducts(message.html || "");
    sendResponse({ ok: true, products });
  } catch (error) {
    sendResponse({ ok: false, message: error.message });
  }

  return true;
});

function parseProducts(html) {
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
  const imageUrl = normalizeImageUrl(
    image?.getAttribute("src") ||
      image?.getAttribute("data-src") ||
      image?.getAttribute("data-original") ||
      ""
  );

  return {
    id,
    title,
    url: `https://booth.pm/ja/items/${id}`,
    price: cleanText(price?.textContent) || "価格不明",
    imageUrl
  };
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

  return url;
}
