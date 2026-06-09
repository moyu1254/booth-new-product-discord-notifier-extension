chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "PARSE_PRODUCTS") {
    return false;
  }

  try {
    const products = parseProductsFromHtml(message.html || "");
    sendResponse({ ok: true, products });
  } catch (error) {
    sendResponse({ ok: false, message: error.message });
  }

  return true;
});
