import { getAiResponse } from "./lib/ai-providers.js";

const translationCache = new Map();

const PART_OF_SPEECH_ZH = {
  noun: "名词",
  n: "名词",
  "n.": "名词",
  verb: "动词",
  v: "动词",
  "v.": "动词",
  adjective: "形容词",
  adj: "形容词",
  "adj.": "形容词",
  adverb: "副词",
  adv: "副词",
  "adv.": "副词",
  pronoun: "代词",
  pron: "代词",
  "pron.": "代词",
  preposition: "介词",
  prep: "介词",
  "prep.": "介词",
  conjunction: "连词",
  conj: "连词",
  "conj.": "连词",
  interjection: "感叹词",
  interj: "感叹词",
  "interj.": "感叹词",
  article: "冠词",
  determiner: "限定词",
  numeral: "数词",
  auxiliary: "助动词",
  phrase: "短语",
  gerund: "动名词",
  participle: "分词",
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "translate") {
    handleTranslation(request.text, request.isWord)
      .then((data) => sendResponse({ data }))
      .catch((error) => sendResponse({ error: error.message }));
    return true; // Keeps the message channel open for async response
  }
});

async function handleTranslation(text, isWord) {
  const cacheKey = `${text}::${isWord}`;
  const cached = translationCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const resultObj = await chrome.storage.local.get([
    "apiUrl",
    "apiKey",
    "modelName",
  ]);

  const apiKey = resultObj.apiKey;
  const apiUrl = resultObj.apiUrl;
  const modelName = resultObj.modelName;

  if (!apiKey) {
    throw new Error("请先点击扩展图标，填写并保存 API Key。");
  }

  let systemPrompt = "";
  if (isWord) {
    systemPrompt = `You are a helpful dictionary assistant. Analyze the given English word and output strictly in JSON format.
Required JSON keys:
"meaning": Chinese meaning of the word.
"pos": 必须使用中文词性名称。不要返回英文词性、英文缩写或英文标签。例如：名词、动词、形容词、副词、介词、连词、代词。
"components": 构词成分数组。每个成分必须包含 "text", "type", "meaning" 三个字段。"type" 使用中文：前缀、词根、后缀、词干。保留必要连字符，例如 un-, -able, nov-。
"origin": 详细阐述该单词的历史演变（200字以内），说明从构词成分源头到现代用法的语义变化过程，使用中文输出。

Output strictly valid JSON only. Do not wrap in markdown or add any conversational text.`;
  } else {
    systemPrompt = `You are a helpful translation assistant. Translate the given English sentence to Chinese. Output strictly in JSON format.
Required JSON key:
"translation": The Chinese translation.

Output strictly valid JSON only. Do not wrap in markdown or add any conversational text.`;
  }

  const rawResult = await getAiResponse(
    apiUrl,
    apiKey,
    modelName,
    systemPrompt,
    text,
  );
  const result = normalizeAiResponse(rawResult, isWord);
  translationCache.set(cacheKey, result);
  return result;
}

function normalizeAiResponse(rawResponse, isWord) {
  const parsed = parseJsonObject(rawResponse);
  return isWord
    ? normalizeWordResponse(parsed)
    : normalizeSentenceResponse(parsed);
}

function parseJsonObject(rawResponse) {
  if (
    rawResponse &&
    typeof rawResponse === "object" &&
    !Array.isArray(rawResponse)
  ) {
    return rawResponse;
  }

  if (typeof rawResponse !== "string") {
    throw new Error("AI 返回的格式不正确，请重试。");
  }

  const trimmed = rawResponse.trim();
  const candidates = [
    trimmed,
    stripMarkdownFence(trimmed),
    extractFirstJsonObject(trimmed),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      // Try the next candidate.
    }
  }

  throw new Error("AI 没有返回可解析的 JSON，请重试或换一个模型。");
}

function stripMarkdownFence(text) {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : "";
}

