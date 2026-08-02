import { XMLParser } from "fast-xml-parser";

const SUPABASE_NEWS_URL =
  process.env.SUPABASE_NEWS_URL ??
  "https://pytmyuuoerhrsytwjtbq.supabase.co/rest/v1/news";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_l4cGpyjxQua5ICikOiGqqw_s-_gYVnB";
const GITHUB_MODELS_TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const GITHUB_MODELS_MODEL =
  process.env.GITHUB_MODELS_MODEL ?? "openai/gpt-4o-mini";
const GITHUB_MODELS_URL =
  process.env.GITHUB_MODELS_URL ??
  "https://models.github.ai/inference/chat/completions";
const NEWS_TIME_ZONE = process.env.NEWS_TIME_ZONE ?? "Asia/Taipei";
const NEWS_LOOKBACK_DAYS = parsePositiveInt(process.env.NEWS_LOOKBACK_DAYS, 2);
const NEWS_CANDIDATES = parsePositiveInt(process.env.NEWS_CANDIDATES, 12);
const NEWS_TARGET_ITEMS = parsePositiveInt(process.env.NEWS_TARGET_ITEMS, 5);
const DELETE_NEWS_OLDER_THAN_DAYS = parseNonNegativeInt(
  process.env.DELETE_NEWS_OLDER_THAN_DAYS,
  30,
);
const DRY_RUN =
  process.argv.includes("--dry-run") || process.env.NEWS_DRY_RUN === "1";

const today = formatDateInTimeZone(new Date(), NEWS_TIME_ZONE);

const classroomTags = new Set(["科學", "科技", "天氣", "國際", "社會"]);
const scienceKeywords = [
  "AI",
  "人工智慧",
  "半導體",
  "太空",
  "天文",
  "宇宙",
  "衛星",
  "火箭",
  "物理",
  "科學",
  "科技",
  "地震",
  "颱風",
  "天氣",
  "氣象",
  "氣候",
  "能源",
  "電力",
  "電池",
  "量子",
  "機器人",
  "環境",
  "海洋",
  "醫學",
];
const sensitiveKeywords = [
  "選舉",
  "政黨",
  "立法院",
  "總統",
  "副總統",
  "行政院",
  "立委",
  "議員",
  "市長",
  "政府",
  "蕭美琴",
  "李四川",
  "藍白",
  "民進黨",
  "國民黨",
  "罷免",
  "軍演",
  "戰爭",
  "槍擊",
  "命案",
  "殺人",
  "性侵",
  "虐童",
  "暴力",
  "死傷",
];

