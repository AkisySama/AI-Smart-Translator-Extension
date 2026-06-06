export async function getAiResponse(apiUrl, apiKey, modelName, systemPrompt, userMessage) {
  // Default to OpenAI compatible format
  const defaultUrl = 'https://api.openai.com/v1/chat/completions';
  const endpoint = apiUrl || defaultUrl;
  
  const payload = {
    model: modelName || 'gpt-5.4-mini',
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ],
    temperature: 0.3,
    // Disable thinking/reasoning mode for providers that support it
    // DeepSeek / Qwen style
    enable_thinking: false,
    // Anthropic style (via compatible endpoints)
    thinking: { type: "disabled" }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      throw new Error('请求超时，请检查网络后重试。');
    }
    throw new Error('网络连接失败，请检查网络或 API 地址。');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('鉴权失败，请检查 API Key 是否正确。');
    } else if (response.status === 429) {
      throw new Error('请求过于频繁或额度不足，请稍后再试。');
    } else if (response.status >= 500) {
      throw new Error('API 服务暂时异常，请稍后再试。');
    }
    throw new Error(`API 请求失败（HTTP ${response.status}），请检查设置。`);
  }

  const data = await response.json();
  
  if (data.choices && data.choices.length > 0) {
    return data.choices[0].message.content;
  } else {
    throw new Error("API 返回格式异常，请检查模型或接口地址。");
  }
}
