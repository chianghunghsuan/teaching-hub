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
const NEWS_MAX_PER_SOURCE = parsePositiveInt(
  process.env.NEWS_MAX_PER_SOURCE,
  3,
);
const NEWS_MAX_PER_TOPIC = parsePositiveInt(
  process.env.NEWS_MAX_PER_TOPIC,
  2,
);
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

const rssFeeds = [
  directRssFeed("科技新報", "https://technews.tw/feed/"),
  directRssFeed("PanSci 泛科學", "https://pansci.asia/feed"),
  googleNewsSearchFeed("科學 OR 物理 OR 天文 OR 太空 OR 氣象 OR 地震"),
  googleNewsSearchFeed("科技 OR AI OR 人工智慧 OR 半導體 OR 機器人 OR 能源"),
  googleNewsSearchFeed("台灣 學生 OR 大學 OR 高中 OR 科學班 OR 奧林匹亞 OR 教育"),
  googleNewsSearchFeed("台灣 裁員 OR 職缺 OR 工程師 OR 科技業 OR 台積電 OR 蘋果 OR 微軟"),
  googleNewsSearchFeed("台灣 COVID OR 疫情 OR 食安 OR 毒油 OR 公共衛生"),
  googleNewsSearchFeed("台灣 天氣 OR 自然 OR 環境 OR 生活"),
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
      isStructuredNewsContent(item.content) &&
      !isStructuredNewsContent(existing.content)
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

  return selectDiverseCandidates(
    [...byTitle.values()]
      .filter((item) => !isHardBlockedCandidate(item))
      .sort(
      (a, b) => b.score - a.score || b.publishedTime - a.publishedTime,
      ),
    NEWS_CANDIDATES,
  )
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

  for (const item of items) {
    const sourceKey = normalizeSourceKey(item.source);
    const topicKey = candidateTopicKey(item);

    if ((sourceCounts.get(sourceKey) ?? 0) >= NEWS_MAX_PER_SOURCE) continue;
    if ((topicCounts.get(topicKey) ?? 0) >= NEWS_MAX_PER_TOPIC) continue;

    selected.push(item);
    selectedUrls.add(item.source_url);
    sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) ?? 0) + 1);
    topicCounts.set(topicKey, (topicCounts.get(topicKey) ?? 0) + 1);

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
  const sensitiveScore = countKeywordHits(haystack, sensitiveKeywords) * -25;
  const sourcePenalty = isFinanceHeavySource({ source, source_url: sourceUrl })
    ? -80
    : 0;
  const hoursOld = publishedTime ? (Date.now() - publishedTime) / 36e5 : 999;
  const recencyScore = publishedTime ? Math.max(-48, 48 - Math.round(hoursOld)) : -100;

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
      sensitiveScore +
      sourcePenalty +
      recencyScore,
  };
}

async function summarizeForClassroom(candidates) {
  const prompt = [
    "你是台灣補習班物理老師的課堂時事助理。",
    "請從候選新聞中挑出 3 到 5 則最適合國高中學生課堂分享的內容。",
    "優先選擇和學生、升學、科系探索、職涯方向、日常生活、公共健康、食安、科學、科技、AI、機器人、半導體、能源、天氣、自然現象相關的題材。",
    "如果是科技產業新聞，優先挑對學生理解未來工作、技能需求、公司策略轉變、產業趨勢有幫助的內容，例如裁員、徵才、職缺暴增、AI 發展、機器人能力提升、大公司的重大產品或政策改變。",
    "如果是公共政策新聞，只保留與學生、教育、校園、AI 工具、公共生活直接相關的具體政策，不要政黨攻防、政治口水或選戰內容。",
    "如果是公共事件或健康議題，優先選有事實、數據、研究、制度改變或生活影響的內容，例如 COVID-19、食安、公共衛生、能源、災害防救。",
    "過濾血腥暴力、八卦、犯罪細節、未證實傳聞、純投資炒股、純股價漲跌或不適合課堂討論的內容。",
    "每則 content 請用繁體中文，並固定使用三行格式：",
    "摘要：1 句，濃縮新聞重點，能直接給學生看。",
    "課堂解釋：2 到 4 句，用國高中學生聽得懂的方式解釋背景、科學、科技、產業或公共生活概念，盡量連到物理、自然、職涯或生活觀察。",
    "延伸討論：1 個能引導學生思考的問題。",
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
        !hasKeyword(candidate, sensitiveKeywords) &&
        !isFinanceHeavySource(candidate),
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
  const question = discussionQuestionFor(tag, candidate);
  const explanation = explanationForCandidate(candidate, tag);

  return [
    `摘要：今天可用「${title}」帶學生連結生活中的${topicLabelFor(tag)}議題。`,
    `課堂解釋：${explanation}`,
    `延伸討論：${question}`,
  ].join("\n");
}

function isStructuredNewsContent(content) {
  const text = String(content ?? "");
  return (
    /(^|\n)摘要[:：]/u.test(text) &&
    /(^|\n)課堂解釋[:：]/u.test(text) &&
    /(^|\n)延伸討論[:：]/u.test(text)
  );
}

function discussionQuestionFor(tag, candidate) {
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
  return `${candidate.title ?? ""} ${candidate.summary ?? ""} ${candidate.source ?? ""} ${candidate.source_url ?? ""}`;
}

function normalizeSourceKey(source) {
  return String(source ?? "").trim().toLowerCase() || "unknown";
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
    ])
  ) {
    return "education";
  }
  if (hasKeyword(candidate, ["裁員", "徵才", "職缺", "工程師", "職涯"])) {
    return "career";
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

function isFinanceHeavySource(candidate) {
  const text = candidateText(candidate);
  return (
    /finance\./i.test(text) ||
    /cnyes/i.test(text) ||
    /moneydj/i.test(text) ||
    /yahoo.*股市/i.test(text) ||
    /udn.*股市/i.test(text) ||
    /(鉅亨|股市|財經)/.test(text)
  );
}

function isHardBlockedCandidate(candidate) {
  return hasKeyword(candidate, sensitiveKeywords);
}

function hasKeyword(candidate, keywords) {
  const haystack = candidateText(candidate);
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
