import { getAiResponse } from './lib/ai-providers.js';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    handleTranslation(request.text, request.isWord)
      .then(data => sendResponse({ data }))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keeps the message channel open for async response
  }
});

async function handleTranslation(text, isWord) {
  const resultObj = await chrome.storage.local.get(['apiUrl', 'apiKey', 'modelName']);
  
  const apiKey = resultObj.apiKey;
  const apiUrl = resultObj.apiUrl;
  const modelName = resultObj.modelName;

  if (!apiKey) {
    throw new Error('Please click the extension icon to set your API Key first.');
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

  const result = await getAiResponse(apiUrl, apiKey, modelName, systemPrompt, text);
  return result;
}
