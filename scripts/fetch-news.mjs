import { XMLParser } from "fast-xml-parser";

const SUPABASE_NEWS_URL =
  process.env.SUPABASE_NEWS_URL ??
  "https://pytmyuuoerhrsytwjtbq.supabase.co/rest/v1/news";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_l4cGpyjxQua5ICikOiGqqw_s-_gYVnB";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// 依序嘗試，第一個能用的就採用（Google 換版也不會壞）
const GEMINI_MODELS = (
  process.env.GEMINI_MODEL ??
  "gemini-flash-latest,gemini-3.6-flash,gemini-3.5-flash-lite,gemini-2.5-flash-lite,gemini-2.0-flash"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const NEWS_TIME_ZONE = process.env.NEWS_TIME_ZONE ?? "Asia/Taipei";
const NEWS_LOOKBACK_DAYS = parsePositiveInt(process.env.NEWS_LOOKBACK_DAYS, 2);
const NEWS_MAX_CANDIDATE_AGE_DAYS = parsePositiveInt(
  process.env.NEWS_MAX_CANDIDATE_AGE_DAYS,
  21,
);
const NEWS_CANDIDATES = parsePositiveInt(process.env.NEWS_CANDIDATES, 18);
const NEWS_TARGET_ITEMS = parsePositiveInt(process.env.NEWS_TARGET_ITEMS, 6);
const NEWS_MAX_PER_SOURCE = parsePositiveInt(
  process.env.NEWS_MAX_PER_SOURCE,
  4,
);
const NEWS_MAX_PER_TOPIC = parsePositiveInt(
  process.env.NEWS_MAX_PER_TOPIC,
  3,
);
const DELETE_NEWS_OLDER_THAN_DAYS = parseNonNegativeInt(
  process.env.DELETE_NEWS_OLDER_THAN_DAYS,
  30,
);
const FORCE_REFRESH = process.env.NEWS_FORCE_REFRESH === "1";
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
const studentKeywords = [
  "學生",
  "高中",
  "高職",
  "大學",
  "大學生",
  "研究所",
  "學測",
  "分科",
  "志願",
  "科系",
  "職涯",
  "實驗高中",
  "科學班",
  "奧林匹亞",
  "教育",
  "校園",
  "科展",
  "指考",
  "放榜",
  "落點",
  "頂標",
  "五標",
  "級分",
  "錄取",
  "繁星",
  "申請入學",
  "分發",
];
const industryKeywords = [
  "科技業",
  "裁員",
  "徵才",
  "職缺",
  "工程師",
  "軟體",
  "硬體",
  "AI",
  "機器人",
  "自動化",
  "半導體",
  "晶片",
  "資料中心",
  "雲端",
  "蘋果",
  "Apple",
  "微軟",
  "Microsoft",
  "Google",
  "OpenAI",
  "NVIDIA",
  "輝達",
  "台積電",
  "鴻海",
];
const publicLifeKeywords = [
  "COVID",
  "新冠",
  "疫情",
  "疫苗",
  "公共衛生",
  "食安",
  "毒油",
  "食品",
  "油品",
  "醫療",
  "藥物",
  "能源",
  "環境",
  "電力",
  "交通",
  "天氣",
  "氣象",
  "颱風",
  "地震",
  "消費",
  "個資",
  "詐騙",
  "詐欺",
  "報關",
  "網購",
  "遊戲",
  "電玩",
  "寶可夢",
  "任天堂",
  "手遊",
];
const sensitiveKeywords = [
  "選舉",
  "政黨",
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
  "股價",
  "股市",
  "個股",
  "指數",
  "台股",
  "美股",
  "投資",
  "吸金",
  "崩跌",
  "狂殺",
  "漲跌",
  "營收",
  "法人",
  "財報",
  "自由現金流",
  "資本支出",
  "收割期",
  "商機",
  "ETF",
  "解放軍",
  "軍事",
  "軍演",
  "火箭筒",
  "戰士",
  "國防",
  "身亡",
  "死亡",
  "死者",
  "罹難",
];

const hardBlockedKeywords = [
  "血腥",
  "分屍",
  "碎屍",
  "虐童",
  "性侵",
  "猥褻",
  "偷拍",
  "八卦",
];

const spaceKeywords = [
  "太空",
  "火箭",
  "衛星",
  "SpaceX",
  "NASA",
  "Artemis",
  "JPL",
  "Starship",
  "登月",
  "軌道",
  "發射",
];

const educationAchievementKeywords = [
  "物理奧林匹亞",
  "數學奧林匹亞",
  "化學奧林匹亞",
  "生物奧林匹亞",
  "奧林匹亞",
  "科學班",
  "實驗高中",
  "科展",
  "STEM",
  "資優",
];

const policyKeywords = [
  "政策",
  "補助",
  "教育部",
  "國教署",
  "國科會",
  "台北市政府",
  "數位學習",
  "AI工具",
  "AI 工具",
  "校園",
];

const economyKeywords = [
  "經濟",
  "出口",
  "關稅",
  "供應鏈",
  "景氣",
  "GDP",
  "就業",
  "失業",
  "油價",
  "電價",
  "通膨",
  "薪資",
];

const conflictKeywords = [
  "戰爭",
  "衝突",
  "停火",
  "中東",
  "伊朗",
  "以色列",
  "烏克蘭",
  "俄羅斯",
  "軍費",
  "難民",
];

const futureOfWorkKeywords = [
  "職缺",
  "徵才",
  "裁員",
  "工程師",
  "實習",
  "資料中心",
  "AI代理",
  "AI 代理",
  "機器人",
  "半導體",
  "台積電",
  "輝達",
  "NVIDIA",
  "OpenAI",
  "微軟",
  "蘋果",
  "供應鏈",
];

const officialHighValueKeywords = [
  "物理奧林匹亞",
  "數學奧林匹亞",
  "化學奧林匹亞",
  "生物奧林匹亞",
  "奧林匹亞",
  "科學班",
  "實驗高中",
  "科展",
  "STEM",
  "資優",
  "火箭賽",
  "太空人才",
  "科學教育",
  "教育政策",
  "數位學習",
  "AI工具",
  "AI 工具",
  "校園",
  "職涯",
  "徵才",
  "就業",
  "半導體",
  "機器人",
  "公共衛生",
  "食安",
];

const lowSignalOfficialKeywords = [
  "表揚",
  "模範公務人員",
  "預備會議",
  "頒獎典禮",
  "學術研究獎項",
  "數位示範體驗場域",
  "布達",
  "交接典禮",
  "致詞",
  "蒞臨",
  "揭牌",
  "開幕",
  "交流",
  "參訪",
  "說明會",
  "論壇",
  "記者會",
  "成果展",
  "研習",
  "宣導",
];

const priorityTopicOrder = [
  "education",
  "career",
  "ai-robotics",
  "big-tech",
  "industry",
  "space",
  "science",
  "public-health",
  "life",
  "economy",
  "global-conflict",
  "weather",
  "general",
];

const rssFeeds = [
  directRssFeed("TechNews 科技新報", "https://technews.tw/tn-rss/"),
  directRssFeed("PanSci 泛科學", "https://pansci.asia/feed"),
  directRssFeed("教育部即時新聞", "https://www.moe.gov.tw/Rss_News.aspx?n=9E7AC85F1954DDA8"),
  directRssFeed("國科會新聞資料", "https://www.nstc.gov.tw/nstc/rss/newsdata"),
  directRssFeed("CNA 科技", "https://feeds.feedburner.com/rsscna/technology"),
  directRssFeed("CNA 生活", "https://feeds.feedburner.com/rsscna/lifehealth"),
  directRssFeed("CNA 國際", "https://feeds.feedburner.com/rsscna/intworld"),
  directRssFeed("NASA Technology", "https://www.nasa.gov/technology/feed/"),
  directRssFeed("NASA Artemis", "https://www.nasa.gov/missions/artemis/feed/"),
  directRssFeed("NASA JPL", "https://www.nasa.gov/centers-and-facilities/jpl/feed/"),
  directRssFeed("Space.com", "https://www.space.com/feeds.xml"),
  googleNewsSearchFeed("台灣 科學 OR 物理 OR 地震 OR 太空 OR 氣候 OR 醫學"),
  googleNewsSearchFeed("台灣 科技 OR AI OR 機器人 OR 半導體 OR 台積電 OR 輝達 OR 微軟 OR 蘋果"),
  googleNewsSearchFeed("台灣 教育 OR 學生 OR 大學 OR 高中 OR 校園 OR 志願 OR 科系"),
  googleNewsSearchFeed("台灣 科技業 OR 裁員 OR 徵才 OR 職缺 OR 工程師 OR 職涯", 7),
  googleNewsSearchFeed("台灣 物理奧林匹亞 OR 金牌 OR 科學班 OR 實驗高中 OR 科展 OR STEM", 14),
  googleNewsSearchFeed("分科測驗 OR 學測 OR 指考 OR 落點分析 OR 放榜 OR 頂標 OR 大學申請 OR 個人申請 OR 繁星 OR 錄取分數", 6),
  googleNewsSearchFeed("台灣 消費爭議 OR 食安 OR 個資 OR 詐騙 OR 易利委 OR EZ WAY OR 報關 OR 遊戲 OR 電玩 OR 寶可夢", 6),
  googleNewsSearchFeed("台灣 物理奧林匹亞 OR 5面金牌 OR 國際物理奧林匹亞", 30),
  googleNewsSearchFeed("台灣 科學班 OR 實驗高中 科學班 OR 資優班", 30),
  googleNewsSearchFeed("台灣 教育政策 OR 校園 OR AI工具 OR 數位學習 OR 科學教育 OR 資優", 10),
  googleNewsSearchFeed("台灣 經濟 OR GDP OR 出口 OR 供應鏈 OR 關稅 OR 能源 OR 就業"),
  googleNewsSearchFeed("台灣 COVID OR 疫情 OR 食安 OR 毒油 OR 公共衛生"),
  googleNewsSearchFeed("台灣 天氣 OR 氣象 OR 颱風 OR 雷雨 OR 極端高溫"),
  googleNewsSearchFeed("SpaceX OR Starship OR rocket landing OR Indian Ocean OR NASA OR Artemis OR satellite", 7),
  googleNewsSearchFeed("global AI layoffs OR hiring OR semiconductor jobs OR robotics breakthrough", 7),
  googleNewsSearchFeed("國際 戰爭 OR 油價 OR 中東 OR 伊朗 OR 以色列 OR 供應鏈", 7),
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main() {
  if (!DRY_RUN && !GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is required. Add it as a GitHub Actions secret (Settings → Secrets and variables → Actions).",
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

  const existingRows = await findExistingSourceRows(
    preparedItems.map((item) => item.source_url),
  );
  const existingUrls = new Set(existingRows.keys());
  const newItems = preparedItems.filter(
    (item) => !existingUrls.has(item.source_url),
  );
  const refreshItems = preparedItems.filter((item) => {
    const existing = existingRows.get(item.source_url);
    return (
      existing &&
      contentNeedsRefresh(existing.content, item.content)
    );
  });

  if (newItems.length === 0 && refreshItems.length === 0) {
    console.log("All prepared items already exist in Supabase. Nothing to insert or update.");
    await cleanupOldNews();
    return;
  }

  if (newItems.length > 0) {
    const inserted = await insertNews(newItems);
    console.log(`Inserted ${inserted.length} news item(s) into Supabase.`);
  }

  if (refreshItems.length > 0) {
    const updated = await updateExistingNews(refreshItems);
    console.log(`Updated ${updated} existing news item(s) with detailed content.`);
  }

  await cleanupOldNews();
}

async function prepareClassroomItems(candidates) {
  const enrichedCandidates = await enrichCandidatesForModel(candidates);

  try {
    const items = await summarizeForClassroom(enrichedCandidates);
    if (items.length > 0) return items;

    console.warn(
      "AI 模型未回傳可用的課堂內容，改用備援規則整理。",
    );
  } catch (error) {
    console.warn(
      `AI 模型呼叫失敗，改用備援規則整理：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return buildRuleBasedClassroomItems(enrichedCandidates);
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

  const rankedItems = [...byTitle.values()]
    .filter((item) => !isHardBlockedCandidate(item))
    .sort((a, b) => b.score - a.score || b.publishedTime - a.publishedTime);
  const classroomFirstPool = rankedItems.filter(
    (item) => !isLowSignalCandidate(item),
  );
  const preferred = selectDiverseCandidates(
    classroomFirstPool,
    NEWS_CANDIDATES,
  );
  const fallback = selectDiverseCandidates(
    rankedItems.filter(
      (item) => !preferred.some((picked) => picked.source_url === item.source_url),
    ),
    Math.max(0, NEWS_CANDIDATES - preferred.length),
  );

  return [...preferred, ...fallback]
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

function selectDiverseCandidates(items, limit) {
  const selected = [];
  const selectedUrls = new Set();
  const sourceCounts = new Map();
  const topicCounts = new Map();

  for (const topicKey of priorityTopicOrder) {
    const topicCandidate = items.find(
      (item) =>
        !selectedUrls.has(item.source_url) &&
        candidateTopicKey(item) === topicKey &&
        canSelectCandidate(item, sourceCounts, topicCounts),
    );

    if (!topicCandidate) continue;

    addSelectedCandidate(
      topicCandidate,
      selected,
      selectedUrls,
      sourceCounts,
      topicCounts,
    );

    if (selected.length >= limit) return selected;
  }

  for (const item of items) {
    if (selectedUrls.has(item.source_url)) continue;
    if (!canSelectCandidate(item, sourceCounts, topicCounts)) continue;

    addSelectedCandidate(item, selected, selectedUrls, sourceCounts, topicCounts);

    if (selected.length >= limit) return selected;
  }

  for (const item of items) {
    if (selectedUrls.has(item.source_url)) continue;
    selected.push(item);
    selectedUrls.add(item.source_url);

    if (selected.length >= limit) return selected;
  }

  return selected;
}

function canSelectCandidate(item, sourceCounts, topicCounts) {
  const sourceKey = normalizeSourceKey(item.source);
  const topicKey = candidateTopicKey(item);

  return (
    (sourceCounts.get(sourceKey) ?? 0) < NEWS_MAX_PER_SOURCE &&
    (topicCounts.get(topicKey) ?? 0) < NEWS_MAX_PER_TOPIC
  );
}

function addSelectedCandidate(
  item,
  selected,
  selectedUrls,
  sourceCounts,
  topicCounts,
) {
  const sourceKey = normalizeSourceKey(item.source);
  const topicKey = candidateTopicKey(item);

  selected.push(item);
  selectedUrls.add(item.source_url);
  sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) ?? 0) + 1);
  topicCounts.set(topicKey, (topicCounts.get(topicKey) ?? 0) + 1);
}

async function enrichCandidatesForModel(candidates) {
  return Promise.all(candidates.map(enrichCandidateForModel));
}

async function enrichCandidateForModel(candidate) {
  const articleContext = await fetchArticleContext(candidate.source_url);
  return {
    ...candidate,
    article_context: articleContext.excerpt,
    resolved_source_url: articleContext.resolvedUrl,
  };
}

async function fetchArticleContext(url) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return { excerpt: "", resolvedUrl: "" };
  }

  try {
    const response = await fetch(normalizedUrl, {
      headers: {
        "user-agent":
          "teaching-hub-news-bot/1.0 (+https://github.com/chianghunghsuan/teaching-hub)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { excerpt: "", resolvedUrl: response.url ?? normalizedUrl };
    }

    const html = await response.text();
    const excerpt = extractArticleExcerpt(html);

    return {
      excerpt,
      resolvedUrl: normalizeUrl(response.url) || normalizedUrl,
    };
  } catch {
    return { excerpt: "", resolvedUrl: normalizedUrl };
  }
}

function extractArticleExcerpt(html) {
  const cleanHtml = String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  const title = extractHtmlTitle(cleanHtml);
  const description =
    extractMetaContent(cleanHtml, "description") ||
    extractMetaContent(cleanHtml, "og:description") ||
    extractMetaContent(cleanHtml, "twitter:description");
  // 只取 <article>/<main>；沒有就不硬抓 <body>，避免把整個網站選單當內文
  const articleHtml =
    extractElementHtml(cleanHtml, "article") ||
    extractElementHtml(cleanHtml, "main") ||
    "";
  const bodyText = stripHtml(articleHtml).slice(0, 2200);

  return [title, description, bodyText]
    .filter(Boolean)
    .join("\n")
    .trim()
    .slice(0, 2600);
}

function extractHtmlTitle(html) {
  const match = String(html ?? "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return stripHtml(match?.[1] ?? "");
}

function extractMetaContent(html, name) {
  const escapedName = escapeRegExp(name);
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:name|property)=["']${escapedName}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+(?:name|property)=["']${escapedName}["'][^>]*>`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = String(html ?? "").match(pattern);
    if (match?.[1]) return stripHtml(match[1]);
  }

  return "";
}

function extractElementHtml(html, tagName) {
  const match = String(html ?? "").match(
    new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"),
  );
  return match?.[1] ?? "";
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

  const haystack = candidateText({
    title,
    summary,
    source,
    source_url: sourceUrl,
  });
  const scienceScore = countKeywordHits(haystack, scienceKeywords) * 10;
  const studentScore = countKeywordHits(haystack, studentKeywords) * 14;
  const industryScore = countKeywordHits(haystack, industryKeywords) * 12;
  const publicLifeScore = countKeywordHits(haystack, publicLifeKeywords) * 11;
  const spaceScore = countKeywordHits(haystack, spaceKeywords) * 15;
  const educationAchievementScore =
    countKeywordHits(haystack, educationAchievementKeywords) * 16;
  const policyScore = countKeywordHits(haystack, policyKeywords) * 10;
  const economyScore = countKeywordHits(haystack, economyKeywords) * 10;
  const conflictScore = countKeywordHits(haystack, conflictKeywords) * 9;
  const futureOfWorkScore = countKeywordHits(haystack, futureOfWorkKeywords) * 13;
  const figureScore =
    extractInterestingFigures({ title, summary, source, source_url: sourceUrl })
      .length * 7;
  const sensitiveScore = countKeywordHits(haystack, hardBlockedKeywords) * -35;
  const sourcePenalty = isPureMarketNews({ source, source_url: sourceUrl, title, summary })
    ? -80
    : 0;
  const weakSourcePenalty = isWeakAggregator({
    source,
    source_url: sourceUrl,
    title,
    summary,
  })
    ? -26
    : 0;
  const officialCeremonyPenalty = isLowSignalOfficialItem({
    source,
    source_url: sourceUrl,
    title,
    summary,
  })
    ? -60
    : 0;
  const sourceQualityBonus = sourceQualityScore({
    source,
    source_url: sourceUrl,
    title,
    summary,
  });
  const hoursOld = publishedTime ? (Date.now() - publishedTime) / 36e5 : 999;
  if (publishedTime && hoursOld > NEWS_MAX_CANDIDATE_AGE_DAYS * 24) {
    return null;
  }
  const recencyScore = publishedTime ? Math.max(-48, 48 - Math.round(hoursOld)) : -100;
  const admissionBonus =
    countKeywordHits(haystack, ["分科","學測","指考","放榜","落點","頂標","五標","級分","繁星","申請入學","錄取分數"]) > 0
      ? 80
      : 0;
  const hotLifeBonus =
    countKeywordHits(haystack, ["易利委","EZ WAY","個資","詐騙","消費爭議","寶可夢","電玩","手遊"]) > 0
      ? 40
      : 0;

  return {
    title,
    source,
    published,
    publishedTime,
    summary: summary.slice(0, 360),
    source_url: sourceUrl,
    score:
      scienceScore +
      studentScore +
      industryScore +
      publicLifeScore +
      spaceScore +
      educationAchievementScore +
      policyScore +
      economyScore +
      conflictScore +
      futureOfWorkScore +
      figureScore +
      sensitiveScore +
      sourcePenalty +
      weakSourcePenalty +
      officialCeremonyPenalty +
      sourceQualityBonus +
      admissionBonus +
      hotLifeBonus +
      recencyScore,
  };
}

async function summarizeForClassroom(candidates) {
  // 把最高分的升學新聞標記為 must_include，強制模型選入
  const admissionRe =
    /(分科測驗|學測|指考|放榜|落點|頂標|五標|級分|填志願|志願|繁星|錄取|申請入學)/;
  let flaggedAdmission = false;
  const modelCandidates = candidates.map((c) => {
    if (!flaggedAdmission && admissionRe.test(c.title || "")) {
      flaggedAdmission = true;
      return { ...c, must_include: true };
    }
    return c;
  });
  const prompt = [
    "你是一位很會把時事『講成故事』的台灣補習班理化／物理老師，正在準備上課前 3~5 分鐘、跟國高中到大學生分享的小補充。你的目標不是摘要新聞，而是讓學生『聽得進去、覺得跟自己有關、想繼續聊』。文字要像老師在對學生說話，可以用『你們有沒有想過…』『我先問你們一件事…』這種口吻開場。",
    "請從候選新聞中挑出 6 到 8 則最適合課堂分享的內容。優先：學生升學、科系探索、職涯方向、日常生活、公共健康、食安、科學、科技、AI、機器人、半導體、能源、天氣、自然現象、太空、重大國際局勢，以及和學生生活相關又能延伸到學習或職涯的熱門題材（熱門遊戲與電玩產業、消費爭議、社會現象等）。",
    "如果是科技產業新聞，優先挑對學生理解未來工作、技能需求、公司策略、產業趨勢有幫助的內容（裁員、徵才、職缺變化、AI 與機器人進展、重大產品或政策改變）。",
    "如果是教育或職涯新聞，不要只寫活動或得獎，要補出制度背景、培訓路徑、學習與職涯的關聯，以及學生該怎麼理解它跟自己的關係。",
    "如果是政策、經濟、戰爭、國際衝突或供應鏈議題，可以選，但要回到事件本身、關鍵數字、對人與生活的影響，以及對台灣或未來工作的意義，不要只有立場或官話。",
    "如果來源只是部會活動、表揚、致詞、開幕、參訪或例行公告，除非明確涉及科學教育、人才培育、職涯機會、重大技術政策或實際數據，否則不要選。",
    "盡量涵蓋不同面向：學生與教育至少 1 則、科技或職涯至少 1 則、科學或太空至少 1 則，其餘從國際、公共健康、經濟、生活與遊戲題材中挑最有資訊量的。",
    "【最高優先的選稿規則，務必遵守】候選資料中若某一項帶有 must_include 為 true，你【一定要】把它選進最終結果並完整整理，絕對不可略過——那是對補習班學生最重要的升學新聞。除此之外，只要候選中出現升學或考試相關內容（分科測驗、學測、指考、放榜、落點分析、填志願、錄取等），也應優先納入。",
    "另外，和學生生活高度相關的熱門消費議題（例如個資、詐騙、報關 App 爭議）或遊戲產業新聞，只要能延伸到學習、科技或公民素養、且不淪為八卦或政治口水，也應盡量納入 1 則；這類議題重點放在制度、資安、消費者權益或產業面，而非個別人物的八卦。",
    "過濾血腥、八卦、未證實傳聞、犯罪細節、純股價漲跌、純投資炒作、政治口水，以及不適合課堂的內容。",
    "每則都要做『資訊整合』，不能只復述單一新聞。要把事件放進更大脈絡：背後機制、相關產業或制度、和哪些議題相連、數字代表的意義、對學生升學與職涯的實際關聯，並旁徵博引相關背景知識與趨勢，讓學生得到比原新聞更完整的理解。",
    "你會收到每則新聞的 title、summary、source，部分有 article_context。核心事件的具體數字只能用候選資料或 article_context 裡出現的；若要補充外部的背景數據而你沒有十足把握，不要編造精確數字，改用『根據歷年○○調查，大約…』描述趨勢，並在延伸討論指出可查證的真實來源。",
    "每則 content 用繁體中文，固定使用以下段落標籤（完全一致；除了這些標籤外，內文句子不要以冒號『：』開頭）：",
    "摘要：2 句內，講清楚到底發生什麼事、結果是什麼。",
    "課堂解釋：至少 6 句，像老師講解。先用一句話開場勾起興趣（前情提要），再說清楚背景、機制、牽涉的產業或科學概念、為什麼會這樣，中間自然帶到一個相關議題延伸，最後用一句話收尾、把它跟學生自己連起來（收尾銜接）。",
    "關鍵數據：列 3 到 6 點，每點一行以「- 」開頭。除了列出數字，重要的數字要在同一行用括號補一句判斷（這算多嗎、相當於什麼、可能造成什麼後果），幫學生理解數字的意義。沒把握的基準用『相對偏高／偏低』或『（趨勢，可查證：來源名）』，不要假裝精確；真的沒有數據就寫『- 來源未提供可直接採信的具體數字』。",
    "延伸整合：至少 4 句，把這則新聞整合成更完整的知識，而不是只講單一事件。要做到：(1) 幫關鍵數字判斷大小與意義、跟常態或基準比較；(2) 若和職涯有關，具體說明相關工作是什麼、和相近科系的差別（例如資安 vs 一般資訊工程／軟體工程）、台灣有沒有相關科系或證照、職缺主要在台灣還是國外、薪資水準或趨勢、需要培養的能力。精確數字沒把握就用區間或趨勢描述，別編造，並在延伸討論指出可查來源。",
    "反思結論：至少 3 句，用老師口吻講出這則新聞真正的重點、限制或機會，以及你希望學生記得的一句話。",
    "延伸討論：列 2 點，每點一行以「- 」開頭，格式為『問題？→ 參考方向：…（可查：真實來源）』，一定要給思考方向或簡短答案，並指名可查資料的來源（例如主計總處、教育部統計處、勞動部、104 或 1111 人力銀行年度報告、iThome、國際組織報告、原始論文）。不要只丟問題不給方向。",
    "tag 只能是：科學、科技、天氣、國際、社會、職涯、遊戲。",
    "article_index 必須使用候選新聞中的編號，不要自創來源。",
    '只輸出 JSON object，格式：{"items":[{"article_index":1,"tag":"科學","content":"..."}]}',
  ].join("\n");

  const requestBody = JSON.stringify({
    systemInstruction: { parts: [{ text: prompt }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: JSON.stringify({ today, candidates: modelCandidates }, null, 2) },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.25,
      responseMimeType: "application/json",
      maxOutputTokens: 65536,
    },
  });

  let content = "";
  let lastError = null;
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody,
    });
    const bodyText = await response.text();
    if (response.ok) {
      const body = JSON.parse(bodyText);
      content =
        body.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? "")
          .join("") ?? "";
      if (content) {
        console.log(`Gemini model used: ${model}`);
        break;
      }
      lastError = new Error(`Gemini ${model} returned no content.`);
      continue;
    }
    lastError = new Error(
      `Gemini ${model} failed: ${response.status} ${bodyText.slice(0, 200)}`,
    );
    if (response.status !== 404) break; // 非「找不到型號」的錯誤，換型號也沒用
  }
  if (!content) {
    throw lastError ?? new Error("Gemini: no working model.");
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

async function findExistingSourceRows(sourceUrls) {
  const existing = new Map();

  for (const sourceUrl of new Set(sourceUrls)) {
    const url = new URL(SUPABASE_NEWS_URL);
    url.searchParams.set("select", "source_url,content");
    url.searchParams.set("source_url", `eq.${sourceUrl}`);

    const rows = await supabaseJson(url, { method: "GET" }, "check duplicate");
    if (Array.isArray(rows) && rows.length > 0) {
      existing.set(sourceUrl, rows[0]);
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
    .filter(
      (candidate) =>
        !isHardBlockedCandidate(candidate) &&
        !isPureMarketNews(candidate) &&
        !isLowSignalOfficialItem(candidate),
    )
    .filter((candidate, index, items) => {
      const topicKey = candidateTopicKey(candidate);
      const currentTopicCount = items
        .slice(0, index)
        .filter((item) => candidateTopicKey(item) === topicKey).length;

      return currentTopicCount < NEWS_MAX_PER_TOPIC;
    })
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
  if (hasKeyword(candidate, ["戰爭", "衝突", "停火", "油價", "中東", "伊朗", "以色列", "烏克蘭", "俄羅斯", "關稅", "供應鏈", "GDP", "經濟"])) {
    return "國際";
  }
  if (
    hasKeyword(candidate, [
      "COVID",
      "新冠",
      "疫情",
      "疫苗",
      "食安",
      "毒油",
      "食品",
      "油品",
      "教育",
      "學生",
      "大學",
      "高中",
      "科學班",
      "奧林匹亞",
    ])
  ) {
    return "社會";
  }
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
  const explanation = explanationForCandidate(candidate, tag);
  const keyFigureLines = keyFigureLinesForCandidate(candidate);
  const articleDigest = articleDigestForCandidate(candidate);
  const reflection = reflectionForCandidate(candidate, tag);
  const discussionLines = discussionLinesForCandidate(tag, candidate);

  return [
    `摘要：${title} 這則新聞值得帶進課堂，因為它不只是單一事件，還連到${topicLabelFor(tag)}議題在真實世界中的變化。${summaryConclusionForCandidate(candidate, tag)}`,
    `課堂解釋：${explanation}\n${articleDigest}`,
    `關鍵數據：\n${keyFigureLines.join("\n")}`,
    `反思結論：${reflection}`,
    `延伸討論：\n${discussionLines.join("\n")}`,
  ].join("\n");
}

function isStructuredNewsContent(content) {
  const text = String(content ?? "");
  return (
    hasStructuredSection(text, ["摘要"]) &&
    hasStructuredSection(text, ["課堂解釋", "背景", "深入解析"]) &&
    hasStructuredSection(text, ["延伸討論"])
  );
}

function isDetailedNewsContent(content) {
  const text = String(content ?? "");
  return (
    isStructuredNewsContent(text) &&
    hasStructuredSection(text, ["關鍵數據", "關鍵數字"]) &&
    hasStructuredSection(text, ["反思結論", "結論", "影響"])
  );
}

function contentNeedsRefresh(existingContent, nextContent) {
  if (!String(nextContent ?? "").trim()) return false;
  if (FORCE_REFRESH && String(existingContent ?? "").trim() !== String(nextContent ?? "").trim()) {
    return true;
  }
  return (
    isDetailedNewsContent(nextContent) &&
    !isDetailedNewsContent(existingContent)
  );
}

function hasStructuredSection(text, labels) {
  return new RegExp(
    `(^|\\n)(?:${labels.map(escapeRegExp).join("|")})[:：]`,
    "u",
  ).test(String(text ?? ""));
}

function discussionQuestionFor(tag, candidate) {
  if (hasKeyword(candidate, ["戰爭", "衝突", "停火", "油價", "中東", "伊朗", "以色列", "烏克蘭", "俄羅斯"])) {
    return "如果把這則國際事件拆成『軍事、能源、經濟、民生』四個面向，哪一個面向對台灣最有感？";
  }
  if (hasKeyword(candidate, ["經濟", "GDP", "出口", "景氣", "就業", "失業", "供應鏈", "關稅"])) {
    return "從這些數字來看，這波經濟變化最可能先影響哪些產業、科系或工作？";
  }
  if (hasKeyword(candidate, ["SpaceX", "NASA", "太空", "火箭", "衛星", "登月"])) {
    return "如果太空產業持續擴張，未來最需要哪些跨領域能力，會不會改變學生對理工科的想像？";
  }
  if (hasKeyword(candidate, ["裁員", "徵才", "職缺", "工程師", "科系", "職涯"])) {
    return "從這則產業消息來看，未來哪些能力、工具或科系可能更有需求？";
  }
  if (hasKeyword(candidate, ["AI", "人工智慧", "機器人", "自動化"])) {
    return "這項 AI 或機器人技術如果真的普及，最可能先改變哪些工作或生活場景？";
  }
  if (hasKeyword(candidate, ["蘋果", "Apple", "微軟", "Microsoft", "Google", "OpenAI", "NVIDIA", "輝達", "台積電"])) {
    return "大公司這次的策略改變，反映出哪些技術方向正在變重要？";
  }
  if (hasKeyword(candidate, ["COVID", "新冠", "疫情", "疫苗", "食安", "毒油", "公共衛生"])) {
    return "如果要判斷這件事對日常生活的風險高不高，我們最需要先看哪些數據？";
  }
  if (hasKeyword(candidate, ["學生", "大學", "高中", "科學班", "奧林匹亞", "教育"])) {
    return "這則新聞反映出哪些學習路徑、能力訓練或升學方向值得提早準備？";
  }
  const questions = {
    科學: "如果要把這件事轉成一個可驗證的科學問題，我們會需要哪些資料？",
    科技: "這項技術解決了什麼問題，又可能帶來哪些新的限制或風險？",
    天氣: "我們可以從哪些氣象資料判斷預報可信度，而不是只看單一標題？",
    國際: "不同國家的條件不同，這則新聞中的做法適合直接套用在台灣嗎？",
    社會: "這件事和日常生活有什麼關聯，可以用哪些數據來討論它的影響？",
  };

  return questions[tag] ?? questions.社會;
}

function explanationForCandidate(candidate, tag) {
  if (hasKeyword(candidate, ["戰爭", "衝突", "停火", "油價", "中東", "伊朗", "以色列", "烏克蘭", "俄羅斯"])) {
    return "國際衝突新聞不只是在看誰和誰打起來，更重要的是去拆解它如何影響油價、航運、供應鏈、國防支出與一般人的生活成本。帶學生看這類題材時，可以把地緣政治轉成具體的能源、經濟與民生問題，讓討論不只停留在情緒或立場。";
  }
  if (hasKeyword(candidate, ["經濟", "GDP", "出口", "景氣", "就業", "失業", "供應鏈", "關稅"])) {
    return "這類新聞適合讓學生知道經濟指標不是大人世界的專有名詞，而是會慢慢反映在企業投資、徵才、薪資、科系熱門度與產業方向上。課堂上可以帶學生分辨『景氣現象』和『個人選擇』之間到底是怎麼連動的。";
  }
  if (hasKeyword(candidate, ["SpaceX", "NASA", "太空", "火箭", "衛星", "登月"])) {
    return "太空題材很適合把物理、工程、材料、控制和國際競爭放在同一個真實案例裡。學生不只會看到火箭很酷，還能進一步理解推進、回收、成本控制與任務目標之間是如何互相牽動的。";
  }
  if (hasKeyword(candidate, ["裁員", "徵才", "職缺", "工程師", "科系", "職涯"])) {
    return "這類新聞不只是公司消息，也能拿來談產業景氣、技能需求和工作型態怎麼改變。帶學生看這則新聞時，可以從企業為什麼縮編或擴編、哪些能力被放大、哪些工具開始成為基本配備切入，幫他們把新聞和未來選系、選課、培養能力連起來。";
  }
  if (hasKeyword(candidate, ["AI", "人工智慧", "機器人", "自動化"])) {
    return "可以先讓學生辨認這項技術到底做到了什麼，再追問它是靠資料、演算法、感測器，還是機械結構進步才變得可行。這類題材很適合連到物理、資訊和工程設計，也能讓學生思考技術能力和真實使用場景之間還有多少差距。";
  }
  if (hasKeyword(candidate, ["蘋果", "Apple", "微軟", "Microsoft", "Google", "OpenAI", "NVIDIA", "輝達", "台積電"])) {
    return "大公司的重大產品、策略或投資改變，常常反映整個產業未來幾年的方向。課堂上可以帶學生看：公司為什麼現在做這個決定、它背後押注的是哪種技術能力，以及這會如何影響未來市場、工作內容與學習重點。";
  }
  if (hasKeyword(candidate, ["COVID", "新冠", "疫情", "疫苗", "食安", "毒油", "公共衛生"])) {
    return "這類題材適合訓練學生分辨『事件本身』和『風險判斷』是兩回事。可以帶他們看數據、檢驗方法、制度回應和民眾行為怎麼互相影響，理解公共健康或食安議題不是只靠情緒反應，而是要看證據與制度。";
  }
  if (hasKeyword(candidate, ["學生", "大學", "高中", "科學班", "奧林匹亞", "教育"])) {
    return "這則新聞可以直接連到學生的學習路徑與升學想像。課堂上可以從訓練方式、課程設計、競賽能力或教育資源差異切入，幫學生理解某些機會背後需要的長期準備，而不是只看到結果。";
  }
  if (tag === "天氣") {
    return "可以先讓學生觀察新聞中的現象，再追問背後需要哪些資料、測量或模型來判斷。這則新聞適合用來練習把生活事件轉成可討論的科學問題，也能提醒學生不要只看標題就下結論。";
  }
  return "可以先讓學生觀察新聞標題中的現象或技術，再追問背後需要哪些資料、測量或模型來判斷。這則新聞適合用來練習把生活事件轉成可討論的科學問題，也能提醒學生不要只看標題就下結論。";
}

function keyFiguresForCandidate(candidate) {
  const figures = extractInterestingFigures(candidate);
  if (!figures.length) {
    return "來源未提供可直接採信的具體數字。";
  }

  return figures.join("；");
}

function impactForCandidate(candidate, tag) {
  if (hasKeyword(candidate, ["物理奧林匹亞", "數學奧林匹亞", "化學奧林匹亞", "生物奧林匹亞", "科學班", "實驗高中"])) {
    return "這類題材可以讓學生看到高階科學學習不是抽象口號，而是有明確訓練路徑、資源差異和長期投入的結果，也會直接影響升學想像與自我定位。";
  }
  if (hasKeyword(candidate, ["戰爭", "衝突", "油價", "供應鏈", "關稅", "中東"])) {
    return "國際衝突不只影響前線，也會透過油價、運輸、供應鏈、物價與產業投資回到一般人的生活。對學生來說，這類新聞能幫助理解全球事件如何連動到台灣的工作機會與經濟環境。";
  }
  if (hasKeyword(candidate, ["經濟", "GDP", "出口", "景氣", "就業", "失業"])) {
    return "這類新聞適合帶學生理解宏觀經濟不是離自己很遠的東西，它會影響企業徵才、產業薪資、科系熱度與未來工作的穩定度。";
  }
  if (hasKeyword(candidate, ["SpaceX", "NASA", "太空", "火箭", "衛星"])) {
    return "太空新聞很適合把抽象的物理、工程和國際競爭變成具體案例，也能讓學生看到未來新產業如何由材料、控制、機械、軟體和通訊一起推動。";
  }
  if (hasKeyword(candidate, ["政策", "補助", "教育部", "國教署", "國科會", "校園"])) {
    return "政策與制度變化通常會慢慢影響學生每天真正會遇到的學習工具、資源配置、考試與升學路徑。看懂制度，比只看事件更有長期價值。";
  }
  if (tag === "科技") {
    return "這則新聞適合拿來連結未來工作、技能需求與產業變化，讓學生理解技術進展不是只有新奇，而是會改變企業決策與社會分工。";
  }
  if (tag === "國際") {
    return "這則新聞適合拿來練習把國際事件拆成事實、數據與後續影響，避免只記住情緒化標題。";
  }
  return "這則新聞的價值不只在事件本身，也在於它能幫學生把日常觀察連到更大的制度、科學或社會脈絡。";
}

function summaryConclusionForCandidate(candidate, tag) {
  if (hasKeyword(candidate, ["地震", "颱風", "氣象", "天氣"])) {
    return "真正值得注意的不是標題本身，而是災害或自然現象如何影響供應鏈、判斷模型與日常決策。";
  }
  if (tag === "科技") {
    return "它背後通常反映的是技術能力、產業投資和工作需求的重新分配。";
  }
  if (tag === "國際") {
    return "它的重點也不只在事件本身，而是後續對能源、物價、產業與政策判斷的連鎖影響。";
  }
  return "重點不只是知道發生了什麼，而是看懂它為什麼重要、影響誰、接下來可能怎麼變。";
}

function articleDigestForCandidate(candidate) {
  const snippets = extractContextSentences(candidate, 3);
  if (!snippets.length) {
    return "如果只看標題，很容易把它誤解成單一事件；課堂上要追問的是事件牽涉哪些對象、在哪個時間點發生、規模有多大，以及後續會怎麼發展。";
  }

  return snippets.join(" ");
}

function keyFigureLinesForCandidate(candidate) {
  const contextualLines = extractFigureContextLines(candidate);
  const publishedLine = candidate.published
    ? `- 發布時間：${String(candidate.published).slice(0, 10)}`
    : "";
  const sourceLine = candidate.source ? `- 資料來源：${candidate.source}` : "";
  const lines = [...contextualLines];

  if (publishedLine) lines.push(publishedLine);
  if (sourceLine) lines.push(sourceLine);

  if (!lines.length) {
    return ["- 來源未提供可直接採信的具體數字。"];
  }

  return lines.slice(0, 6);
}

function reflectionForCandidate(candidate, tag) {
  const impact = impactForCandidate(candidate, tag);
  const caution = cautionForCandidate(candidate, tag);
  const takeaway = takeawayForCandidate(candidate, tag);
  return [impact, caution, takeaway].join(" ");
}

function discussionLinesForCandidate(tag, candidate) {
  return [
    `- ${discussionQuestionFor(tag, candidate)}`,
    `- ${followUpQuestionForCandidate(tag, candidate)}`,
  ];
}

function cautionForCandidate(candidate, tag) {
  if (hasKeyword(candidate, ["AI", "人工智慧", "機器人", "半導體"])) {
    return "這類新聞最容易被講成『技術很厲害』，但真正該追的是它的限制、成本、人才門檻和落地場景。";
  }
  if (hasKeyword(candidate, ["戰爭", "衝突", "油價", "供應鏈"])) {
    return "看國際衝突時，不能只停在立場判斷，還要分辨哪些是短期事件、哪些會變成長期的經濟和產業壓力。";
  }
  if (tag === "社會") {
    return "社會與教育新聞最怕只記住事件名稱，卻沒有拆開制度、資源差異和長期效果。";
  }
  return "這類題材最怕只吸收標題情緒，卻沒有把事件拆成事實、機制和後續影響。";
}

function takeawayForCandidate(candidate, tag) {
  if (hasKeyword(candidate, ["學生", "科學班", "奧林匹亞", "教育"])) {
    return "對學生來說，最重要的吸收不是羨慕結果，而是看懂背後需要哪些準備、資源與能力。";
  }
  if (hasKeyword(candidate, ["裁員", "徵才", "職缺", "工程師", "職涯"])) {
    return "對升學和職涯規劃來說，這類新聞最有價值的地方，是幫助學生提早理解市場真正需要的能力和工具。";
  }
  if (tag === "科技") {
    return "如果能把這則新聞和實際科系、技能、產業鏈位置連起來，它才會從新奇資訊變成真正有用的判斷材料。";
  }
  return "真正有用的學習不是把新聞背下來，而是知道下次遇到類似議題時，該用哪些資料和角度判斷。";
}

function followUpQuestionForCandidate(tag, candidate) {
  if (hasKeyword(candidate, ["地震", "颱風", "天氣", "氣象"])) {
    return "如果你是企業、政府或學校決策者，面對這種風險時最先要準備的資料和備案會是什麼？";
  }
  if (hasKeyword(candidate, ["AI", "人工智慧", "機器人", "半導體"])) {
    return "如果把這則新聞拉長到 3 到 5 年來看，哪些工作會被放大，哪些能力可能被淘汰？";
  }
  if (hasKeyword(candidate, ["教育", "學生", "科學班", "奧林匹亞"])) {
    return "如果你是學生本人，看到這則新聞後，最值得立刻開始累積的是哪一種能力或作品？";
  }
  if (tag === "國際") {
    return "如果同樣的事件發生在台灣，最可能先衝擊哪一個產業、哪一群人，為什麼？";
  }
  return "如果把這則新聞拆成『事實、原因、數據、影響、判斷』五格，你覺得哪一格最需要再補資料？";
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

function candidateText(candidate) {
  return [
    candidate.title ?? "",
    candidate.summary ?? "",
    candidate.source ?? "",
    candidate.source_url ?? "",
    candidate.resolved_source_url ?? "",
    candidate.article_context ?? "",
  ]
    .join(" ")
    .trim();
}

function candidateTitleText(candidate) {
  return [candidate.title ?? "", candidate.source ?? ""].join(" ").trim();
}

function extractContextSentences(candidate, limit = 3) {
  const text = [candidate.summary ?? "", candidate.article_context ?? ""]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return [];

  const sentences = text
    .split(/(?<=[。！？!?])\s*/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 18);

  return [...new Set(sentences)].slice(0, limit);
}

function extractFigureContextLines(candidate) {
  const text = candidateText(candidate);
  if (!text) return [];

  const pattern =
    /\d+(?:\.\d+)?\s?(?:%|％|億元|兆元|億|萬人|萬|千|美元|美金|元|年|月|日|小時|分鐘|公里|公尺|MW|GW|℃|度|人|名|家|場|次|面|顆|兆)/g;
  const lines = [];
  let match;

  while ((match = pattern.exec(text)) !== null && lines.length < 4) {
    const snippet = text
      .slice(
        Math.max(0, match.index - 18),
        Math.min(text.length, match.index + match[0].length + 24),
      )
      .replace(/\s+/g, " ")
      .trim();
    if (!snippet) continue;
    lines.push(`- ${snippet}`);
  }

  return [...new Set(lines)];
}

function extractInterestingFigures(candidate) {
  const text = candidateText(candidate);
  const matches = text.match(
    /\b\d+(?:\.\d+)?\s?(?:%|％|億元|兆元|億|萬人|萬|千|美元|美金|元|年|月|日|小時|分鐘|公里|公尺|MW|GW|℃|度|人|名|家|場|次|面|顆|兆)\b/g,
  );

  return [...new Set(matches ?? [])].slice(0, 3);
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSourceKey(source) {
  return String(source ?? "").trim().toLowerCase() || "unknown";
}

function readHostname(url) {
  try {
    return new URL(String(url ?? "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function candidateTopicKey(candidate) {
  if (hasKeyword(candidate, ["颱風", "天氣", "氣象", "雷雨", "大雨", "氣候"])) {
    return "weather";
  }
  if (
    hasKeyword(candidate, [
      "COVID",
      "新冠",
      "疫情",
      "疫苗",
      "公共衛生",
      "食安",
      "毒油",
      "食品",
      "油品",
    ])
  ) {
    return "public-health";
  }
  if (
    hasKeyword(candidate, [
      "學生",
      "高中",
      "高職",
      "大學",
      "大學生",
      "志願",
      "科系",
      "教育",
      "校園",
      "科學班",
      "奧林匹亞",
      "科展",
      "分科",
      "學測",
      "指考",
      "放榜",
      "落點",
      "頂標",
      "五標",
      "級分",
      "錄取",
      "繁星",
    ])
  ) {
    return "education";
  }
  if (hasKeyword(candidate, ["裁員", "徵才", "職缺", "工程師", "職涯"])) {
    return "career";
  }
  if (
    hasKeyword(candidate, [
      "消費",
      "個資",
      "詐騙",
      "詐欺",
      "報關",
      "易利委",
      "網購",
      "遊戲",
      "電玩",
      "寶可夢",
      "任天堂",
      "手遊",
    ])
  ) {
    return "life";
  }
  if (
    hasKeyword(candidate, [
      "SpaceX",
      "NASA",
      "JPL",
      "太空",
      "火箭",
      "衛星",
      "登月",
      "Starship",
      "Artemis",
    ])
  ) {
    return "space";
  }
  if (hasKeyword(candidate, ["戰爭", "衝突", "停火", "油價", "中東", "伊朗", "以色列", "烏克蘭", "俄羅斯"])) {
    return "global-conflict";
  }
  if (hasKeyword(candidate, ["經濟", "GDP", "出口", "供應鏈", "關稅", "景氣", "就業", "失業"])) {
    return "economy";
  }
  if (
    hasKeyword(candidate, [
      "蘋果",
      "Apple",
      "微軟",
      "Microsoft",
      "Google",
      "OpenAI",
      "NVIDIA",
      "輝達",
    ])
  ) {
    return "big-tech";
  }
  if (hasKeyword(candidate, ["AI", "人工智慧", "機器人", "自動化"])) {
    return "ai-robotics";
  }
  if (hasKeyword(candidate, ["半導體", "晶片", "台積電", "鴻海", "能源"])) {
    return "industry";
  }
  if (
    hasKeyword(candidate, [
      "科學",
      "物理",
      "天文",
      "太空",
      "NASA",
      "地震",
      "海洋",
      "醫學",
    ])
  ) {
    return "science";
  }
  return "general";
}

function isPureMarketNews(candidate) {
  const text = candidateText(candidate);
  return (
    /finance\./i.test(text) ||
    /cnyes/i.test(text) ||
    /moneydj/i.test(text) ||
    /yahoo.*股市/i.test(text) ||
    /udn.*股市/i.test(text) ||
    /(鉅亨|股市|財經|ETF|個股|大盤|籌碼)/.test(text)
  );
}

function isWeakAggregator(candidate) {
  const text = candidateText(candidate);
  return /(forecastock|cmoney|moneydj|wantgoo|minkabu|anue|cnyes)/i.test(text);
}

function isOfficialSource(candidate) {
  const text = candidateText(candidate);
  return /(gov\.tw|教育部|國科會|國教署|台北市政府)/i.test(text);
}

function isLowSignalOfficialItem(candidate) {
  return (
    hasTitleKeyword(candidate, lowSignalOfficialKeywords) &&
    !hasTitleKeyword(candidate, officialHighValueKeywords)
  );
}

function sourceQualityScore(candidate) {
  const host = readHostname(
    candidate.resolved_source_url ?? candidate.source_url ?? "",
  );
  const sourceKey = normalizeSourceKey(candidate.source);

  if (
    /(technews\.tw|pansci\.asia|nasa\.gov|space\.com|cna\.com\.tw|focustaiwan\.tw)/i.test(
      host,
    )
  ) {
    return 20;
  }
  if (/(moe\.gov\.tw|nstc\.gov\.tw)/i.test(host)) {
    return hasKeyword(candidate, officialHighValueKeywords) ? 24 : 8;
  }
  if (/(technews|pansci|cna|nasa|space\.com|教育部|國科會)/i.test(sourceKey)) {
    return 14;
  }
  if (isWeakAggregator(candidate)) {
    return -12;
  }
  return 0;
}

function isHardBlockedCandidate(candidate) {
  return hasKeyword(candidate, hardBlockedKeywords);
}

function isLowSignalCandidate(candidate) {
  return isPureMarketNews(candidate) || isLowSignalOfficialItem(candidate);
}

function hasKeyword(candidate, keywords) {
  const haystack = candidateText(candidate);
  return keywords.some((keyword) => haystack.includes(keyword));
}

function hasTitleKeyword(candidate, keywords) {
  const haystack = candidateTitleText(candidate);
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

async function updateExistingNews(items) {
  let updated = 0;

  for (const item of items) {
    const url = new URL(SUPABASE_NEWS_URL);
    url.searchParams.set("source_url", `eq.${item.source_url}`);
    const rows = await supabaseJson(
      url,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          prefer: "return=representation",
        },
        body: JSON.stringify({
          date: item.date,
          tag: item.tag,
          content: item.content,
        }),
      },
      "update existing news",
    );
    updated += Array.isArray(rows) ? rows.length : 0;
  }

  return updated;
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

function googleNewsSearchFeed(query, lookbackDays = NEWS_LOOKBACK_DAYS) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", `${query} when:${lookbackDays}d`);
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

