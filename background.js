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

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "translation-stream") return;

  port.onMessage.addListener((request) => {
    if (request.action !== "translate") return;

    handleTranslation(request.text, request.isWord, (data) => {
      postPortMessage(port, { type: "progress", data });
    })
      .then((data) => postPortMessage(port, { type: "result", data }))
      .catch((error) =>
        postPortMessage(port, { type: "error", error: error.message }),
      );
  });
});

function postPortMessage(port, message) {
  try {
    port.postMessage(message);
  } catch (e) {
    // The page may have closed or started a newer translation.
  }
}

async function handleTranslation(text, isWord, onProgress) {
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
    systemPrompt = `分析给定英文词汇，帮助英语基础较好的用户快速建立构词记忆。构词成分最多4个，按词中出现顺序排列；包含派生或屈折后缀，必要时保留拉丁语或希腊语原形，不要强行拆解无法可靠拆解的词。严格按以下顺序输出四行 NDJSON，每行一个完整 JSON 对象，不要输出 Markdown 或其他文字：
{"field":"meaning","value":"简明中文释义，不超过20字"}
{"field":"pos","value":"中文词性，如名词、动词、形容词"}
{"field":"components","value":[{"text":"构词成分或原形","type":"前缀/词根/后缀/词干","meaning":"不超过12字的中文含义"}]}
{"field":"composition","value":"用一句中文说明各部分怎样组合、各自作用及整体含义，不超过70字"}
组合说明只解释构词关系，不展开历史演变。例如：devorare 由 de-（向下/完全）加 vorare（吞食）构成，-ing 为英语现在分词后缀，表示正在进行的动作。`;
  } else {
    systemPrompt = `把给定英文文本翻译成简洁自然的中文。只输出译文本身，不要输出 JSON、Markdown、解释或“翻译：”等前缀。完整翻译全部内容，不要省略。`;
  }

  const streamAccumulator = createStreamAccumulator(isWord, onProgress);
  const rawResult = await getAiResponse(
    apiUrl,
    apiKey,
    modelName,
    systemPrompt,
    text,
    (delta) => streamAccumulator.push(delta),
  );
  const streamedResult = streamAccumulator.finish();
  const result = streamedResult
    ? normalizeAiResponse(streamedResult, isWord)
    : normalizeAiResponse(rawResult, isWord);
  translationCache.set(cacheKey, result);
  return result;
}

function createStreamAccumulator(isWord, onProgress) {
  let buffer = "";
  const fields = {};
  let parsedFieldCount = 0;

  function consumeLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("```")) return;

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch (e) {
      return;
    }

    if (typeof event.field !== "string" || !("value" in event)) return;
    fields[event.field] = event.value;
    parsedFieldCount += 1;

    if (onProgress) {
      onProgress(createPartialResponse(fields, isWord));
    }
  }

  return {
    push(delta) {
      buffer += delta;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      lines.forEach(consumeLine);
    },
    finish() {
      consumeLine(buffer);
      return parsedFieldCount > 0 ? fields : null;
    },
  };
}

function createPartialResponse(fields, isWord) {
  if (!isWord) {
    return {
      type: "sentence",
      translation:
        typeof fields.translation === "string" ? fields.translation : "",
    };
  }

  const components = Array.isArray(fields.components)
    ? fields.components.map(normalizeWordComponent).filter((item) => item.text)
    : [];

  return {
    type: "word",
    meaning: typeof fields.meaning === "string" ? fields.meaning.trim() : "",
    pos:
      typeof fields.pos === "string"
        ? normalizeChinesePartOfSpeech(fields.pos)
        : "",
    root: components.map((component) => component.text).join(" "),
    components,
    composition:
      typeof fields.composition === "string"
        ? fields.composition.trim()
        : typeof fields.origin === "string"
          ? fields.origin.trim()
          : "",
  };
}

function normalizeAiResponse(rawResponse, isWord) {
  if (!isWord) {
    return normalizeSentenceAiResponse(rawResponse);
  }

  const parsed = parseJsonObject(rawResponse);
  return normalizeWordResponse(parsed);
}

function normalizeSentenceAiResponse(rawResponse) {
  if (
    rawResponse &&
    typeof rawResponse === "object" &&
    !Array.isArray(rawResponse)
  ) {
    return normalizeSentenceResponse(rawResponse);
  }

  if (typeof rawResponse !== "string") {
    throw new Error("AI 返回的译文格式不正确，请重试。");
  }

  const trimmed = rawResponse.trim();
  const jsonCandidates = [
    trimmed,
    stripMarkdownFence(trimmed),
    extractFirstJsonObject(trimmed),
  ].filter(Boolean);

  // Keep accepting the old JSON/NDJSON response so cached or less obedient
  // providers continue to work after switching sentence translation to text.
  for (const candidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return normalizeSentenceResponse(parsed);
      }
    } catch (e) {
      // Plain text (or an incomplete JSON wrapper) is handled below.
    }
  }

  const salvagedTranslation = extractJsonStringField(trimmed, [
    "translation",
    "value",
    "翻译",
    "中文翻译",
  ]);
  if (salvagedTranslation) {
    return normalizeSentenceResponse({ translation: salvagedTranslation });
  }

  const translation = cleanPlainTranslation(stripMarkdownFence(trimmed) || trimmed);
  if (!translation || /^[\[{]/.test(translation)) {
    throw new Error("AI 没有返回可用的译文，请重试或换一个模型。");
  }

  return normalizeSentenceResponse({ translation });
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
  const match = text.match(/^```(?:json|text|markdown)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : "";
}

function cleanPlainTranslation(text) {
  let cleaned = text
    .trim()
    .replace(/^(?:translation|中文翻译|翻译)\s*[:：]\s*/i, "")
    .trim();

  const quotePairs = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
  ];
  for (const [opening, closing] of quotePairs) {
    if (
      cleaned.length >= 2 &&
      cleaned.startsWith(opening) &&
      cleaned.endsWith(closing)
    ) {
      cleaned = cleaned.slice(opening.length, -closing.length).trim();
      break;
    }
  }

  return cleaned;
}

function extractJsonStringField(text, keys) {
  for (const key of keys) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`"${escapedKey}"\\s*:\\s*"`, "i").exec(text);
    if (!match) continue;

    const start = match.index + match[0].length;
    let fragment = "";
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (!escaped && char === '"') break;
      fragment += char;

      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      }
    }

    if (escaped) fragment = fragment.slice(0, -1);
    const decoded = decodeJsonStringFragment(fragment).trim();
    if (decoded) return decoded;
  }

  return "";
}

function decodeJsonStringFragment(fragment) {
  try {
    return JSON.parse(`"${fragment.replace(/[\r\n]/g, "\\n")}"`);
  } catch (e) {
    return fragment
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
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
    composition: getFirstString(parsed, [
      "composition",
      "assembly",
      "构词组合",
      "组合说明",
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

  validateRequiredFields(normalized, ["meaning", "pos", "composition"]);
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
  const legacyFieldValue =
    parsed.field === "translation" && typeof parsed.value === "string"
      ? parsed.value
      : "";
  const normalized = {
    type: "sentence",
    translation:
      getFirstString(parsed, ["translation", "翻译", "中文翻译"]) ||
      legacyFieldValue.trim(),
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