const rssFeeds = [
  directRssFeed("科技新報", "https://technews.tw/feed/"),
  directRssFeed("PanSci 泛科學", "https://pansci.asia/feed"),
  googleNewsSearchFeed("科學 OR 物理 OR 天文 OR 太空 OR 氣象 OR 地震"),
  googleNewsSearchFeed("科技 OR AI OR 人工智慧 OR 半導體 OR 能源"),
  googleNewsSearchFeed("台灣 天氣 OR 自然 OR 環境 OR 科學"),
  googleNewsSearchFeed("台灣 新聞"),
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main() {
  if (!DRY_RUN && !GITHUB_MODELS_TOKEN) {
    throw new Error(
      "GITHUB_TOKEN is required. GitHub Actions provides it automatically when models: read permission is enabled.",
    );
  }

  console.log(`Fetching RSS candidates for ${today} (${NEWS_TIME_ZONE})...`);
  const candidates = await getNewsCandidates();
  if (candidates.length === 0) {
    console.log("No RSS candidates found. Nothing to insert.");
    return;
  }

  console.log(`Selected ${candidates.length} candidate articles.`);
  if (DRY_RUN) {
    console.table(
      candidates.map(({ article_index, title, source, published, source_url }) => ({
        article_index,
        title,
        source,
        published,
        source_url,
      })),
    );
    console.log("Dry run completed before GitHub Models and Supabase calls.");
    return;
  }

  const preparedItems = await prepareClassroomItems(candidates);
  if (preparedItems.length === 0) {
    console.log("No classroom-safe items prepared. Nothing to insert.");
    await cleanupOldNews();
    return;
  }

  const existingUrls = await findExistingSourceUrls(
    preparedItems.map((item) => item.source_url),
  );
  const newItems = preparedItems.filter(
    (item) => !existingUrls.has(item.source_url),
  );

  if (newItems.length === 0) {
    console.log("All prepared items already exist in Supabase. Nothing to insert.");
    await cleanupOldNews();
    return;
  }

  const inserted = await insertNews(newItems);
  console.log(`Inserted ${inserted.length} news item(s) into Supabase.`);
  await cleanupOldNews();
}

async function prepareClassroomItems(candidates) {
  try {
    const items = await summarizeForClassroom(candidates);
    if (items.length > 0) return items;

    console.warn(
      "GitHub Models returned no classroom-safe items. Falling back to rule-based summaries.",
    );
  } catch (error) {
    console.warn(
      `GitHub Models unavailable. Falling back to rule-based summaries: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return buildRuleBasedClassroomItems(candidates);
}

async function getNewsCandidates() {
  const batches = await Promise.all(rssFeeds.map(fetchRssFeed));
  const successfulBatches = batches.filter((batch) => batch.ok);
  if (successfulBatches.length === 0) {
    throw new Error("All RSS feeds failed.");
  }

  const byTitle = new Map();
  for (const item of successfulBatches.flatMap((batch) => batch.items)) {
    if (!item.source_url || !item.title) continue;
    const key = normalizeTitleKey(item.title) || item.source_url;
    const existing = byTitle.get(key);
    if (!existing || item.score > existing.score) {
      byTitle.set(key, item);
    }
  }

  return [...byTitle.values()]
    .sort((a, b) => b.score - a.score || b.publishedTime - a.publishedTime)
    .slice(0, NEWS_CANDIDATES)
    .map((item, index) => ({
      article_index: index + 1,
      title: item.title,
      source: item.source,
      published: item.published,
      summary: item.summary,
      source_url: item.source_url,
    }));
}

async function fetchRssFeed(feed) {
  try {
    const response = await fetch(feed.url, {
      headers: {
        "user-agent":
          "teaching-hub-news-bot/1.0 (+https://github.com/chianghunghsuan/teaching-hub)",
      },
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const xml = await response.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      textNodeName: "#text",
      trimValues: true,
      processEntities: true,
      htmlEntities: true,
    });
    const parsed = parser.parse(xml);
    const channel = parsed?.rss?.channel ?? parsed?.feed ?? {};
    const items = toArray(channel.item ?? channel.entry);

    return {
      ok: true,
      items: items
        .map((item) => normalizeRssItem(item, feed.label))
        .filter(Boolean),
    };
  } catch (error) {
    console.warn(
      `RSS feed skipped (${feed.label}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { ok: false, items: [] };
  }
}

function normalizeRssItem(item, feedLabel) {
  const sourceUrl = normalizeUrl(readLink(item));
  const source = stripHtml(readText(item.source)) || feedLabel;
  const rawTitle = stripHtml(readText(item.title));
  const title =
    source && rawTitle.endsWith(` - ${source}`)
      ? rawTitle.slice(0, -source.length - 3)
      : rawTitle;
  const summary = stripHtml(
    readText(item.description ?? item.summary ?? item.content),
  );
  const publishedRaw = readText(
    item.pubDate ?? item.published ?? item.updated ?? item["dc:date"],
  );
  const publishedTime = Number.isNaN(Date.parse(publishedRaw))
    ? 0
    : Date.parse(publishedRaw);
  const published = publishedTime
    ? new Date(publishedTime).toISOString()
    : "";

  if (!sourceUrl || !title) return null;

  const haystack = `${title} ${summary}`;
  const scienceScore = countKeywordHits(haystack, scienceKeywords) * 10;
  const sensitiveScore = countKeywordHits(haystack, sensitiveKeywords) * -25;
  const recencyScore = publishedTime
    ? Math.max(0, Math.round((publishedTime - Date.now()) / 36e5))
    : -100;

  return {
    title,
    source,
    published,
    publishedTime,
    summary: summary.slice(0, 360),
    source_url: sourceUrl,
    score: scienceScore + sensitiveScore + recencyScore,
  };
}

async function summarizeForClassroom(candidates) {
  const prompt = [
    "你是台灣補習班物理老師的課堂時事助理。",
    "請從候選新聞中挑出 3 到 5 則最適合國高中學生課堂分享的內容。",
    "優先選擇和物理、科學、科技、天氣、自然現象、能源、環境相關的題材。",
    "過濾政治敏感、暴力、血腥、八卦、犯罪細節、未證實傳聞，或不適合課堂討論的內容。",
    "每則 content 請用繁體中文，1 到 3 句，能直接跟學生分享，且包含一個延伸討論問題。",
    "tag 只能是：科學、科技、天氣、國際、社會。",
    "article_index 必須使用候選新聞中的編號，不要自創來源。",
    '只輸出 JSON object，格式：{"items":[{"article_index":1,"tag":"科學","content":"..."}]}',
  ].join("\n");

  const response = await fetch(GITHUB_MODELS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${GITHUB_MODELS_TOKEN}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2026-03-10",
    },
    body: JSON.stringify({
      model: GITHUB_MODELS_MODEL,
      temperature: 0.25,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: JSON.stringify(
            {
              today,
              candidates,
            },
            null,
            2,
          ),
        },
      ],
    }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub Models request failed: ${response.status} ${bodyText}`,
    );
  }

  const body = JSON.parse(bodyText);
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("GitHub Models response did not include message content.");
  }

  const candidateByIndex = new Map(
    candidates.map((item) => [item.article_index, item]),
  );
  const seenIndexes = new Set();
  const parsed = parseModelJsonContent(content);
  const items = toArray(parsed.items);

  return items
    .map((item) => {
      const articleIndex = Number(item.article_index);
      const candidate = candidateByIndex.get(articleIndex);
      const tag = String(item.tag ?? "").trim();
      const contentText = String(item.content ?? "").trim();

      if (!candidate || seenIndexes.has(articleIndex)) return null;
      if (!classroomTags.has(tag) || !contentText) return null;

      seenIndexes.add(articleIndex);
      return {
        date: today,
        tag,
        content: contentText,
        source_url: candidate.source_url,
      };
    })
    .filter(Boolean)
    .slice(0, NEWS_TARGET_ITEMS);
}

async function findExistingSourceUrls(sourceUrls) {
  const existing = new Set();

  for (const sourceUrl of new Set(sourceUrls)) {
    const url = new URL(SUPABASE_NEWS_URL);
    url.searchParams.set("select", "source_url");
    url.searchParams.set("source_url", `eq.${sourceUrl}`);

    const rows = await supabaseJson(url, { method: "GET" }, "check duplicate");
    if (Array.isArray(rows) && rows.length > 0) {
      existing.add(sourceUrl);
    }
  }

  return existing;
}

function parseModelJsonContent(content) {
  const trimmed = String(content ?? "").trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Some model providers may still wrap JSON in a markdown fence.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Fall through to object extraction below.
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }

  throw new Error("GitHub Models response was not valid JSON.");
}

function buildRuleBasedClassroomItems(candidates) {
  const selected = candidates
    .filter((candidate) => !hasKeyword(candidate, sensitiveKeywords))
    .slice(0, NEWS_TARGET_ITEMS);

  return selected.map((candidate) => {
    const tag = inferTag(candidate);
    return {
      date: today,
      tag,
      content: buildRuleBasedContent(candidate, tag),
      source_url: candidate.source_url,
    };
  });
}

function inferTag(candidate) {
  if (hasKeyword(candidate, ["颱風", "天氣", "氣象", "雷雨", "大雨", "氣候"])) {
    return "天氣";
  }
  if (
    hasKeyword(candidate, [
      "AI",
      "人工智慧",
      "半導體",
      "晶片",
      "機器人",
      "資料中心",
      "電池",
      "能源",
      "科技",
    ])
  ) {
    return "科技";
  }
  if (
    hasKeyword(candidate, [
      "物理",
      "科學",
      "太空",
      "火箭",
      "天文",
      "宇宙",
      "NASA",
      "研究",
      "地震",
      "環境",
      "海洋",
    ])
  ) {
    return "科學";
  }
  if (hasKeyword(candidate, ["日本", "美國", "英國", "熊本", "國際"])) {
    return "國際";
  }
  return "社會";
}

function buildRuleBasedContent(candidate, tag) {
  const title = cleanTitleForClassroom(candidate.title);
  const question = discussionQuestionFor(tag);

  return `今天可用「${title}」帶學生連結生活中的${topicLabelFor(tag)}議題，先從新聞標題觀察現象，再討論背後可能牽涉的科學概念。延伸討論：${question}`;
}

function discussionQuestionFor(tag) {
  const questions = {
    科學: "如果要把這件事轉成一個可驗證的科學問題，我們會需要哪些資料？",
    科技: "這項技術解決了什麼問題，又可能帶來哪些新的限制或風險？",
    天氣: "我們可以從哪些氣象資料判斷預報可信度，而不是只看單一標題？",
    國際: "不同國家的條件不同，這則新聞中的做法適合直接套用在台灣嗎？",
    社會: "這件事和日常生活有什麼關聯，可以用哪些數據來討論它的影響？",
  };

  return questions[tag] ?? questions.社會;
}

function topicLabelFor(tag) {
  const labels = {
    科學: "科學",
    科技: "科技",
    天氣: "天氣與自然",
    國際: "國際",
    社會: "社會",
  };

  return labels[tag] ?? labels.社會;
}

function cleanTitleForClassroom(title) {
  return stripHtml(title)
    .replace(/\s*[-|｜]\s*[^-|｜]{1,16}$/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function hasKeyword(candidate, keywords) {
  const haystack = `${candidate.title ?? ""} ${candidate.summary ?? ""}`;
  return keywords.some((keyword) => haystack.includes(keyword));
}

async function insertNews(items) {
  return supabaseJson(
    SUPABASE_NEWS_URL,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer: "return=representation",
      },
      body: JSON.stringify(items),
    },
    "insert news",
  );
}

async function cleanupOldNews() {
  if (!DELETE_NEWS_OLDER_THAN_DAYS) return;

  const cutoff = formatDateInTimeZone(
    new Date(Date.now() - DELETE_NEWS_OLDER_THAN_DAYS * 24 * 60 * 60 * 1000),
    NEWS_TIME_ZONE,
  );
  const url = new URL(SUPABASE_NEWS_URL);
  url.searchParams.set("date", `lt.${cutoff}`);

  try {
    await supabaseText(
      url,
      {
        method: "DELETE",
        headers: { prefer: "return=minimal" },
      },
      "delete old news",
    );
    console.log(`Deleted news older than ${cutoff}, if any.`);
  } catch (error) {
    console.warn(
      `Old-news cleanup skipped: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function supabaseJson(url, options, action) {
  const text = await supabaseText(url, options, action);
  return text ? JSON.parse(text) : [];
}

async function supabaseText(url, options, action) {
  const headers = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    ...(options.headers ?? {}),
  };
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Supabase ${action} failed: ${response.status} ${text}`);
  }

  return text;
}

function googleNewsSearchFeed(query) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", `${query} when:${NEWS_LOOKBACK_DAYS}d`);
  url.searchParams.set("hl", "zh-TW");
  url.searchParams.set("gl", "TW");
  url.searchParams.set("ceid", "TW:zh-Hant");

  return {
    label: query,
    url: url.toString(),
  };
}

function directRssFeed(label, url) {
  return { label, url };
}

function readLink(item) {
  if (typeof item.link === "string") return item.link;
  if (Array.isArray(item.link)) {
    const alternate = item.link.find((link) => link.rel === "alternate");
    return readText(alternate?.href ?? alternate ?? item.link[0]);
  }
  return readText(item.link?.href ?? item.link ?? item.guid ?? item.id);
}

function readText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return readText(value[0]);
  if (typeof value === "object") {
    return readText(value["#text"] ?? value.text ?? value._ ?? "");
  }
  return "";
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return named[entity] ?? match;
  });
}

function normalizeUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    return new URL(text).toString();
  } catch {
    return "";
  }
}

function normalizeTitleKey(value) {
  return stripHtml(value)
    .toLowerCase()
    .replace(/[\s"'“”‘’「」『』（）()【】\[\]《》,，.。:：;；!！?？|｜-]+/g, "")
    .trim();
}

function countKeywordHits(text, keywords) {
  return keywords.reduce(
    (count, keyword) => count + (text.includes(keyword) ? 1 : 0),
    0,
  );
}

function formatDateInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}