function extractFirstJsonObject(text) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (start === -1) {
      if (char === "{") {
        start = i;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return "";
}

function normalizeWordResponse(parsed) {
  const legacyRoot = getFirstString(parsed, ["root", "词根"]);
  const components = normalizeWordComponents(parsed, legacyRoot);
  const normalized = {
    type: "word",
    meaning: getFirstString(parsed, [
      "meaning",
      "中文意思",
      "释义",
      "definition",
    ]),
    pos: normalizeChinesePartOfSpeech(
      getFirstString(parsed, ["pos", "partOfSpeech", "part_of_speech", "词性"]),
    ),
    root: components.map((component) => component.text).join(" "),
    components,
    origin: getFirstString(parsed, [
      "origin",
      "origin_zh",
      "构词来历",
      "构词解释",
      "构词演变",
      "词根来历",
      "词源",
      "历史演变",
    ]),
  };

  validateRequiredFields(normalized, ["meaning", "pos", "origin"]);
  validateWordComponents(normalized.components);
  return normalized;
}

function normalizeWordComponents(parsed, fallbackRoot) {
  const rawComponents =
    parsed.components ||
    parsed.wordComponents ||
    parsed.word_parts ||
    parsed.wordParts ||
    parsed.parts ||
    parsed.morphemes ||
    parsed["构词"] ||
    parsed["构词成分"];

  const components = Array.isArray(rawComponents)
    ? rawComponents
        .map(normalizeWordComponent)
        .filter((component) => component.text)
    : [];

  if (components.length > 0) {
    return components;
  }

  if (fallbackRoot) {
    return [{ text: fallbackRoot, type: "词根", meaning: "" }];
  }

  return [];
}

function normalizeWordComponent(component) {
  if (typeof component === "string") {
    return {
      text: component.trim(),
      type: "",
      meaning: "",
    };
  }

  if (!component || typeof component !== "object" || Array.isArray(component)) {
    return { text: "", type: "", meaning: "" };
  }

  return {
    text: getFirstString(component, [
      "text",
      "part",
      "value",
      "component",
      "morpheme",
      "root",
      "成分",
      "构词成分",
      "词根",
    ]),
    type: getFirstString(component, ["type", "kind", "role", "类型"]),
    meaning: getFirstString(component, ["meaning", "含义", "意思", "语义"]),
  };
}

function validateWordComponents(components) {
  if (!Array.isArray(components) || components.length === 0) {
    throw new Error("AI 返回内容不完整，缺少字段：components。请重试。");
  }
}

function normalizeChinesePartOfSpeech(pos) {
  const trimmed = pos.trim();
  if (!trimmed) {
    return "";
  }

  if (/\p{Script=Han}/u.test(trimmed)) {
    return trimmed;
  }

  const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
  const compact = normalized.replace(/\.$/, "");

  if (PART_OF_SPEECH_ZH[normalized]) {
    return PART_OF_SPEECH_ZH[normalized];
  }

  if (PART_OF_SPEECH_ZH[compact]) {
    return PART_OF_SPEECH_ZH[compact];
  }

  if (normalized.includes("phrasal verb")) return "短语动词";
  if (normalized.includes("transitive verb")) return "及物动词";
  if (normalized.includes("intransitive verb")) return "不及物动词";
  if (normalized.includes("verb")) return "动词";
  if (normalized.includes("noun")) return "名词";
  if (normalized.includes("adjective")) return "形容词";
  if (normalized.includes("adverb")) return "副词";
  if (normalized.includes("preposition")) return "介词";
  if (normalized.includes("conjunction")) return "连词";
  if (normalized.includes("pronoun")) return "代词";

  return "其他";
}

function normalizeSentenceResponse(parsed) {
  const normalized = {
    type: "sentence",
    translation: getFirstString(parsed, ["translation", "翻译", "中文翻译"]),
  };

  validateRequiredFields(normalized, ["translation"]);
  return normalized;
}

function getFirstString(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function validateRequiredFields(data, fields) {
  const missingFields = fields.filter((field) => !data[field]);
  if (missingFields.length > 0) {
    throw new Error(
      `AI 返回内容不完整，缺少字段：${missingFields.join("、")}。请重试。`,
    );
  }
}
