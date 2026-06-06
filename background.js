import { getAiResponse } from './lib/ai-providers.js';

const translationCache = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    handleTranslation(request.text, request.isWord)
      .then(data => sendResponse({ data }))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keeps the message channel open for async response
  }
});

async function handleTranslation(text, isWord) {
  const cacheKey = `${text}::${isWord}`;
  const cached = translationCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const resultObj = await chrome.storage.local.get(['apiUrl', 'apiKey', 'modelName']);
  
  const apiKey = resultObj.apiKey;
  const apiUrl = resultObj.apiUrl;
  const modelName = resultObj.modelName;

  if (!apiKey) {
    throw new Error('请先点击扩展图标，填写并保存 API Key。');
  }

  let systemPrompt = "";
  if (isWord) {
    systemPrompt = `You are a helpful dictionary assistant. Analyze the given English word and output strictly in JSON format.
Required JSON keys:
"meaning": Chinese meaning of the word.
"pos": Part of speech in Chinese (e.g., 名词, 动词, 形容词).
"root": The root of the word. You must include the hyphen if applicable to show it is a root (e.g., for innovation, output "nov-").
"origin": 详细阐述该单词的历史演变（150字以内），说明从词根源头到现代用法的语义变化过程，使用中文输出。

Output strictly valid JSON only. Do not wrap in markdown or add any conversational text.`;
  } else {
    systemPrompt = `You are a helpful translation assistant. Translate the given English sentence to Chinese. Output strictly in JSON format.
Required JSON key:
"translation": The Chinese translation.

Output strictly valid JSON only. Do not wrap in markdown or add any conversational text.`;
  }

  const rawResult = await getAiResponse(apiUrl, apiKey, modelName, systemPrompt, text);
  const result = normalizeAiResponse(rawResult, isWord);
  translationCache.set(cacheKey, result);
  return result;
}

function normalizeAiResponse(rawResponse, isWord) {
  const parsed = parseJsonObject(rawResponse);
  return isWord ? normalizeWordResponse(parsed) : normalizeSentenceResponse(parsed);
}

function parseJsonObject(rawResponse) {
  if (rawResponse && typeof rawResponse === 'object' && !Array.isArray(rawResponse)) {
    return rawResponse;
  }

  if (typeof rawResponse !== 'string') {
    throw new Error('AI 返回的格式不正确，请重试。');
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
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      // Try the next candidate.
    }
  }

  throw new Error('AI 没有返回可解析的 JSON，请重试或换一个模型。');
}

function stripMarkdownFence(text) {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : '';
}

function extractFirstJsonObject(text) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (start === -1) {
      if (char === '{') {
        start = i;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return '';
}

function normalizeWordResponse(parsed) {
  const normalized = {
    type: 'word',
    meaning: getFirstString(parsed, ['meaning', '中文意思', '释义', 'definition']),
    pos: getFirstString(parsed, ['pos', 'partOfSpeech', 'part_of_speech', '词性']),
    root: getFirstString(parsed, ['root', '词根']),
    origin: getFirstString(parsed, ['origin', 'origin_zh', '词根来历', '词源', '历史演变']),
  };

  validateRequiredFields(normalized, ['meaning', 'pos', 'root', 'origin']);
  return normalized;
}

function normalizeSentenceResponse(parsed) {
  const normalized = {
    type: 'sentence',
    translation: getFirstString(parsed, ['translation', '翻译', '中文翻译']),
  };

  validateRequiredFields(normalized, ['translation']);
  return normalized;
}

function getFirstString(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function validateRequiredFields(data, fields) {
  const missingFields = fields.filter(field => !data[field]);
  if (missingFields.length > 0) {
    throw new Error(`AI 返回内容不完整，缺少字段：${missingFields.join('、')}。请重试。`);
  }
}
