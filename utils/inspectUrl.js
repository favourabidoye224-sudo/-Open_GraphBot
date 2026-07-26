const axios = require("axios");
const cheerio = require("cheerio");

async function inspectUrl(url) {
  const response = await axios.get(url, {
    timeout: 10000,
    maxRedirects: 5,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; OpenGraphBot/1.0; +https://t.me/Open_GraphBot)",
    },
    responseType: "text",
  });

  const $ = cheerio.load(response.data);
  const getMeta = (name) =>
    $(`meta[property="${name}"]`).attr("content") ||
    $(`meta[name="${name}"]`).attr("content") ||
    null;

  return {
    finalUrl: response.request?.res?.responseUrl || url,
    title: getMeta("og:title") || $("title").first().text() || null,
    description: getMeta("og:description") || getMeta("description") || null,
    image: getMeta("og:image"),
    siteName: getMeta("og:site_name"),
    type: getMeta("og:type"),
    twitterCard: getMeta("twitter:card"),
    twitterImage: getMeta("twitter:image"),
  };
}

module.exports = { inspectUrl };
