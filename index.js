require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const axios = require("axios");

const { generateOgImage } = require("./utils/generateImage");
const { inspectUrl } = require("./utils/inspectUrl");
const { getSession, startSession, updateSession, clearSession } = require("./utils/sessions");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN environment variable.");
  process.exit(1);
}

const app = express();
app.get("/", (_req, res) => res.send("Open_GraphBot is running."));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Health check server listening on port ${PORT}`));

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
bot.on("polling_error", (err) => console.error("Polling error:", err.message));

const URL_REGEX = /^https?:\/\/[^\s]+$/i;

const templateKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "Blue", callback_data: "tpl_blue" }, { text: "Purple", callback_data: "tpl_purple" }],
      [{ text: "Dark", callback_data: "tpl_dark" }, { text: "Sunset", callback_data: "tpl_sunset" }],
      [{ text: "Green", callback_data: "tpl_green" }],
    ],
  },
};

const skipBgKeyboard = {
  reply_markup: { inline_keyboard: [[{ text: "Skip (use gradient)", callback_data: "bg_skip" }]] },
};

bot.onText(/^\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Welcome to *Open_GraphBot*!\n\n" +
      "🎨 /generate — build a custom OG preview image\n" +
      "🔍 /inspect <url> — see the current OG tags & image on any site\n" +
      "❌ /cancel — cancel whatever you're doing\n\n" +
      "You can also just paste a URL and I'll inspect it automatically.",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/^\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "*Commands*\n/generate — start the image wizard\n/inspect <url> — fetch a site's OG tags\n/cancel — abort the wizard",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/^\/cancel/, (msg) => {
  clearSession(msg.chat.id);
  bot.sendMessage(msg.chat.id, "Cancelled. Send /generate or /inspect <url> whenever you're ready.");
});

bot.onText(/^\/generate/, (msg) => {
  startSession(msg.chat.id);
  bot.sendMessage(msg.chat.id, "Let's build your OG image! 📝\n\nFirst, send me the *title* text.", {
    parse_mode: "Markdown",
  });
});

bot.onText(/^\/inspect(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const url = match[1]?.trim();
  if (!url || !URL_REGEX.test(url)) {
    bot.sendMessage(chatId, "Usage: `/inspect https://example.com`", { parse_mode: "Markdown" });
    return;
  }
  await handleInspect(chatId, url);
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  if (!msg.text || msg.text.startsWith("/")) return;

  const session = getSession(chatId);
  if (!session) {
    if (URL_REGEX.test(msg.text.trim())) await handleInspect(chatId, msg.text.trim());
    return;
  }

  if (session.step === "awaiting_title") {
    updateSession(chatId, { step: "awaiting_description", data: { ...session.data, title: msg.text } });
    bot.sendMessage(chatId, "Great. Now send a short *description* (or /skip to leave it blank).", {
      parse_mode: "Markdown",
    });
    return;
  }

  if (session.step === "awaiting_description") {
    const description = msg.text === "/skip" ? null : msg.text;
    updateSession(chatId, { step: "awaiting_template", data: { ...session.data, description } });
    bot.sendMessage(chatId, "Pick a color template:", templateKeyboard);
    return;
  }

  if (session.step === "awaiting_bgimage") {
    bot.sendMessage(chatId, "Send a photo to use as the background, or tap Skip above.");
  }
});

bot.onText(/^\/skip/, (msg) => {
  const chatId = msg.chat.id;
  const session = getSession(chatId);
  if (session && session.step === "awaiting_description") {
    updateSession(chatId, { step: "awaiting_template", data: { ...session.data, description: null } });
    bot.sendMessage(chatId, "Pick a color template:", templateKeyboard);
  }
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const session = getSession(chatId);

  if (query.data.startsWith("tpl_")) {
    const template = query.data.replace("tpl_", "");
    if (!session) {
      bot.answerCallbackQuery(query.id, { text: "Session expired, run /generate again." });
      return;
    }
    updateSession(chatId, { step: "awaiting_bgimage", data: { ...session.data, template } });
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(
      chatId,
      "Optional: send a *photo* to use as the background, or tap Skip to use the gradient template.",
      { parse_mode: "Markdown", ...skipBgKeyboard }
    );
    return;
  }

  if (query.data === "bg_skip") {
    bot.answerCallbackQuery(query.id);
    await finishGeneration(chatId);
  }
});

bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const session = getSession(chatId);
  if (!session || session.step !== "awaiting_bgimage") return;

  try {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileUrl = await bot.getFileLink(fileId);
    const response = await axios.get(fileUrl, { responseType: "arraybuffer" });
    await finishGeneration(chatId, Buffer.from(response.data));
  } catch (err) {
    console.error("Failed to download background photo:", err.message);
    bot.sendMessage(chatId, "Couldn't process that photo. Let's use the gradient instead.");
    await finishGeneration(chatId);
  }
});

async function finishGeneration(chatId, bgImageBuffer = null) {
  const session = getSession(chatId);
  if (!session) return;

  const { title, description, template } = session.data;
  bot.sendMessage(chatId, "Generating your image… 🎨");

  try {
    const imageBuffer = await generateOgImage({
      title,
      description,
      template: template || "blue",
      bgImageBuffer,
    });

    await bot.sendPhoto(chatId, imageBuffer, {}, { filename: "og-image.png", contentType: "image/png" });

    const snippet = buildMetaSnippet({ title, description });
    await bot.sendMessage(
      chatId,
      "Here's your HTML snippet. Upload the image above to your site/CDN and replace " +
        "`YOUR_IMAGE_URL_HERE` with its final public URL:\n\n```html\n" + snippet + "\n```",
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("Image generation failed:", err.message);
    bot.sendMessage(chatId, "Sorry, something went wrong generating the image. Try /generate again.");
  } finally {
    clearSession(chatId);
  }
}

function buildMetaSnippet({ title, description }) {
  const esc = (s) => (s || "").replace(/"/g, "&quot;");
  return (
    `<meta property="og:title" content="${esc(title)}" />\n` +
    `<meta property="og:description" content="${esc(description || "")}" />\n` +
    `<meta property="og:image" content="YOUR_IMAGE_URL_HERE" />\n` +
    `<meta property="og:type" content="website" />\n` +
    `<meta name="twitter:card" content="summary_large_image" />`
  );
}

async function handleInspect(chatId, url) {
  bot.sendMessage(chatId, `Fetching OG tags for ${url} …`);
  try {
    const data = await inspectUrl(url);
    const lines = [
      `*Title:* ${data.title || "—"}`,
      `*Description:* ${data.description || "—"}`,
      `*Site name:* ${data.siteName || "—"}`,
      `*Type:* ${data.type || "—"}`,
      `*Twitter card:* ${data.twitterCard || "—"}`,
    ];
    await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });

    const imageUrl = data.image || data.twitterImage;
    if (imageUrl) {
      try {
        await bot.sendPhoto(chatId, imageUrl);
      } catch {
        await bot.sendMessage(chatId, `Image URL (couldn't preview directly): ${imageUrl}`);
      }
    } else {
      await bot.sendMessage(chatId, "No og:image found on that page.");
    }
  } catch (err) {
    console.error("Inspect failed:", err.message);
    bot.sendMessage(chatId, `Couldn't fetch that URL: ${err.message}`);
  }
}

console.log("Open_GraphBot started.");
