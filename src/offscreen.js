chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    if (message?.type === "PARSE_PRODUCTS") {
      const products = parseProductsFromHtml(message.html || "");
      sendResponse({ ok: true, products });
      return true;
    }

    if (message?.type === "PARSE_PRODUCT_DETAIL_IMAGE") {
      const imageUrl = parseProductDetailImageFromHtml(message.html || "");
      sendResponse({ ok: true, imageUrl });
      return true;
    }

    return false;
  } catch (error) {
    sendResponse({ ok: false, message: error.message });
    return true;
  }
});
