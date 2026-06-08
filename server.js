const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.options("*", cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.json({ status: "FadeBot proxy running" });
});

// oEmbed proxy — fetches tweet text from Twitter's free oEmbed API
app.get("/oembed", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "Missing tweet URL" });
  }

  if (!/https?:\/\/(www\.)?(twitter\.com|x\.com)\//i.test(url)) {
    return res.status(400).json({ error: "Only Twitter/X URLs are supported" });
  }

  try {
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;
    const response = await fetch(oembedUrl);

    if (!response.ok) {
      return res.status(502).json({ error: "Twitter oEmbed request failed" });
    }

    const data = await response.json();

    const match = data.html?.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (!match) {
      return res.status(502).json({ error: "Could not parse tweet text" });
    }

    const tweetText = match[1]
      .replace(/<a[^>]*>([^<]*)<\/a>/gi, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();

    res.json({ text: tweetText, author: data.author_name });
  } catch (err) {
    console.error("oEmbed error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Claude proxy — keeps API key server-side
app.post("/analyze", async (req, res) => {
  const { tweetText } = req.body;

  if (!tweetText) {
    return res.status(400).json({ error: "Missing tweetText" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Anthropic API key not configured on server" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: `You are a sports betting assistant. Someone posted this tweet:\n\n"""${tweetText}"""\n\nYour job:\n1. Determine if this tweet contains a sports bet (spread, moneyline, over/under, or parlay).\n2. If it does, extract the bet and produce the OPPOSITE (fade) bet.\n3. Return ONLY a JSON object — no markdown, no explanation — with these exact keys:\n   - "is_bet": true or false\n   - "sport": "NFL", "NBA", "MLB", or "NHL" (or null)\n   - "original_bet": short plain-English description of the bet (e.g. "Chiefs -6.5")\n   - "fade_bet": the opposite bet in plain English (e.g. "Bears +6.5")\n   - "bet_type": "spread" | "moneyline" | "over_under" | "parlay" | "other"\n   - "confidence": "high" | "medium" | "low"\n   - "reasoning": one sentence explaining the fade logic\n   - "copy_text": a ready-to-paste tweet reply, max 240 chars, with the fade bet and a note to fade @BookItWithTrent`
        }]
      })
    });

    const data = await response.json();
    const raw = data.content.map(c => c.text || "").join("");
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);
  } catch (err) {
    console.error("Claude error:", err);
    res.status(500).json({ error: "Failed to analyze bet" });
  }
});

app.listen(PORT, () => {
  console.log(`FadeBot proxy running on port ${PORT}`);
});
