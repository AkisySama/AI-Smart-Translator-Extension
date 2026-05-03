document.addEventListener('DOMContentLoaded', () => {
  const apiUrlInput = document.getElementById('apiUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const modelNameInput = document.getElementById('modelName');
  const saveBtn = document.getElementById('saveBtn');
  const statusDiv = document.getElementById('status');

  // Load existing settings
  chrome.storage.local.get(['apiUrl', 'apiKey', 'modelName'], (result) => {
    apiUrlInput.value = result.apiUrl || 'https://api.openai.com/v1/chat/completions';
    apiKeyInput.value = result.apiKey || '';
    modelNameInput.value = result.modelName || 'gpt-3.5-turbo';
  });

  // Save settings
  saveBtn.addEventListener('click', () => {
    const apiUrl = apiUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const modelName = modelNameInput.value.trim();

    chrome.storage.local.set({ apiUrl, apiKey, modelName }, () => {
      statusDiv.textContent = 'Settings saved successfully!';
      setTimeout(() => {
        statusDiv.textContent = '';
      }, 2000);
    });
  });
});
