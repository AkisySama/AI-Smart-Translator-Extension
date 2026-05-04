export async function getAiResponse(apiUrl, apiKey, modelName, systemPrompt, userMessage) {
  // Default to OpenAI compatible format
  const defaultUrl = 'https://api.openai.com/v1/chat/completions';
  const endpoint = apiUrl || defaultUrl;
  
  const payload = {
    model: modelName || 'gpt-3.5-turbo',
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
      throw new Error('Request timed out. Please check your network and try again.');
    }
    throw new Error('Network error. Please check your connection.');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Authentication failed. Please check your API Key.');
    } else if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please wait and try again.');
    } else if (response.status >= 500) {
      throw new Error('API server error. Please try again later.');
    }
    throw new Error(`API request failed (HTTP ${response.status}). Please check your settings.`);
  }

  const data = await response.json();
  
  if (data.choices && data.choices.length > 0) {
    return data.choices[0].message.content;
  } else {
    throw new Error("Unexpected API response format.");
  }
}
