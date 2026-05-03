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
    temperature: 0.3
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`API Request Failed (${response.status}): ${errorData}`);
  }

  const data = await response.json();
  
  if (data.choices && data.choices.length > 0) {
    return data.choices[0].message.content;
  } else {
    throw new Error("Unexpected API response format.");
  }
}
